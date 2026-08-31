import { authenticate } from "../shopify.server";
import db from "../db.server";
import { isValidReleaseType, starterTitle, typeLabel } from "../lib/releasecore";
import { maybeAutoAssignIsrc } from "../lib/isrc.server";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed." }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const formData = await request.formData();
    const type = String(formData.get("type") || "").toUpperCase();
    const requestedTitle = String(formData.get("title") || "").trim();

    if (!isValidReleaseType(type)) {
      return Response.json(
        { ok: false, error: "Choose Single, EP or Album before creating the release." },
        { status: 400 },
      );
    }

    const title = requestedTitle || starterTitle(type);
    const firstTrackTitle =
      type === "SINGLE" && requestedTitle ? requestedTitle : "Untitled Track";

    const settings = await db.appSettings.findUnique({ where: { shop: session.shop } });

    const release = await db.release.create({
      data: {
        shop: session.shop,
        type,
        title,
        status: "DRAFT",
        primaryGenre: settings?.defaultGenre || null,
        tracks: {
          create: {
            position: 1,
            title: firstTrackTitle,
            language: settings?.defaultLanguage || null,
          },
        },
        events: {
          create: {
            type: "DRAFT_CREATED",
            message: `${typeLabel(type)} draft created`,
          },
        },
      },
      include: { tracks: true },
    });

    const firstTrack = release.tracks[0];
    if (firstTrack) {
      try {
        await maybeAutoAssignIsrc({ trackId: firstTrack.id, shop: session.shop });
      } catch (isrcError) {
        console.error("ReleaseCore: automatic ISRC assignment skipped during release creation", isrcError);
      }
    }

    return Response.json({ ok: true, releaseId: release.id });
  } catch (error) {
    console.error("ReleaseCore: create release failed", error);
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? `ReleaseCore could not create the draft: ${error.message}`
            : "ReleaseCore could not create the draft.",
      },
      { status: 500 },
    );
  }
};
