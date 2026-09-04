import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { uploadMultipartTarget } from "../lib/upload-file";
import { contributorDisplayName, PRO_OPTIONS } from "../lib/releasecore";
import { getShopifyArtistCollection, listShopifyArtistCollections } from "../lib/shopify-artist-collections.server";
import { ArtistAvatar, CollapsibleSection, PageIntro } from "../components/releasecore-ui";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const loadShopify =
    url.searchParams.get("shopify") === "1";

  const [artist, contributors] = await Promise.all([
    db.artist.findFirst({
      where: { id: params.artistId, shop: session.shop },
      include: {
        contributors: {
          include: { contributor: true },
          orderBy: { createdAt: "asc" },
        },
        _count: {
          select: { releases: true, tracks: true },
        },
      },
    }),
    db.contributor.findMany({
      where: { shop: session.shop },
      orderBy: { legalName: "asc" },
    }),
  ]);

  if (!artist) {
    throw new Response("Artist not found.", {
      status: 404,
    });
  }

  const [
    shopifyCollection,
    collectionCandidates,
  ] = loadShopify
    ? await Promise.all([
        artist.shopifyCollectionId
          ? getShopifyArtistCollection(
              admin,
              artist.shopifyCollectionId,
            )
          : Promise.resolve(null),
        Promise.all([
          listShopifyArtistCollections(admin),
          db.artist.findMany({
            where: {
              shop: session.shop,
              shopifyCollectionId: { not: null },
              id: { not: artist.id },
            },
            select: {
              shopifyCollectionId: true,
            },
          }),
        ]).then(([collections, linkedCollections]) => {
          const linkedCollectionIds = new Set(
            linkedCollections
              .map(
                (item) =>
                  item.shopifyCollectionId,
              )
              .filter(Boolean),
          );

          return collections.filter(
            (collection) =>
              collection.id ===
                artist.shopifyCollectionId ||
              !linkedCollectionIds.has(
                collection.id,
              ),
          );
        }),
      ])
    : [
        artist.shopifyCollectionId
          ? {
              id: artist.shopifyCollectionId,
              title: artist.name,
              handle:
                artist.shopifyCollectionHandle ||
                "",
            }
          : null,
        [],
      ];

  return {
    artist,
    contributors,
    shopifyCollection,
    collectionCandidates,
    shopifyLoaded: loadShopify,
  };
};

const Field = ({ label, help, children }) => <label className="rc-field"><span className="rc-field__label">{label}</span>{children}{help ? <span className="rc-field__help">{help}</span> : null}</label>;

