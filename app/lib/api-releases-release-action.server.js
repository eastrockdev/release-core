import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ARTIST_ROLES, CREDIT_ROLES, isPublishingRole } from "../lib/releasecore";
import {
  assignMissingIsrcsForRelease,
  correctIsrcForTrack,
  maybeAutoAssignIsrc,
} from "../lib/isrc.server";
import { assignUpcToRelease } from "../lib/upc.server";
import { calculateReleaseReadiness, releaseIsEditable, WORKFLOW_INTENTS } from "../lib/workflow";
import { dispatchLatestEvent } from "../lib/automations.server";
import { isrcAssignmentMode } from "../lib/isrc";
import { apiErrorResponse, publicError } from "./http-security.server";
import { findShopArtist, findShopContributor, findShopRelease } from "./tenant-db.server";
import { parseReleaseTimelineFormData } from "./release-timeline.server";
import { deleteReleaseDraft } from "./release-drafts.server";

async function getOwnedRelease(id, shop, include = {}) {
  return findShopRelease(shop, id, { include });
}

async function syncReleaseArtistName(releaseId, shop) {
  const assignments = await db.releaseArtist.findMany({
    where: { releaseId, release: { shop } },
    include: { artist: true },
    orderBy: { position: "asc" },
  });
  const first = assignments.find((item) => item.role === "PRIMARY") || assignments[0];
  await db.release.updateMany({ where: { id: releaseId, shop }, data: { artistName: first?.artist?.name || null } });
}

function parseOwnership(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw publicError("Ownership must be between 0 and 100%.", { status: 400 });
  return Math.round(number * 100) / 100;
}

async function assertPublishingTotal(trackId, nextPercent, excludeCreditId = null) {
  const credits = await db.trackCredit.findMany({ where: { trackId } });
  const existing = credits
    .filter((credit) => credit.id !== excludeCreditId && isPublishingRole(credit.role))
    .reduce((sum, credit) => sum + (credit.ownershipPercent || 0), 0);
  if (existing + (nextPercent || 0) > 100.00001) throw publicError(`Publishing ownership cannot exceed 100%. Current assigned total is ${existing}%.`, { status: 400 });
}


async function getWorkflowRelease(id, shop) {
  return findShopRelease(shop, id, {
    include: {
      artists: true,
      files: true,
      reviewItems: { where: { status: "OPEN" } },
      tracks: {
        orderBy: { position: "asc" },
        include: { artists: true, credits: true, files: true },
      },
    },
  });
}

