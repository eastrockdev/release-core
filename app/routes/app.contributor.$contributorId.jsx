import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { contributorDisplayName, PRO_OPTIONS } from "../lib/releasecore";
import { contributorIdentityProtection } from "../lib/identity-protection.server";
import { ArtistAvatar, CollapsibleSection, PageIntro, SectionIcon } from "../components/releasecore-ui";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const contributor = await db.contributor.findFirst({ where: { id: params.contributorId, shop: session.shop }, include: { artists: { include: { artist: true } }, _count: { select: { credits: true } } } });
  if (!contributor) throw new Response("Contributor not found.", { status: 404 });
  const protection = await contributorIdentityProtection({ shop: session.shop, contributorId: contributor.id });
  return { contributor, protection };
};
const Field = ({ label, help, children }) => <label className="rc-field"><span className="rc-field__label">{label}</span>{children}{help ? <span className="rc-field__help">{help}</span> : null}</label>;

export default function ContributorProfilePage() {
  const { contributor, protection } = useLoaderData(); const shopify = useAppBridge(); const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null);
  const save = async (event) => { event.preventDefault(); if (busy) return; setBusy(true); setNotice(null); try { const form = new FormData(event.currentTarget); form.set("intent", "update"); form.set("contributorId", contributor.id); const result = await authenticatedPost(shopify, "/api/contributors", form); setNotice({ good: true, text: result.message }); shopify.toast.show("Contributor saved"); await revalidator.revalidate(); } catch (error) { setNotice({ good: false, text: error instanceof Error ? error.message : "Could not save contributor." }); } finally { setBusy(false); } };
  return <s-page heading={contributorDisplayName(contributor)}>
    <s-button slot="secondary-actions" onClick={() => history.back()}>Back</s-button>
    <s-section><div className="rc-profile-hero"><SectionIcon name="contributor" /><PageIntro eyebrow="Contributor profile" title={contributorDisplayName(contributor)}>{contributor._count.credits} track credits · linked to {contributor.artists.length} artists</PageIntro></div></s-section>
    {notice ? <s-section><div className={`rc-notice ${notice.good ? "rc-notice--good" : "rc-notice--bad"}`}>{notice.text}</div></s-section> : null}
    <CollapsibleSection icon="contributor" title="Contributor identity" description="Rights, publishing, and contact information used in track credits." defaultOpen>
      {protection.identityLocked ? <div className="rc-notice">Identity and publishing fields are locked because this contributor appears on a submitted release. To make a verified correction, disable contributor identity protection in Settings first.</div> : null}
      <form className="rc-form" onSubmit={save}><div className="rc-form-grid">
        <Field label="Legal name"><input name="legalName" required readOnly={protection.identityLocked} defaultValue={contributor.legalName} /></Field>
        <Field label="Stage / display name"><input name="stageName" readOnly={protection.identityLocked} defaultValue={contributor.stageName || ""} /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={contributor.email || ""} /></Field>
        <Field label="Performing rights organization"><select name="pro" disabled={protection.identityLocked} defaultValue={contributor.pro || ""}><option value="">Not set</option>{PRO_OPTIONS.map((pro) => <option key={pro}>{pro}</option>)}</select>{protection.identityLocked ? <input type="hidden" name="pro" value={contributor.pro || ""} /> : null}</Field>
        <Field label="IPI / CAE number"><input name="ipi" readOnly={protection.identityLocked} defaultValue={contributor.ipi || ""} inputMode="numeric" /></Field>
        <Field label="Publisher"><input name="publisherName" readOnly={protection.identityLocked} defaultValue={contributor.publisherName || ""} /></Field>
      </div><Field label="Internal notes"><textarea name="notes" rows={4} defaultValue={contributor.notes || ""} /></Field><div className="rc-form-actions"><button className="rc-button rc-button--primary" disabled={busy}>{busy ? "Saving…" : "Save contributor"}</button></div></form>
    </CollapsibleSection>
    <CollapsibleSection icon="artist" title="Linked artists" description="These relationships make this contributor easier to find on releases for the artist." summary={`${contributor.artists.length} linked`} defaultOpen>
      {contributor.artists.length ? <div className="rc-directory-list">{contributor.artists.map(({ artist }) => <Link className="rc-directory-row" key={artist.id} to={`/app/artist/${artist.id}`}><ArtistAvatar artist={artist} /><div><strong>{artist.name}</strong><div className="rc-directory-row__meta">Open the artist profile to manage this relationship.</div></div><span className="rc-directory-row__aside">Open artist →</span></Link>)}</div> : <p className="rc-section-copy">Not linked to an artist yet. Open an artist profile to add this contributor.</p>}
    </CollapsibleSection>
    <CollapsibleSection
      icon="checklist"
      title="Data maintenance"
      description="Merge duplicate contributor identities or review this contributor in the catalog-integrity workspace."
      summary="Admin only"
    >
      <p className="rc-section-copy">Contributor merging keeps one identity and moves compatible track credits and artist relationships into it. Publishing conflicts must be resolved explicitly.</p>
      <div className="rc-form-actions">
        <Link className="rc-button rc-button--secondary" to={`/app/data-hygiene?contributorSource=${contributor.id}`}>Review merge / maintenance</Link>
      </div>
    </CollapsibleSection>
  </s-page>;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