export default function ArtistProfilePage() {
  const { artist, contributors, shopifyCollection, collectionCandidates, shopifyLoaded } = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const linkedIds = new Set(artist.contributors.map((item) => item.contributorId));
  const available = contributors.filter((item) => !linkedIds.has(item.id));

  const post = async (form) => {
    if (busy) return null; setBusy(true); setNotice(null);
    try {
      const result = await authenticatedPost(shopify, "/api/artists", form);
      setNotice({ good: true, text: result.message || "Artist updated." }); shopify.toast.show(result.message || "Artist updated");
      await revalidator.revalidate(); return result;
    } catch (error) { setNotice({ good: false, text: error instanceof Error ? error.message : "Could not update artist." }); return null; }
    finally { setBusy(false); }
  };
  const save = (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set("intent", "update"); form.set("artistId", artist.id); return post(form); };
  const relationship = (intent, contributorId) => { const form = new FormData(); form.set("intent", intent); form.set("artistId", artist.id); form.set("contributorId", contributorId); return post(form); };
  const collectionAction = (intent, collectionId = "") => {
    const form = new FormData();
    form.set("intent", intent);
    form.set("artistId", artist.id);
    if (collectionId) form.set("collectionId", collectionId);
    return post(form);
  };
  const uploadImage = async (event) => {
    const file = event.target.files?.[0]; if (!file || busy) return;
    setBusy(true); setNotice(null);
    try {
      const stage = new FormData(); stage.set("intent", "stage-image"); stage.set("artistId", artist.id); stage.set("filename", file.name); stage.set("mimeType", file.type); stage.set("sizeBytes", String(file.size));
      const prepared = await authenticatedPost(shopify, "/api/artists", stage);
      await uploadMultipartTarget(prepared.target, file);
      const complete = new FormData(); complete.set("intent", "complete-image"); complete.set("artistId", artist.id); complete.set("resourceUrl", prepared.target.resourceUrl);
      await authenticatedPost(shopify, "/api/artists", complete);
      shopify.toast.show("Artist image updated"); await revalidator.revalidate();
    } catch (error) { setNotice({ good: false, text: error instanceof Error ? error.message : "Could not upload artist image." }); }
    finally { setBusy(false); event.target.value = ""; }
  };

  return <s-page heading={artist.name}>
    <s-button slot="secondary-actions" onClick={() => history.back()}>Back</s-button>
    <s-section><div className="rc-profile-hero"><ArtistAvatar artist={artist} size="large" /><PageIntro eyebrow="Artist profile" title={artist.name}>{artist._count.releases} release assignments · {artist._count.tracks} track assignments · {artist.contributors.length} regular contributors</PageIntro></div></s-section>
    {notice ? <s-section><div className={`rc-notice ${notice.good ? "rc-notice--good" : "rc-notice--bad"}`}>{notice.text}</div></s-section> : null}
    <CollapsibleSection icon="artist" title="Identity and profile" description="Core identity, rights information, image, and public biography." summary={artist.imageUrl ? "Image ready" : "Image needed"} defaultOpen>
      <form className="rc-form" onSubmit={save}>
        <div className="rc-profile-image-control"><ArtistAvatar artist={artist} size="large" /><div className="rc-profile-image-content"><strong>Artist photo</strong><p>Square JPG, PNG, or WebP, up to 10 MB. It displays as a circular avatar in ReleaseCore.</p><label className="rc-button rc-profile-upload-button">{busy ? "Uploading…" : "Upload image"}<input className="rc-profile-upload-input" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={uploadImage} hidden disabled={busy} /></label></div></div>
        <div className="rc-form-grid">
          <Field label="Artist / stage name"><input name="name" required defaultValue={artist.name} /></Field>
          <Field label="Legal name"><input name="legalName" defaultValue={artist.legalName || ""} /></Field>
          <Field label="Email"><input name="email" type="email" defaultValue={artist.email || ""} /></Field>
          <Field label="Performing rights organization"><select name="pro" defaultValue={artist.pro || ""}><option value="">Not set</option>{PRO_OPTIONS.map((pro) => <option key={pro}>{pro}</option>)}</select></Field>
          <Field label="IPI / CAE number"><input name="ipi" defaultValue={artist.ipi || ""} inputMode="numeric" /></Field>
          <Field label="Website"><input name="websiteUrl" type="url" defaultValue={artist.websiteUrl || ""} placeholder="https://" /></Field>
        </div>
        <Field label="Biography" help="Public-facing artist biography for storefront use."><textarea name="biography" rows={6} defaultValue={artist.biography || ""} /></Field>
        <Field label="Internal notes" help="Visible to administrators only."><textarea name="notes" rows={3} defaultValue={artist.notes || ""} /></Field>
        <input type="hidden" name="imageUrl" value={artist.imageUrl || ""} />
        <div className="rc-form-actions"><button className="rc-button rc-button--primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
      </form>
    </CollapsibleSection>

    <CollapsibleSection
      icon="shopify"
      title="Shopify artist collection"
      description="Create or connect this artist's storefront collection and keep ReleaseCore music products synchronized."
      summary={artist.shopifyCollectionId ? (shopifyCollection ? "Linked" : "Needs repair") : "Not linked"}
      defaultOpen
    >
      <div className="rc-form">
        {artist.shopifyCollectionId ? (
          <div className="rc-section-copy">
            <strong>{shopifyCollection?.title || artist.name}</strong>
            <div>
              {shopifyCollection
                ? `/collections/${shopifyCollection.handle}`
                : "The linked Shopify collection is missing. Recreate it to repair the link."}
            </div>

            {artist.shopifyCollectionSyncedAt ? (
              <div>
                Last synced{" "}
                {new Date(
                  artist.shopifyCollectionSyncedAt,
                ).toLocaleString()}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="rc-section-copy">
            Create a new Shopify collection for this artist, or connect an existing collection instead.
          </p>
        )}

        <div className="rc-form-actions">
          <button
            type="button"
            className="rc-button rc-button--primary"
            disabled={busy}
            onClick={() =>
              collectionAction("sync-shopify-collection")
            }
          >
            {busy
              ? "Working…"
              : artist.shopifyCollectionId
                ? shopifyCollection
                  ? "Sync artist collection"
                  : "Recreate artist collection"
                : "Create artist collection"}
          </button>

          {artist.shopifyCollectionId ? (
            <button
              type="button"
              className="rc-button rc-button--tertiary"
              disabled={busy}
              onClick={() =>
                collectionAction("unlink-shopify-collection")
              }
            >
              Disconnect
            </button>
          ) : null}
        </div>

        {collectionCandidates.length ? (
          <div className="rc-relationship-add">
            <select
              className="rc-control"
              defaultValue=""
              aria-label="Shopify collection to link"
            >
              <option value="">
                Choose existing Shopify collection…
              </option>

              {collectionCandidates.map((collection) => (
                <option
                  key={collection.id}
                  value={collection.id}
                >
                  {collection.title} — /collections/{collection.handle}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="rc-button rc-button--secondary"
              disabled={busy}
              onClick={(event) => {
                const select =
                  event.currentTarget.previousElementSibling;

                if (select?.value) {
                  collectionAction(
                    "link-shopify-collection",
                    select.value,
                  );
                }
              }}
            >
              Link existing
            </button>
          </div>
        ) : null}

        <p className="rc-field__help">
          ReleaseCore manages its own catalog membership. Products added manually in Shopify are preserved.
        </p>
        <p className="rc-field__help">
          {shopifyLoaded
            ? "Remote Shopify collection status and existing-collection choices are loaded."
            : "Using ReleaseCore's cached Shopify collection link. Remote collection listing is skipped on normal profile loads."}
          {" "}
          <Link
            to={
              shopifyLoaded
                ? `/app/artist/${artist.id}`
                : `/app/artist/${artist.id}?shopify=1`
            }
          >
            {shopifyLoaded
              ? "Use faster cached view"
              : "Load existing Shopify collections"}
          </Link>
        </p>
      </div>
    </CollapsibleSection>

    <CollapsibleSection icon="shopify" title="Music and social links" description="Keep artist destinations consistent across profiles and storefront experiences." summary={[artist.spotifyUrl, artist.appleMusicUrl, artist.instagramUrl, artist.facebookUrl, artist.tiktokUrl, artist.youtubeUrl, artist.xUrl].filter(Boolean).length + " connected"}>
      <form className="rc-form" onSubmit={save}>
        <input type="hidden" name="name" value={artist.name} />
        <div className="rc-form-grid">
          <Field label="Spotify artist URL"><input name="spotifyUrl" type="url" defaultValue={artist.spotifyUrl || ""} placeholder="https://open.spotify.com/artist/…" /></Field>
          <Field label="Apple Music artist URL"><input name="appleMusicUrl" type="url" defaultValue={artist.appleMusicUrl || ""} placeholder="https://music.apple.com/…" /></Field>
          <Field label="Instagram"><input name="instagramUrl" type="url" defaultValue={artist.instagramUrl || ""} placeholder="https://instagram.com/…" /></Field>
          <Field label="Facebook"><input name="facebookUrl" type="url" defaultValue={artist.facebookUrl || ""} placeholder="https://facebook.com/…" /></Field>
          <Field label="TikTok"><input name="tiktokUrl" type="url" defaultValue={artist.tiktokUrl || ""} placeholder="https://tiktok.com/@…" /></Field>
          <Field label="YouTube"><input name="youtubeUrl" type="url" defaultValue={artist.youtubeUrl || ""} placeholder="https://youtube.com/@…" /></Field>
          <Field label="X / Twitter"><input name="xUrl" type="url" defaultValue={artist.xUrl || ""} placeholder="https://x.com/…" /></Field>
        </div><div className="rc-form-actions"><button className="rc-button rc-button--primary" disabled={busy}>Save links</button></div>
      </form>
    </CollapsibleSection>
    <CollapsibleSection icon="contributor" title="Regular contributors" description="Linked contributors are promoted whenever this artist is assigned to a track." summary={`${artist.contributors.length} linked`} defaultOpen>
      <div className="rc-relationship-list">{artist.contributors.map(({ contributor }) => <div key={contributor.id} className="rc-relationship-row"><div><Link to={`/app/contributor/${contributor.id}`}><strong>{contributorDisplayName(contributor)}</strong></Link><span>{contributor.legalName}{contributor.pro ? ` · ${contributor.pro}` : ""}</span></div><button className="rc-button rc-button--danger" type="button" disabled={busy} onClick={() => relationship("unlink-contributor", contributor.id)}>Unlink</button></div>)}</div>
      {available.length ? <div className="rc-relationship-add"><select className="rc-control" defaultValue="" aria-label="Contributor to link"><option value="">Choose contributor…</option>{available.map((contributor) => <option key={contributor.id} value={contributor.id}>{contributorDisplayName(contributor)} — {contributor.legalName}</option>)}</select><button type="button" className="rc-button rc-button--primary" disabled={busy} onClick={(event) => { const select = event.currentTarget.previousElementSibling; if (select.value) relationship("link-contributor", select.value); }}>Link contributor</button></div> : <p className="rc-section-copy">All contributors are already linked. <Link to="/app/contributors">Create another contributor</Link>.</p>}
    </CollapsibleSection>
    <CollapsibleSection
      icon="checklist"
      title="Data maintenance"
      description="Merge duplicate artist identities or review this artist in the catalog-integrity workspace."
      summary="Admin only"
    >
      <p className="rc-section-copy">Merging keeps one artist record and moves compatible release, track, portal-access, contributor, and storefront relationships into it.</p>
      <div className="rc-form-actions">
        <Link className="rc-button rc-button--secondary" to={`/app/data-hygiene?artistSource=${artist.id}`}>Review merge / maintenance</Link>
      </div>
    </CollapsibleSection>
  </s-page>;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