export const action = async ({ request, params }) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });

  try {
    const { admin, session } = await authenticate.admin(request);
    const release = await getOwnedRelease(params.releaseId, session.shop, {
      tracks: { orderBy: { position: "asc" } },
      artists: { orderBy: { position: "asc" } },
    });
    if (!release) return Response.json({ ok: false, error: "Release not found." }, { status: 404 });

    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");
    const appSettings = await db.appSettings.findUnique({ where: { shop: session.shop } });

    if (intent === "submit-release") {
      if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is not currently editable or eligible for submission." }, { status: 409 });
      const fullRelease = await getWorkflowRelease(release.id, session.shop);
      const readiness = calculateReleaseReadiness(fullRelease, appSettings);
      if (!readiness.ready) {
        return Response.json({ ok: false, error: `Release is not ready to submit. ${readiness.blockers.slice(0, 4).map((item) => item.message).join(" ")}` }, { status: 400 });
      }
      if (fullRelease.reviewItems.length) {
        return Response.json({ ok: false, error: `Resolve ${fullRelease.reviewItems.length} open change request${fullRelease.reviewItems.length === 1 ? "" : "s"} before resubmitting.` }, { status: 400 });
      }
      const now = new Date();
      const firstSubmission = !release.submittedAt;
      const eventType = firstSubmission ? "SUBMITTED" : "RESUBMITTED";
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "SUBMITTED", submittedAt: release.submittedAt || now, lastSubmittedAt: now, reviewStartedAt: null, decisionAt: null } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: eventType, message: firstSubmission ? "Release submitted for review." : "Release resubmitted after requested changes.", actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "SUBMITTED" } }),
      ]);
      await dispatchLatestEvent({ admin, shop: session.shop, releaseId: release.id, type: eventType });
      return Response.json({ ok: true, message: firstSubmission ? "Release submitted for review." : "Release resubmitted for review." });
    }

    if (intent === "start-review") {
      if (release.status !== "SUBMITTED") return Response.json({ ok: false, error: "Only a submitted release can be moved into review." }, { status: 409 });
      const now = new Date();
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "IN_REVIEW", reviewStartedAt: now } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "REVIEW_STARTED", message: "Staff review started.", actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "IN_REVIEW" } }),
      ]);
      return Response.json({ ok: true, message: "Release moved into review." });
    }

    if (intent === "request-changes") {
      if (!["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(release.status)) return Response.json({ ok: false, error: "Change requests can only be added to a submitted or reviewing release." }, { status: 409 });
      const message = String(formData.get("message") || "").trim();
      const requestedTrackId = String(formData.get("reviewTrackId") || "").trim() || null;
      if (!message) return Response.json({ ok: false, error: "Describe the change that is required." }, { status: 400 });
      if (requestedTrackId && !release.tracks.some((track) => track.id === requestedTrackId)) return Response.json({ ok: false, error: "Selected track does not belong to this release." }, { status: 400 });
      await db.$transaction([
        db.releaseReviewItem.create({ data: { releaseId: release.id, trackId: requestedTrackId, message } }),
        db.release.update({ where: { id: release.id }, data: { status: "CHANGES_REQUESTED", decisionAt: null } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "CHANGES_REQUESTED", message, actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "CHANGES_REQUESTED", trackId: requestedTrackId } }),
      ]);
      await dispatchLatestEvent({ admin, shop: session.shop, releaseId: release.id, type: "CHANGES_REQUESTED" });
      return Response.json({ ok: true, message: "Change request added and the release was returned for edits." });
    }

    if (intent === "resolve-review-item") {
      if (!releaseIsEditable(release.status)) return Response.json({ ok: false, error: "This release is not currently editable." }, { status: 409 });
      const reviewItemId = String(formData.get("reviewItemId") || "");
      const item = await db.releaseReviewItem.findFirst({ where: { id: reviewItemId, releaseId: release.id } });
      if (!item) return Response.json({ ok: false, error: "Change request not found." }, { status: 404 });
      if (item.status === "RESOLVED") return Response.json({ ok: true, message: "That change request is already resolved." });
      const now = new Date();
      await db.$transaction([
        db.releaseReviewItem.update({ where: { id: item.id }, data: { status: "RESOLVED", resolvedAt: now } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "CHANGE_RESOLVED", message: item.message, actorLabel: "Shopify admin", fromStatus: release.status, toStatus: release.status, trackId: item.trackId } }),
      ]);
      return Response.json({ ok: true, message: "Change request marked resolved." });
    }

    if (intent === "approve-release") {
      if (!["SUBMITTED", "IN_REVIEW"].includes(release.status)) return Response.json({ ok: false, error: "Only a submitted release can be approved." }, { status: 409 });
      const fullRelease = await getWorkflowRelease(release.id, session.shop);
      const readiness = calculateReleaseReadiness(fullRelease, appSettings);
      if (!readiness.ready) return Response.json({ ok: false, error: `Release can’t be approved yet. ${readiness.blockers.slice(0, 4).map((item) => item.message).join(" ")}` }, { status: 400 });
      if (fullRelease.reviewItems.length) return Response.json({ ok: false, error: "Resolve all open change requests before approving this release." }, { status: 400 });
      const now = new Date();
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "APPROVED", decisionAt: now, distributionStatus: "QUEUED", distributionUpdatedAt: now } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "APPROVED", message: "Release approved and moved to the Distribution Queue.", actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "APPROVED" } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "DISTRIBUTION_QUEUED", message: "Release is ready for downstream distribution processing.", actorLabel: "Shopify admin" } }),
      ]);
      let upcMessage = "";
      if (appSettings?.upcMode === "GS1" && appSettings?.gs1CompanyPrefix) {
        try {
          const upc = await assignUpcToRelease({ releaseId: release.id, shop: session.shop });
          upcMessage = ` UPC ${upc} assigned.`;
        } catch (upcError) {
          console.warn("ReleaseCore: automatic UPC assignment after approval was skipped", upcError);
        }
      }
      await dispatchLatestEvent({ admin, shop: session.shop, releaseId: release.id, type: "APPROVED" });
      return Response.json({ ok: true, message: `Release approved and added to Distribution.${upcMessage}` });
    }

    if (intent === "reject-release") {
      if (!["SUBMITTED", "IN_REVIEW"].includes(release.status)) return Response.json({ ok: false, error: "Only a submitted release can be rejected." }, { status: 409 });
      const reason = String(formData.get("message") || "").trim();
      if (!reason) return Response.json({ ok: false, error: "Enter a reason for rejection." }, { status: 400 });
      const now = new Date();
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "REJECTED", decisionAt: now } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "REJECTED", message: reason, actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "REJECTED" } }),
      ]);
      await dispatchLatestEvent({ admin, shop: session.shop, releaseId: release.id, type: "REJECTED" });
      return Response.json({ ok: true, message: "Release rejected." });
    }

    if (intent === "delete-draft") {
      const deleted = await deleteReleaseDraft({
        shop: session.shop,
        releaseId: release.id,
      });
      return Response.json({
        ok: true,
        deleted,
        message: `Draft “${deleted.title || "Untitled Release"}” deleted.`,
      });
    }

    if (intent === "reopen-draft") {
      if (!["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"].includes(release.status)) return Response.json({ ok: false, error: "This release does not need to be reopened." }, { status: 409 });
      await db.$transaction([
        db.release.update({ where: { id: release.id }, data: { status: "DRAFT", reviewStartedAt: null, decisionAt: null, distributionStatus: "NOT_QUEUED", distributionUpdatedAt: new Date() } }),
        db.submissionEvent.create({ data: { releaseId: release.id, type: "REOPENED", message: "Release returned to draft by an administrator.", actorLabel: "Shopify admin", fromStatus: release.status, toStatus: "DRAFT" } }),
      ]);
      return Response.json({ ok: true, message: "Release reopened as a draft." });
    }

    if (intent === "update-isrc") {
      const trackId = String(formData.get("trackId") || "");
      const track = release.tracks.find((item) => item.id === trackId);
      if (!track) {
        return Response.json(
          { ok: false, error: "That track could not be found in this release." },
          { status: 404 },
        );
      }
      const value = String(formData.get("isrc") || "").trim();
      if (!value) {
        return Response.json(
          { ok: false, error: "Enter the existing ISRC for this recording." },
          { status: 400 },
        );
      }
      const result = await correctIsrcForTrack({
        trackId: track.id,
        shop: session.shop,
        value,
        actorLabel: "Shopify admin",
      });
      return Response.json({
        ok: true,
        message: result.corrected
          ? `ISRC corrected to ${result.code}.`
          : `ISRC saved as ${result.code}.`,
      });
    }

    if (
      intent !== "update-credit" &&
      !WORKFLOW_INTENTS.has(intent) &&
      !releaseIsEditable(release.status)
    ) {
      return Response.json({ ok: false, error: "This release is locked while it is submitted, under review, approved, or rejected. Reopen it or request changes before editing metadata." }, { status: 409 });
    }

    if (intent === "update-release") {
      const title = String(formData.get("title") || "").trim() || "Untitled Release";
      const primaryGenre = String(formData.get("primaryGenre") || "").trim() || null;
      const dateValue = String(formData.get("releaseDate") || "").trim();
      const releaseDate = dateValue ? new Date(`${dateValue}T12:00:00.000Z`) : null;
      const timeline = parseReleaseTimelineFormData(formData, {
        releaseDate,
      });
      const preSaveUrl = String(formData.get("preSaveUrl") || "").trim() || null;
      const streamingUrl = String(formData.get("streamingUrl") || "").trim() || null;
      for (const [label, value] of [["Pre-save URL", preSaveUrl], ["Streaming URL", streamingUrl]]) {
        if (value) {
          try {
            const parsed = new URL(value);
            if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
          } catch {
            return Response.json({ ok: false, error: `${label} must be a valid http or https URL.` }, { status: 400 });
          }
        }
      }
      await db.release.update({ where: { id: release.id }, data: { ...timeline, title, primaryGenre, releaseDate, preSaveUrl, streamingUrl } });
      return Response.json({ ok: true, message: "Release details saved." });
    }

    if (intent === "add-release-artist") {
      const artistId = String(formData.get("artistId") || "");
      const role = String(formData.get("role") || "PRIMARY").toUpperCase();
      if (!ARTIST_ROLES.includes(role)) return Response.json({ok:false,error:"Invalid artist role."},{status:400});
      const artist = await findShopArtist(session.shop, artistId);
      if (!artist) return Response.json({ok:false,error:"Artist not found in this store."},{status:404});
      const exists = await db.releaseArtist.findFirst({where:{releaseId:release.id,artistId,role}});
      if (!exists) {
        const count = await db.releaseArtist.count({where:{releaseId:release.id}});
        await db.releaseArtist.create({data:{releaseId:release.id,artistId,role,position:count+1}});
      }
      await syncReleaseArtistName(release.id, session.shop);
      return Response.json({ok:true,message:`${artist.name} added to the release.`});
    }

    if (intent === "update-release-artist") {
      const assignmentId=String(formData.get("assignmentId")||"");
      const role=String(formData.get("role")||"PRIMARY").toUpperCase();
      if (!ARTIST_ROLES.includes(role)) return Response.json({ok:false,error:"Invalid artist role."},{status:400});
      const assignment=await db.releaseArtist.findFirst({where:{id:assignmentId,releaseId:release.id}});
      if (!assignment) return Response.json({ok:false,error:"Release artist assignment not found."},{status:404});
      await db.releaseArtist.update({where:{id:assignment.id},data:{role}});
      await syncReleaseArtistName(release.id, session.shop);
      return Response.json({ok:true,message:"Release artist updated."});
    }

    if (intent === "remove-release-artist") {
      const assignmentId=String(formData.get("assignmentId")||"");
      const assignment=await db.releaseArtist.findFirst({where:{id:assignmentId,releaseId:release.id}});
      if (!assignment) return Response.json({ok:false,error:"Release artist assignment not found."},{status:404});
      await db.releaseArtist.delete({where:{id:assignment.id}});
      await syncReleaseArtistName(release.id, session.shop);
      return Response.json({ok:true,message:"Artist removed from the release."});
    }

    if (intent === "assign-missing-isrcs") {
      const settings = await db.appSettings.findUnique({
        where: { shop: session.shop },
      });
      if (isrcAssignmentMode(settings) !== "AUTO") {
        return Response.json(
          {
            ok: false,
            error:
              "ISRCs are currently provided in the Distribution workspace.",
          },
          { status: 409 },
        );
      }
      const assigned = await assignMissingIsrcsForRelease({ releaseId: release.id, shop: session.shop });
      return Response.json({
        ok: true,
        message: assigned
          ? `${assigned} ISRC${assigned === 1 ? " was" : "s were"} assigned to this release.`
          : "Every track on this release already has an ISRC.",
      });
    }

    if (intent === "add-track") {
      if (release.type === "SINGLE" && release.tracks.length >= 1) {
        return Response.json({ ok: false, error: "A Single supports one track. Choose EP or Album for a multi-track release." }, { status: 400 });
      }
      const maxPosition = release.tracks.reduce((max, track) => Math.max(max, track.position), 0);
      const settings = await db.appSettings.findUnique({ where: { shop: session.shop } });
      const createdTrack = await db.$transaction(async (tx) => {
        const track = await tx.track.create({
          data: {
            releaseId: release.id,
            position: maxPosition + 1,
            title: "Untitled Track",
            language: settings?.defaultLanguage || null,
          },
        });
        await tx.release.update({
          where: { id: release.id },
          data: { updatedAt: new Date() },
        });
        return track;
      });
      try {
        await maybeAutoAssignIsrc({ trackId: createdTrack.id, shop: session.shop });
      } catch (isrcError) {
        console.error("ReleaseCore: automatic ISRC assignment skipped for new track", isrcError);
      }
      return Response.json({ ok: true, message: "Track added." });
    }

    const trackId = String(formData.get("trackId") || "");
    const track = release.tracks.find((item) => item.id === trackId);
    if (!track) return Response.json({ ok: false, error: "That track could not be found in this release." }, { status: 404 });

    if (intent === "update-track") {
      const title = String(formData.get("title") || "").trim() || "Untitled Track";
      const version = String(formData.get("version") || "").trim() || null;
      const language = String(formData.get("language") || "").trim() || null;
      const explicit = formData.get("explicit") === "on";
      await db.$transaction([
        db.track.update({ where: { id: track.id }, data: { title, version, language, explicit } }),
        db.release.update({ where: { id: release.id }, data: { updatedAt: new Date() } }),
      ]);
      return Response.json({ ok: true, message: `Track ${track.position} saved.` });
    }

    if (intent === "add-track-artist") {
      const artistId=String(formData.get("artistId")||"");
      const role=String(formData.get("role")||"PRIMARY").toUpperCase();
      if (!ARTIST_ROLES.includes(role)) return Response.json({ok:false,error:"Invalid artist role."},{status:400});
      const artist=await db.artist.findFirst({where:{id:artistId,shop:session.shop}});
      if (!artist) return Response.json({ok:false,error:"Artist not found in this store."},{status:404});
      const exists=await db.trackArtist.findFirst({where:{trackId:track.id,artistId,role}});
      if (!exists) {
        const count=await db.trackArtist.count({where:{trackId:track.id}});
        await db.trackArtist.create({data:{trackId:track.id,artistId,role,position:count+1}});
      }
      return Response.json({ok:true,message:`${artist.name} added to Track ${track.position}.`});
    }

    if (intent === "update-track-artist") {
      const assignmentId=String(formData.get("assignmentId")||"");
      const role=String(formData.get("role")||"PRIMARY").toUpperCase();
      if (!ARTIST_ROLES.includes(role)) return Response.json({ok:false,error:"Invalid artist role."},{status:400});
      const assignment=await db.trackArtist.findFirst({where:{id:assignmentId,trackId:track.id}});
      if (!assignment) return Response.json({ok:false,error:"Track artist assignment not found."},{status:404});
      await db.trackArtist.update({where:{id:assignment.id},data:{role}});
      return Response.json({ok:true,message:"Track artist role updated."});
    }

    if (intent === "remove-track-artist") {
      const assignmentId=String(formData.get("assignmentId")||"");
      const assignment=await db.trackArtist.findFirst({where:{id:assignmentId,trackId:track.id}});
      if (!assignment) return Response.json({ok:false,error:"Track artist assignment not found."},{status:404});
      await db.trackArtist.delete({where:{id:assignment.id}});
      return Response.json({ok:true,message:"Artist removed from track."});
    }

    if (intent === "add-credit") {
      const contributorId=String(formData.get("contributorId")||"");
      const role=String(formData.get("role")||"").toUpperCase();
      if (!CREDIT_ROLES.includes(role)) return Response.json({ok:false,error:"Choose a valid credit role."},{status:400});
      const contributor=await findShopContributor(session.shop, contributorId);
      if (!contributor) return Response.json({ok:false,error:"Contributor not found in this store."},{status:404});
      const creditSplitsEnabled = appSettings?.requirePublishing ?? true;
      let ownershipPercent = creditSplitsEnabled
        ? parseOwnership(formData.get("ownershipPercent"))
        : null;
      if (!creditSplitsEnabled || !isPublishingRole(role)) ownershipPercent = null;
      if (creditSplitsEnabled && isPublishingRole(role)) {
        await assertPublishingTotal(track.id, ownershipPercent);
      }
      const exists=await db.trackCredit.findFirst({where:{trackId:track.id,contributorId,role}});
      if (exists) return Response.json({ok:false,error:"That contributor already has this role on the track."},{status:400});
      await db.trackCredit.create({data:{trackId:track.id,contributorId,role,ownershipPercent}});
      return Response.json({ok:true,message:`${contributor.stageName || contributor.legalName} credited on Track ${track.position}.`});
    }

    if (intent === "update-credit") {
      const creditId=String(formData.get("creditId")||"");
      const role=String(formData.get("role")||"").toUpperCase();
      if (!CREDIT_ROLES.includes(role)) return Response.json({ok:false,error:"Choose a valid credit role."},{status:400});
      const credit=await db.trackCredit.findFirst({where:{id:creditId,trackId:track.id}});
      if (!credit) return Response.json({ok:false,error:"Track credit not found."},{status:404});
      const creditSplitsEnabled = appSettings?.requirePublishing ?? true;
      let ownershipPercent = creditSplitsEnabled
        ? parseOwnership(formData.get("ownershipPercent"))
        : null;
      if (!creditSplitsEnabled || !isPublishingRole(role)) ownershipPercent = null;
      if (creditSplitsEnabled && isPublishingRole(role)) {
        await assertPublishingTotal(
          track.id,
          ownershipPercent,
          credit.id,
        );
      }
      await db.trackCredit.update({
        where: { id: credit.id },
        data: { role, ownershipPercent },
      });
      return Response.json({ok:true,message:"Credit updated."});
    }

    if (intent === "remove-credit") {
      const creditId=String(formData.get("creditId")||"");
      const credit=await db.trackCredit.findFirst({where:{id:creditId,trackId:track.id}});
      if (!credit) return Response.json({ok:false,error:"Track credit not found."},{status:404});
      await db.trackCredit.delete({where:{id:credit.id}});
      return Response.json({ok:true,message:"Credit removed."});
    }

    if (intent === "update-lyrics") {
      const lyrics = String(formData.get("lyrics") || "").trim() || null;
      await db.$transaction([
        db.track.update({ where: { id: track.id }, data: { lyrics } }),
        db.release.update({ where: { id: release.id }, data: { updatedAt: new Date() } }),
      ]);
      return Response.json({ ok: true, message: `Lyrics for Track ${track.position} saved.` });
    }

    if (intent === "move-up" || intent === "move-down") {
      const goingUp = intent === "move-up";
      const neighbor = goingUp ? [...release.tracks].reverse().find((item) => item.position < track.position) : release.tracks.find((item) => item.position > track.position);
      if (!neighbor) return Response.json({ ok: true, message: "Track is already at the end of the sequence." });
      await db.$transaction(async (tx) => {
        await tx.track.update({ where: { id: track.id }, data: { position: 0 } });
        await tx.track.update({ where: { id: neighbor.id }, data: { position: track.position } });
        await tx.track.update({ where: { id: track.id }, data: { position: neighbor.position } });
        await tx.release.update({ where: { id: release.id }, data: { updatedAt: new Date() } });
      });
      return Response.json({ ok: true, message: "Track order updated." });
    }

    return Response.json({ ok: false, error: "Unknown release action." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(request, error, { context: "release mutation", fallback: "ReleaseCore could not save this change." });
  }
};
