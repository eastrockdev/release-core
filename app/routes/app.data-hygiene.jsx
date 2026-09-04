import { useMemo, useState } from "react";
import { Form, Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { previewArtistMerge, previewContributorMerge, scanDataHygiene } from "../lib/data-hygiene.server";
import { authenticatedPost } from "../lib/authenticated-post";
import { promptSafetyConfirmation } from "../lib/production-safety-client";
import { EmptyState, PageIntro } from "../components/releasecore-ui";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const artistSource = url.searchParams.get("artistSource") || "";
  const artistTarget = url.searchParams.get("artistTarget") || "";
  const contributorSource = url.searchParams.get("contributorSource") || "";
  const contributorTarget = url.searchParams.get("contributorTarget") || "";

  const [scan, artistPreview, contributorPreview] = await Promise.all([
    scanDataHygiene({ shop: session.shop }),
    artistSource && artistTarget
      ? previewArtistMerge({ shop: session.shop, sourceId: artistSource, targetId: artistTarget })
      : Promise.resolve(null),
    contributorSource && contributorTarget
      ? previewContributorMerge({ shop: session.shop, sourceId: contributorSource, targetId: contributorTarget })
      : Promise.resolve(null),
  ]);

  return {
    scan,
    artistPreview,
    contributorPreview,
    selected: { artistSource, artistTarget, contributorSource, contributorTarget },
  };
};

function Metric({ label, value }) {
  return <div className="rc-hygiene-metric"><strong>{value}</strong><span>{label}</span></div>;
}
function SignalList({ signals }) {
  return <span className="rc-hygiene-signals">{signals.join(" · ")}</span>;
}
function contributorName(item) {
  return item.stageName || item.legalName;
}

