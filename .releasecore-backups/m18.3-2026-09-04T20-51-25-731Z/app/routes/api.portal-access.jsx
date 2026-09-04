import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  customerNumericId,
  getShopifyCustomer,
} from "../lib/automations.server";
import { apiErrorResponse } from "../lib/http-security.server";
import { findShopArtist, findShopRelease } from "../lib/tenant-db.server";
import {
  customerCanManageMultipleArtists,
  portalMultiArtistTag,
} from "../lib/portal-access-rules.server";

function uniqueIds(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed." },
      { status: 405 },
    );
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "");

    if (intent === "save-artist-access") {
      const customerId = customerNumericId(form.get("customerId"));
      if (!customerId) {
        return Response.json(
          { ok: false, error: "Choose a valid Shopify customer." },
          { status: 400 },
        );
      }

      const customer = await getShopifyCustomer(admin, customerId);
      if (!customer) {
        return Response.json(
          { ok: false, error: "Shopify customer not found." },
          { status: 404 },
        );
      }

      const artistIds = uniqueIds(form.getAll("artistId"));
      const multiAllowed = customerCanManageMultipleArtists(customer.tags);

      if (!multiAllowed && artistIds.length > 1) {
        return Response.json(
          {
            ok: false,
            error: `Add the ${portalMultiArtistTag()} Shopify customer tag before assigning more than one artist.`,
          },
          { status: 409 },
        );
      }

      const artists = artistIds.length
        ? await db.artist.findMany({
            where: {
              shop: session.shop,
              id: { in: artistIds },
            },
            select: { id: true },
          })
        : [];

      if (artists.length !== artistIds.length) {
        return Response.json(
          {
            ok: false,
            error: "One or more selected artists do not belong to this shop.",
          },
          { status: 400 },
        );
      }

      const validIds = artists.map((artist) => artist.id);

      await db.$transaction(async (tx) => {
        await tx.portalArtistAccess.deleteMany({
          where: {
            shop: session.shop,
            customerId,
          },
        });

        if (validIds.length) {
          await tx.portalArtistAccess.createMany({
            data: validIds.map((artistId) => ({
              shop: session.shop,
              customerId,
              artistId,
              role: "OWNER",
            })),
            skipDuplicates: true,
          });
        }

        await tx.portalCustomerPolicy.upsert({
          where: {
            shop_customerId: {
              shop: session.shop,
              customerId,
            },
          },
          create: {
            shop: session.shop,
            customerId,
            artistMode: multiAllowed ? "MULTI" : "SOLO",
            soloArtistId: multiAllowed ? null : validIds[0] || null,
          },
          update: {
            artistMode: multiAllowed ? "MULTI" : "SOLO",
            soloArtistId: multiAllowed ? null : validIds[0] || null,
          },
        });
      });

      return Response.json({
        ok: true,
        message: validIds.length
          ? `Artist access saved for ${validIds.length} artist${validIds.length === 1 ? "" : "s"}.`
          : "Artist access cleared.",
      });
    }

    // Backward-compatible mutation used by older cached admin sessions.
    if (intent === "save-customer-policy") {
      const customerId = customerNumericId(form.get("customerId"));
      if (!customerId) {
        return Response.json(
          { ok: false, error: "Choose a valid Shopify customer." },
          { status: 400 },
        );
      }

      const customer = await getShopifyCustomer(admin, customerId);
      if (!customer) {
        return Response.json(
          { ok: false, error: "Shopify customer not found." },
          { status: 404 },
        );
      }

      const artistMode =
        String(form.get("artistMode") || "MULTI").toUpperCase() === "SOLO"
          ? "SOLO"
          : "MULTI";
      const soloArtistId =
        artistMode === "SOLO"
          ? String(form.get("soloArtistId") || "").trim()
          : null;

      if (artistMode === "SOLO") {
        const artist = soloArtistId
          ? await findShopArtist(session.shop, soloArtistId)
          : null;
        if (!artist) {
          return Response.json(
            {
              ok: false,
              error:
                "Choose the artist identity this customer is allowed to submit for.",
            },
            { status: 400 },
          );
        }

        await db.portalArtistAccess.upsert({
          where: {
            shop_customerId_artistId: {
              shop: session.shop,
              customerId,
              artistId: artist.id,
            },
          },
          create: {
            shop: session.shop,
            customerId,
            artistId: artist.id,
            role: "OWNER",
          },
          update: {},
        });
      }

      await db.portalCustomerPolicy.upsert({
        where: {
          shop_customerId: {
            shop: session.shop,
            customerId,
          },
        },
        create: {
          shop: session.shop,
          customerId,
          artistMode,
          soloArtistId,
        },
        update: {
          artistMode,
          soloArtistId,
        },
      });

      return Response.json({
        ok: true,
        message:
          artistMode === "SOLO"
            ? "Customer locked to the selected solo artist."
            : "Customer policy saved.",
      });
    }

    if (intent !== "assign-owner") {
      return Response.json(
        { ok: false, error: "Unknown portal access action." },
        { status: 400 },
      );
    }

    const releaseId = String(form.get("releaseId") || "");
    const release = await findShopRelease(session.shop, releaseId, {
      include: { artists: true },
    });
    if (!release) {
      return Response.json(
        { ok: false, error: "Release not found." },
        { status: 404 },
      );
    }

    const raw = String(form.get("customerId") || "").trim();
    let ownerCustomerId = null;
    let ownerCustomer = null;

    if (raw) {
      ownerCustomerId = customerNumericId(raw);
      ownerCustomer = await getShopifyCustomer(admin, ownerCustomerId);
      if (!ownerCustomer) {
        return Response.json(
          { ok: false, error: "Shopify customer not found." },
          { status: 404 },
        );
      }
    }

    const primaryArtistIds = uniqueIds(
      release.artists
        .filter((item) => item.role === "PRIMARY")
        .map((item) => item.artistId),
    );

    await db.$transaction(async (tx) => {
      await tx.release.updateMany({
        where: {
          id: release.id,
          shop: session.shop,
        },
        data: { ownerCustomerId },
      });

      if (ownerCustomerId && primaryArtistIds.length) {
        const multiAllowed = customerCanManageMultipleArtists(
          ownerCustomer?.tags || [],
        );

        if (multiAllowed) {
          for (const artistId of primaryArtistIds) {
            await tx.portalArtistAccess.upsert({
              where: {
                shop_customerId_artistId: {
                  shop: session.shop,
                  customerId: ownerCustomerId,
                  artistId,
                },
              },
              create: {
                shop: session.shop,
                customerId: ownerCustomerId,
                artistId,
                role: "OWNER",
              },
              update: {},
            });
          }
        } else {
          const existing = await tx.portalArtistAccess.findFirst({
            where: {
              shop: session.shop,
              customerId: ownerCustomerId,
            },
            select: { id: true },
          });

          if (!existing) {
            await tx.portalArtistAccess.upsert({
              where: {
                shop_customerId_artistId: {
                  shop: session.shop,
                  customerId: ownerCustomerId,
                  artistId: primaryArtistIds[0],
                },
              },
              create: {
                shop: session.shop,
                customerId: ownerCustomerId,
                artistId: primaryArtistIds[0],
                role: "OWNER",
              },
              update: {},
            });
          }
        }
      }

      await tx.submissionEvent.create({
        data: {
          releaseId: release.id,
          type: ownerCustomerId
            ? "PORTAL_OWNER_ASSIGNED"
            : "PORTAL_OWNER_CLEARED",
          message: ownerCustomerId
            ? `Portal ownership assigned to Shopify customer ${ownerCustomerId}.`
            : "Portal ownership cleared.",
          actorLabel: "Shopify admin",
        },
      });
    });

    return Response.json({
      ok: true,
      message: ownerCustomerId
        ? "Release assigned to the customer portal."
        : "Portal owner cleared.",
    });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "portal access mutation",
      fallback: "Could not update portal access.",
    });
  }
};