export default function DataHygienePage() {
  const { scan, artistPreview, contributorPreview, selected } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const totalAttention = useMemo(() =>
    scan.summary.duplicateArtists + scan.summary.duplicateContributors +
    scan.summary.unusedArtists + scan.summary.unusedContributors +
    scan.summary.cacheDrift + scan.summary.tenantIssues + scan.summary.localShopifyIssues,
  [scan.summary]);

  const post = async (data) => {
    if (busy) return null;
    setBusy(true);
    setNotice(null);
    try {
      const result = await authenticatedPost(shopify, "/api/data-hygiene", data);
      setNotice({ good: true, text: result.message || "Maintenance action completed." });
      shopify.toast.show(result.message || "Maintenance action completed");
      return result;
    } catch (error) {
      setNotice({ good: false, text: error instanceof Error ? error.message : "Could not complete maintenance action." });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const mergeArtist = async (event) => {
    event.preventDefault();
    const safetyConfirmation =
      promptSafetyConfirmation({
        phrase: "MERGE ARTIST",
        message: `Merge ${artistPreview.source.name} into ${artistPreview.target.name}? The source ReleaseCore artist record will be removed.`,
      });
    if (!safetyConfirmation) return;
    const data = new FormData(event.currentTarget);
    data.set("intent", "merge-artist");
    data.set("confirmed", "true");
    data.set("safetyConfirmation", safetyConfirmation);
    const result = await post(data);
    if (result?.targetId) navigate(`/app/artist/${result.targetId}`);
  };

  const mergeContributor = async (event) => {
    event.preventDefault();
    const safetyConfirmation =
      promptSafetyConfirmation({
        phrase: "MERGE CONTRIBUTOR",
        message: `Merge ${contributorName(contributorPreview.source)} into ${contributorName(contributorPreview.target)}? The source ReleaseCore contributor record will be removed.`,
      });
    if (!safetyConfirmation) return;
    const data = new FormData(event.currentTarget);
    data.set("intent", "merge-contributor");
    data.set("confirmed", "true");
    data.set("safetyConfirmation", safetyConfirmation);
    const result = await post(data);
    if (result?.targetId) navigate(`/app/contributor/${result.targetId}`);
  };

  const quickAction = async (
    intent,
    fields = {},
    confirmation = "",
    safetyPhrase = "",
  ) => {
    let safetyConfirmation = "";
    if (safetyPhrase) {
      safetyConfirmation =
        promptSafetyConfirmation({
          phrase: safetyPhrase,
          message:
            confirmation ||
            "Confirm this high-impact maintenance action.",
        }) || "";
      if (!safetyConfirmation) return;
    } else if (
      confirmation &&
      !window.confirm(confirmation)
    ) {
      return;
    }
    const data = new FormData();
    data.set("intent", intent);
    if (safetyConfirmation) {
      data.set(
        "safetyConfirmation",
        safetyConfirmation,
      );
    }
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    const result = await post(data);
    if (result) await revalidator.revalidate();
  };

  return <s-page heading="Data Maintenance">
    <s-section><PageIntro eyebrow="M16.6 · Catalog integrity" title="Find duplicates, repair drift, and merge identities safely.">ReleaseCore scans its own database and suggests maintenance work. Nothing is automatically deleted or merged.</PageIntro></s-section>
    {notice ? <s-section><div className={`rc-notice ${notice.good ? "rc-notice--good" : "rc-notice--bad"}`}>{notice.text}</div></s-section> : null}

    <s-section heading="Data health"><div className="rc-hygiene-metrics">
      <Metric label="Artists" value={scan.summary.artists} />
      <Metric label="Contributors" value={scan.summary.contributors} />
      <Metric label="Items to review" value={totalAttention} />
      <Metric label="Cache drift" value={scan.summary.cacheDrift} />
      <Metric label="Tenant issues" value={scan.summary.tenantIssues} />
    </div></s-section>

    <s-section heading="Merge artists">
      <p className="rc-section-copy">Choose the duplicate artist that should disappear, then choose the artist that should survive. Release, track, customer-access, contributor, and solo-portal relationships are moved atomically.</p>
      <Form method="get" className="rc-hygiene-merge-picker">
        <label className="rc-field"><span className="rc-field__label">Merge this artist</span><select className="rc-control" name="artistSource" defaultValue={selected.artistSource} required><option value="">Choose source artist…</option>{scan.artistOptions.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label>
        <label className="rc-field"><span className="rc-field__label">Into this artist</span><select className="rc-control" name="artistTarget" defaultValue={selected.artistTarget} required><option value="">Choose surviving artist…</option>{scan.artistOptions.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></label>
        <button className="rc-button rc-button--secondary" type="submit">Review artist merge</button>
      </Form>
      {artistPreview ? <form className="rc-hygiene-preview" onSubmit={mergeArtist}>
        <input type="hidden" name="sourceId" value={artistPreview.source.id} /><input type="hidden" name="targetId" value={artistPreview.target.id} />
        <div className="rc-hygiene-preview__title"><strong>{artistPreview.source.name}</strong><span>→</span><strong>{artistPreview.target.name}</strong></div>
        <div className="rc-hygiene-preview__counts">Source carries {artistPreview.source._count.releases} release assignments, {artistPreview.source._count.tracks} track assignments, {artistPreview.source._count.portalAccess} portal-access relationships, and {artistPreview.source._count.contributors} contributor links.</div>
        <p className="rc-field__help">{artistPreview.behavior}</p>
        {artistPreview.profileConflicts.length ? <div className="rc-hygiene-conflicts"><strong>Profile conflicts</strong>{artistPreview.profileConflicts.map((conflict) => <div key={conflict.field} className="rc-hygiene-conflict-row"><span>{conflict.field}</span><span>Destination value will be kept.</span></div>)}</div> : null}
        {artistPreview.collectionConflict ? <label className="rc-field"><span className="rc-field__label">Both artists have different Shopify collections</span><select className="rc-control" name="collectionResolution" required defaultValue=""><option value="">Choose which collection remains linked…</option><option value="KEEP_TARGET">Keep {artistPreview.target.name}&apos;s collection</option><option value="KEEP_SOURCE">Use {artistPreview.source.name}&apos;s collection</option></select><span className="rc-field__help">The losing Shopify collection is left untouched in Shopify.</span></label> : null}
        <button type="submit" className="rc-button rc-button--danger" disabled={busy}>{busy ? "Merging…" : "Merge artist"}</button>
      </form> : null}
    </s-section>

    <s-section heading="Possible duplicate artists">
      {scan.duplicateArtists.length ? <div className="rc-directory-list">{scan.duplicateArtists.map((candidate) => <div key={`${candidate.source.id}:${candidate.target.id}`} className="rc-directory-row"><div><strong>{candidate.source.name} ↔ {candidate.target.name}</strong><div className="rc-directory-row__meta">{candidate.confidence} confidence · <SignalList signals={candidate.signals} /></div></div><Link className="rc-button rc-button--secondary" to={`/app/data-hygiene?artistSource=${candidate.source.id}&artistTarget=${candidate.target.id}`}>Review merge</Link></div>)}</div> : <EmptyState title="No likely artist duplicates">ReleaseCore did not find strong duplicate signals.</EmptyState>}
    </s-section>

    <s-section heading="Merge contributors">
      <p className="rc-section-copy">Contributor merges move track credits and artist relationships. Conflicting ownership percentages must be resolved explicitly.</p>
      <Form method="get" className="rc-hygiene-merge-picker">
        <label className="rc-field"><span className="rc-field__label">Merge this contributor</span><select className="rc-control" name="contributorSource" defaultValue={selected.contributorSource} required><option value="">Choose source contributor…</option>{scan.contributorOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="rc-field"><span className="rc-field__label">Into this contributor</span><select className="rc-control" name="contributorTarget" defaultValue={selected.contributorTarget} required><option value="">Choose surviving contributor…</option>{scan.contributorOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="rc-button rc-button--secondary" type="submit">Review contributor merge</button>
      </Form>
      {contributorPreview ? <form className="rc-hygiene-preview" onSubmit={mergeContributor}>
        <input type="hidden" name="sourceId" value={contributorPreview.source.id} /><input type="hidden" name="targetId" value={contributorPreview.target.id} />
        <div className="rc-hygiene-preview__title"><strong>{contributorName(contributorPreview.source)}</strong><span>→</span><strong>{contributorName(contributorPreview.target)}</strong></div>
        <div className="rc-hygiene-preview__counts">Source carries {contributorPreview.source._count.credits} track credits and {contributorPreview.source._count.artists} artist relationships.</div>
        <p className="rc-field__help">{contributorPreview.behavior}</p>
        {contributorPreview.ownerCustomerConflict ? (
          <label className="rc-field">
            <span className="rc-field__label">
              Both contributors are linked to different customer owners
            </span>
            <select
              className="rc-control"
              name="ownerCustomerResolution"
              required
              defaultValue=""
            >
              <option value="">Choose which customer ownership remains…</option>
              <option value="KEEP_TARGET">Keep destination customer ownership</option>
              <option value="KEEP_SOURCE">Use source customer ownership</option>
            </select>
            <span className="rc-field__help">
              This affects the contributor&apos;s ownerCustomerId association only.
            </span>
          </label>
        ) : null}
        {contributorPreview.ownershipConflicts.length ? <div className="rc-hygiene-conflicts"><strong>Ownership conflicts require a decision</strong>{contributorPreview.ownershipConflicts.map((conflict) => <div className="rc-hygiene-credit-conflict" key={conflict.sourceCreditId}><div><strong>{conflict.trackTitle}</strong><span>{conflict.releaseTitle} · {conflict.role}</span></div><select className="rc-control" name={`resolution:${conflict.sourceCreditId}`} required defaultValue=""><option value="">Choose resolution…</option><option value="TARGET">Keep destination {conflict.targetPercent}%</option><option value="SOURCE">Use source {conflict.sourcePercent}%</option><option value="CUSTOM">Use corrected percentage</option></select><input className="rc-control" type="number" min="0" max="100" step="0.01" name={`custom:${conflict.sourceCreditId}`} placeholder="Corrected % (only for custom)" /></div>)}</div> : null}
        <button type="submit" className="rc-button rc-button--danger" disabled={busy}>{busy ? "Merging…" : "Merge contributor"}</button>
      </form> : null}
    </s-section>

    <s-section heading="Possible duplicate contributors">
      {scan.duplicateContributors.length ? <div className="rc-directory-list">{scan.duplicateContributors.map((candidate) => <div key={`${candidate.source.id}:${candidate.target.id}`} className="rc-directory-row"><div><strong>{candidate.source.name} ↔ {candidate.target.name}</strong><div className="rc-directory-row__meta">{candidate.confidence} confidence · <SignalList signals={candidate.signals} /></div></div><Link className="rc-button rc-button--secondary" to={`/app/data-hygiene?contributorSource=${candidate.source.id}&contributorTarget=${candidate.target.id}`}>Review merge</Link></div>)}</div> : <EmptyState title="No likely contributor duplicates">ReleaseCore did not find strong duplicate signals.</EmptyState>}
    </s-section>

    <s-section heading="Artist ↔ contributor identity">
      <p className="rc-section-copy">Artists and contributors remain separate role-specific records. Marking them as the same person preserves that architecture while making the identity relationship explicit.</p>
      {scan.identityCandidates.length ? <div className="rc-directory-list">{scan.identityCandidates.map((candidate) => <div key={`${candidate.artist.id}:${candidate.contributor.id}`} className="rc-directory-row"><div><strong>{candidate.artist.name} ↔ {candidate.contributor.name}</strong><div className="rc-directory-row__meta">{candidate.confidence} confidence · <SignalList signals={candidate.signals} /></div></div><button type="button" className="rc-button rc-button--secondary" disabled={busy} onClick={() => quickAction("link-same-person", { artistId: candidate.artist.id, contributorId: candidate.contributor.id }, `Mark ${candidate.artist.name} and ${candidate.contributor.name} as the same person?`)}>Mark same person</button></div>)}</div> : <EmptyState title="No unlinked identity matches">No strong Artist ↔ Contributor identity matches need review.</EmptyState>}
    </s-section>

    <s-section heading="Safe cleanup"><div className="rc-hygiene-cleanup-grid">
      <div className="rc-hygiene-panel"><strong>Unused artists ({scan.unusedArtists.length})</strong>{scan.unusedArtists.length ? scan.unusedArtists.map((artist) => <div key={artist.id} className="rc-hygiene-cleanup-row"><span>{artist.name}</span><button type="button" className="rc-button rc-button--danger" disabled={busy} onClick={() => quickAction("delete-unused-artist", { artistId: artist.id }, `Delete unused artist ${artist.name} from ReleaseCore? Shopify files will be left untouched.`, "DELETE ARTIST")}>Delete</button></div>) : <span className="rc-field__help">No unused artists.</span>}</div>
      <div className="rc-hygiene-panel"><strong>Unused contributors ({scan.unusedContributors.length})</strong>{scan.unusedContributors.length ? scan.unusedContributors.map((item) => <div key={item.id} className="rc-hygiene-cleanup-row"><span>{item.name}</span><button type="button" className="rc-button rc-button--danger" disabled={busy} onClick={() => quickAction("delete-unused-contributor", { contributorId: item.id }, `Delete unused contributor ${item.name} from ReleaseCore?`, "DELETE CONTRIBUTOR")}>Delete</button></div>) : <span className="rc-field__help">No unused contributors.</span>}</div>
    </div></s-section>

    <s-section heading="Consistency checks">
      <div className="rc-hygiene-panel"><div className="rc-hygiene-panel__heading"><div><strong>Release artist-name cache</strong><span>{scan.cacheDrift.length} release{scan.cacheDrift.length === 1 ? "" : "s"} need repair.</span></div><button type="button" className="rc-button rc-button--secondary" disabled={busy || !scan.cacheDrift.length} onClick={() => quickAction("repair-artist-cache", {}, "Repair release artist-name caches from normalized artist assignments?")}>Repair cache</button></div></div>
      {scan.tenantIssues.length ? <div className="rc-notice rc-notice--bad"><strong>Cross-tenant relationship issues</strong>{scan.tenantIssues.map((issue) => <div key={`${issue.type}:${issue.id}`}>{issue.message}</div>)}</div> : <div className="rc-notice rc-notice--good">No cross-tenant relationship inconsistencies detected.</div>}
      {scan.localShopifyIssues.length ? <div className="rc-notice"><strong>Incomplete local Shopify collection links</strong>{scan.localShopifyIssues.map((issue) => <div key={issue.artistId}><Link to={`/app/artist/${issue.artistId}`}>{issue.artistName}</Link> needs its Shopify collection link reviewed.</div>)}</div> : null}
    </s-section>

    <s-section heading="Recent maintenance">
      {scan.recentEvents.length ? <div className="rc-directory-list">{scan.recentEvents.map((event) => <div className="rc-directory-row" key={event.id}><div><strong>{event.operation.replaceAll("_", " ")}</strong><div className="rc-directory-row__meta">{event.summary}</div></div><span className="rc-directory-row__aside">{new Date(event.createdAt).toLocaleString()}</span></div>)}</div> : <EmptyState title="No maintenance history yet">Completed merge and repair actions will appear here.</EmptyState>}
    </s-section>
  </s-page>;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
