/* eslint-disable jsx-a11y/label-has-associated-control */
import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { GENRES, LANGUAGES } from "../lib/releasecore";
import {
  isrcAssignmentMode,
  isrcYearDigits,
  normalizeCountryCode,
  normalizeRegistrantCode,
} from "../lib/isrc";
import {
  buildUpc,
  maxItemReference,
  normalizeGs1CompanyPrefix,
} from "../lib/upc";
import { buildCatalogNumber, normalizeCatalogPrefix } from "../lib/catalog";
import { authenticatedPost } from "../lib/authenticated-post";
import { revalidateInPlace } from "../lib/revalidate-in-place";
import { ActionFeedback, CollapsibleSection, PageIntro } from "../components/releasecore-ui";
import { loadSettingsDashboard } from "../lib/settings-dashboard.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  return loadSettingsDashboard({ admin, shop: session.shop });
};

function Field({ label, help, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
      {help ? <span style={styles.help}>{help}</span> : null}
    </label>
  );
}
function Select({ value, onChange, options, placeholder }) {
  return (
    <select className="rc-control" value={value} onChange={onChange}>
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
function Toggle({ checked, onChange, title, help }) {
  return (
    <label style={styles.toggle}>
      <input
        type="checkbox"
        className="rc-choice-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        <span style={styles.toggleHelp}>{help}</span>
      </span>
    </label>
  );
}

function isrcPreview(countryCode, registrantCode, year, nextDesignation) {
  const country = normalizeCountryCode(countryCode);
  const registrant = normalizeRegistrantCode(registrantCode);
  const designation = Number(nextDesignation);
  if (
    !/^[A-Z]{2}$/.test(country) ||
    !/^[A-Z0-9]{3}$/.test(registrant) ||
    !Number.isInteger(designation) ||
    designation < 1 ||
    designation > 99999
  )
    return "Complete the ISRC settings";
  return `${country}${registrant}${isrcYearDigits(year)}${String(designation).padStart(5, "0")}`;
}

export default function SettingsPage() {
  const data = useLoaderData();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();
  const s = data.settings || {};

  const [countryCode, setCountryCode] = useState(s.countryCode || "");
  const [registrantCode, setRegistrantCode] = useState(s.registrantCode || "");
  const [nextDesignation, setNextDesignation] = useState(
    String(data.nextDesignation || 1),
  );
  const [isrcMode, setIsrcMode] = useState(isrcAssignmentMode(s));
  const [defaultLabelName, setDefaultLabelName] = useState(
    s.defaultLabelName || "",
  );
  const [defaultCopyrightHolder, setDefaultCopyrightHolder] = useState(
    s.defaultCopyrightHolder || "",
  );
  const [defaultGenre, setDefaultGenre] = useState(s.defaultGenre || "");
  const [defaultLanguage, setDefaultLanguage] = useState(
    s.defaultLanguage || "",
  );
  const [requireLyrics, setRequireLyrics] = useState(s.requireLyrics ?? true);
  const [requirePublishing, setRequirePublishing] = useState(
    s.requirePublishing ?? true,
  );
  const [requireSplitSheet, setRequireSplitSheet] = useState(
    s.requireSplitSheet ?? false,
  );
  const [requireCredits, setRequireCredits] = useState(
    s.requireCredits ?? false,
  );
  const [requireTrackLanguage, setRequireTrackLanguage] = useState(
    s.requireTrackLanguage ?? true,
  );
  const [releaseLeadTimeEnabled, setReleaseLeadTimeEnabled] = useState(
    s.releaseLeadTimeEnabled ?? false,
  );
  const [releaseLeadTimeDays, setReleaseLeadTimeDays] = useState(
    String(s.releaseLeadTimeDays ?? 14),
  );
  const [upcMode, setUpcMode] = useState(s.upcMode || "AGGREGATOR");
  const [gs1CompanyPrefix, setGs1CompanyPrefix] = useState(
    s.gs1CompanyPrefix || "",
  );
  const [nextUpcItemReference, setNextUpcItemReference] = useState(
    String(data.nextUpcItemReference || 1),
  );
  const [catalogMode, setCatalogMode] = useState(s.catalogMode || "AUTO");
  const [catalogPrefix, setCatalogPrefix] = useState(s.catalogPrefix || "");
  const [catalogIncludeYear, setCatalogIncludeYear] = useState(
    s.catalogIncludeYear ?? true,
  );
  const [catalogSequenceWidth, setCatalogSequenceWidth] = useState(
    String(s.catalogSequenceWidth || 4),
  );
  const [nextCatalogSequence, setNextCatalogSequence] = useState(
    String(data.nextCatalogSequence || 1),
  );
  const [autoAssignCatalogNumber, setAutoAssignCatalogNumber] = useState(
    s.autoAssignCatalogNumber ?? true,
  );
  const [defaultTrackPrice, setDefaultTrackPrice] = useState(
    String(s.defaultTrackPrice ?? 1.29),
  );
  const [defaultAlbumPrice, setDefaultAlbumPrice] = useState(
    String(s.defaultAlbumPrice ?? 9.99),
  );
  const [shopifyTrackProductDefaultState, setShopifyTrackProductDefaultState] = useState(
    s.shopifyTrackProductDefaultState || "DRAFT",
  );
  const [shopifyAlbumProductDefaultState, setShopifyAlbumProductDefaultState] = useState(
    s.shopifyAlbumProductDefaultState || "DRAFT",
  );
  const [shopifySingleTemplateSuffix, setShopifySingleTemplateSuffix] = useState(
    s.shopifySingleTemplateSuffix || "",
  );
  const [shopifyAlbumTemplateSuffix, setShopifyAlbumTemplateSuffix] = useState(
    s.shopifyAlbumTemplateSuffix || "",
  );
  const [shopifyArtistCollectionTemplateSuffix, setShopifyArtistCollectionTemplateSuffix] = useState(
    s.shopifyArtistCollectionTemplateSuffix || "",
  );
  const [generateShopifyAudioPreview, setGenerateShopifyAudioPreview] =
    useState(s.generateShopifyAudioPreview ?? false);
  const [audioPreviewDurationSeconds, setAudioPreviewDurationSeconds] =
    useState(String(s.audioPreviewDurationSeconds ?? 60));
  const [audioPreviewBitrateKbps, setAudioPreviewBitrateKbps] = useState(
    String(s.audioPreviewBitrateKbps ?? 192),
  );
  const [customerDownloadsEnabled, setCustomerDownloadsEnabled] = useState(
    s.customerDownloadsEnabled ?? true,
  );
  const [customerDownloadAutoGenerate, setCustomerDownloadAutoGenerate] =
    useState(s.customerDownloadAutoGenerate ?? true);
  const [customerDownloadMp3Enabled, setCustomerDownloadMp3Enabled] = useState(
    s.customerDownloadMp3Enabled ?? true,
  );
  const [customerDownloadMp3BitrateKbps, setCustomerDownloadMp3BitrateKbps] =
    useState(String(s.customerDownloadMp3BitrateKbps ?? 320));
  const [customerDownloadFlacEnabled, setCustomerDownloadFlacEnabled] =
    useState(s.customerDownloadFlacEnabled ?? true);
  const [
    customerDownloadFlacCompressionLevel,
    setCustomerDownloadFlacCompressionLevel,
  ] = useState(String(s.customerDownloadFlacCompressionLevel ?? 5));
  const [customerDownloadEmbedArtwork, setCustomerDownloadEmbedArtwork] =
    useState(s.customerDownloadEmbedArtwork ?? true);
  const [customerDownloadEmbedLyrics, setCustomerDownloadEmbedLyrics] =
    useState(s.customerDownloadEmbedLyrics ?? true);
  const [customerDownloadEmbedCredits, setCustomerDownloadEmbedCredits] =
    useState(s.customerDownloadEmbedCredits ?? true);
  const [customerDownloadEmbedArtistLinks, setCustomerDownloadEmbedArtistLinks] =
    useState(s.customerDownloadEmbedArtistLinks ?? true);

  const [lockArtistNameEditing, setLockArtistNameEditing] = useState(
    s.lockArtistNameEditing ?? true,
  );
  const [lockContributorIdentityAfterSubmission, setLockContributorIdentityAfterSubmission] = useState(
    s.lockContributorIdentityAfterSubmission ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(
    () => setNextDesignation(String(data.nextDesignation || 1)),
    [data.nextDesignation],
  );
  useEffect(
    () => setNextUpcItemReference(String(data.nextUpcItemReference || 1)),
    [data.nextUpcItemReference],
  );
  useEffect(
    () => setNextCatalogSequence(String(data.nextCatalogSequence || 1)),
    [data.nextCatalogSequence],
  );

  const previewIsrc = useMemo(
    () => isrcPreview(countryCode, registrantCode, data.year, nextDesignation),
    [countryCode, registrantCode, data.year, nextDesignation],
  );
  const previewUpc = useMemo(() => {
    try {
      const p = normalizeGs1CompanyPrefix(gs1CompanyPrefix);
      return p
        ? buildUpc({
            companyPrefix: p,
            itemReference: Number(nextUpcItemReference || 0),
          })
        : "Enter a GS1 U.P.C. Company Prefix";
    } catch {
      return "Enter a valid GS1 U.P.C. Company Prefix";
    }
  }, [gs1CompanyPrefix, nextUpcItemReference]);
  const previewCatalog = useMemo(() => {
    try {
      const prefix = normalizeCatalogPrefix(catalogPrefix);
      return prefix
        ? buildCatalogNumber({
            prefix,
            includeYear: catalogIncludeYear,
            year: new Date().getFullYear(),
            sequence: Number(nextCatalogSequence || 1),
            width: Number(catalogSequenceWidth || 4),
          })
        : "Enter a catalog prefix";
    } catch {
      return "Complete the catalog settings";
    }
  }, [
    catalogPrefix,
    catalogIncludeYear,
    nextCatalogSequence,
    catalogSequenceWidth,
  ]);

  const post = async (formData, fallback, scope = "settings", pending = "Saving settings…") => {
    if (busy) return null;
    setBusy(true);
    setNotice({ scope, tone: "info", message: pending });
    try {
      const r = await authenticatedPost(shopify, "/api/settings", formData);
      setNotice({ scope, tone: "good", message: r.message || fallback });
      await revalidateInPlace(revalidator);
      return r;
    } catch (e) {
      setNotice({
        scope,
        tone: "bad",
        message:
          e instanceof Error
            ? e.message
            : "ReleaseCore could not save settings.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async (scope = "settings") => {
    const f = new FormData();
    f.set("intent", "save-settings");
    f.set("countryCode", countryCode);
    f.set("registrantCode", registrantCode);
    f.set("nextDesignation", nextDesignation);
    f.set("isrcMode", isrcMode);
    f.set("defaultLabelName", defaultLabelName);
    f.set("defaultCopyrightHolder", defaultCopyrightHolder);
    f.set("defaultGenre", defaultGenre);
    f.set("defaultLanguage", defaultLanguage);
    if (requireLyrics) f.set("requireLyrics", "on");
    if (requirePublishing) f.set("requirePublishing", "on");
    if (requireSplitSheet) f.set("requireSplitSheet", "on");
    if (requireCredits) f.set("requireCredits", "on");
    if (requireTrackLanguage) f.set("requireTrackLanguage", "on");
    if (releaseLeadTimeEnabled) f.set("releaseLeadTimeEnabled", "on");
    f.set("releaseLeadTimeDays", releaseLeadTimeDays);
    f.set("upcMode", upcMode);
    f.set("gs1CompanyPrefix", gs1CompanyPrefix);
    f.set("nextUpcItemReference", nextUpcItemReference);
    f.set("catalogMode", catalogMode);
    f.set("catalogPrefix", catalogPrefix);
    if (catalogIncludeYear) f.set("catalogIncludeYear", "on");
    f.set("catalogSequenceWidth", catalogSequenceWidth);
    f.set("nextCatalogSequence", nextCatalogSequence);
    if (autoAssignCatalogNumber) f.set("autoAssignCatalogNumber", "on");
    f.set("defaultTrackPrice", defaultTrackPrice);
    f.set("defaultAlbumPrice", defaultAlbumPrice);
    f.set("shopifyTrackProductDefaultState", shopifyTrackProductDefaultState);
    f.set("shopifyAlbumProductDefaultState", shopifyAlbumProductDefaultState);
    f.set("shopifySingleTemplateSuffix", shopifySingleTemplateSuffix);
    f.set("shopifyAlbumTemplateSuffix", shopifyAlbumTemplateSuffix);
    f.set("shopifyArtistCollectionTemplateSuffix", shopifyArtistCollectionTemplateSuffix);
    if (generateShopifyAudioPreview) f.set("generateShopifyAudioPreview", "on");
    f.set("audioPreviewDurationSeconds", audioPreviewDurationSeconds);
    f.set("audioPreviewBitrateKbps", audioPreviewBitrateKbps);
    if (customerDownloadsEnabled) f.set("customerDownloadsEnabled", "on");
    if (customerDownloadAutoGenerate) {
      f.set("customerDownloadAutoGenerate", "on");
    }
    if (customerDownloadMp3Enabled) f.set("customerDownloadMp3Enabled", "on");
    f.set(
      "customerDownloadMp3BitrateKbps",
      customerDownloadMp3BitrateKbps,
    );
    if (customerDownloadFlacEnabled) {
      f.set("customerDownloadFlacEnabled", "on");
    }
    f.set(
      "customerDownloadFlacCompressionLevel",
      customerDownloadFlacCompressionLevel,
    );
    if (customerDownloadEmbedArtwork) {
      f.set("customerDownloadEmbedArtwork", "on");
    }
    if (customerDownloadEmbedLyrics) {
      f.set("customerDownloadEmbedLyrics", "on");
    }
    if (customerDownloadEmbedCredits) {
      f.set("customerDownloadEmbedCredits", "on");
    }
    if (customerDownloadEmbedArtistLinks) {
      f.set("customerDownloadEmbedArtistLinks", "on");
    }
    f.set("lockArtistNameEditing", lockArtistNameEditing ? "on" : "off");
    f.set(
      "lockContributorIdentityAfterSubmission",
      lockContributorIdentityAfterSubmission ? "on" : "off",
    );
    const pending = ({
      requirements: "Saving submission requirements…",
      identity: "Saving identity protection…",
      isrc: "Saving ISRC settings…",
      upc: "Saving UPC settings…",
      catalog: "Saving catalog settings…",
      previews: "Saving audio preview settings…",
      downloads: "Saving customer download settings…",
      defaults: "Saving distribution defaults…",
      products: "Saving Shopify product defaults…",
    })[scope] || "Saving settings…";
    const r = await post(f, "Settings saved.", scope, pending);
    if (r) shopify.toast.show("Settings saved");
  };
  const backfill = async () => {
    const f = new FormData();
    f.set("intent", "assign-missing-isrcs");
    await post(f, "ISRCs updated.", "isrc", "Assigning missing ISRCs…");
  };
  const installMetafields = async () => {
    const f = new FormData();
    f.set("intent", "install-shopify-metafields");
    await post(f, "Shopify integration ready.", "shopify", "Checking Shopify integration…");
  };

  let upcCapacity = "";
  try {
    const p = normalizeGs1CompanyPrefix(gs1CompanyPrefix);
    if (p) upcCapacity = `Item Reference range 0–${maxItemReference(p)}`;
  } catch {
    // The validation message inside the UPC section handles incomplete prefixes.
  }
  const feedbackFor = (scope) => (notice?.scope === scope ? notice : null);
  const metaReady =
    data.metafields.missing.length === 0 &&
    data.metafields.mismatched.length === 0 &&
    data.metafields.hidden.length === 0 &&
    (data.metafields.unconstrained?.length || 0) === 0;

  return (
    <s-page heading="Release Preferences">
      <s-section>
        <PageIntro
          eyebrow="ReleaseCore configuration"
          title="Requirements, identifiers, and catalog defaults."
        >
          Control what artists must provide, how identifiers are assigned, and
          which values carry into distribution and Shopify products.
        </PageIntro>
      </s-section>
      <ActionFeedback feedback={feedbackFor("settings")} />

      <CollapsibleSection
        icon="checklist"
        title="Submission requirements"
        description="Choose which information must be complete before an artist can submit."
        summary={`${[requireLyrics, requirePublishing, requireSplitSheet, requireCredits, requireTrackLanguage, releaseLeadTimeEnabled].filter(Boolean).length} enabled`}
        defaultOpen
      >
        <ActionFeedback feedback={feedbackFor("requirements")} />
        <div style={styles.sectionIntro}>
          Core metadata, cover artwork, master audio and primary artists remain
          required. These switches control additional requirements for your
          workflow.
        </div>
        <div className="rc-settings-toggle-grid" style={styles.toggleGrid}>
          <Toggle
            checked={requireLyrics}
            onChange={setRequireLyrics}
            title="Require lyrics or instrumental designation"
            help="Blocks submission when a lyrical track has no lyrics."
          />
          <Field
            label="Credit handling"
            help="Choose whether your store collects contributor credits only, or contributor credits plus writer/composer ownership splits."
          >
            <select
              className="rc-control"
              value={requirePublishing ? "CREDITS_AND_SPLITS" : "CREDITS_ONLY"}
              onChange={(event) =>
                setRequirePublishing(
                  event.target.value === "CREDITS_AND_SPLITS",
                )
              }
            >
              <option value="CREDITS_ONLY">Credits only</option>
              <option value="CREDITS_AND_SPLITS">Credits &amp; splits</option>
            </select>
          </Field>
          <Toggle
            checked={requireSplitSheet}
            onChange={setRequireSplitSheet}
            title="Require a split sheet"
            help="Makes the release-level PDF split sheet mandatory."
          />
          <Toggle
            checked={requireCredits}
            onChange={setRequireCredits}
            title="Require at least one contributor credit"
            help="Requires a writer, producer, engineer or other contributor on each track."
          />
          <Toggle
            checked={requireTrackLanguage}
            onChange={setRequireTrackLanguage}
            title="Require track language"
            help="Turn off only if your aggregator does not require a language value."
          />
          <Toggle
            checked={releaseLeadTimeEnabled}
            onChange={setReleaseLeadTimeEnabled}
            title="Enforce release-date lead time"
            help="Prevents artists from choosing or submitting a release date that is too close to today."
          />
        </div>
        {releaseLeadTimeEnabled ? (
          <div style={styles.leadTimeCard}>
            <div>
              <strong style={styles.setupTitle}>
                Artist release-date lead time
              </strong>
              <div style={styles.muted}>
                The earliest selectable date in the Artist Portal will always be
                this many calendar days from today. ReleaseCore checks the date
                again at submission.
              </div>
            </div>
            <Field
              label="Minimum lead time (days)"
              help="Example: 14 means an artist submitting today must choose a release date at least 14 days away."
            >
              <input
                type="number"
                min="0"
                max="365"
                step="1"
                value={releaseLeadTimeDays}
                onChange={(e) => setReleaseLeadTimeDays(e.target.value)}
                className="rc-control" style={{ maxWidth: 180 }}
              />
            </Field>
          </div>
        ) : null}
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("requirements")}
            className="rc-button rc-button--primary"
          >
            Save requirements
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="artist"
        title="Identity protection"
        description="Control when artist and contributor identities can be renamed."
        summary={`${[lockArtistNameEditing, lockContributorIdentityAfterSubmission].filter(Boolean).length} protections enabled`}
        defaultOpen
      >
        <ActionFeedback feedback={feedbackFor("identity")} />
        <div style={styles.sectionIntro}>
          Keep credited identities stable after they enter the delivery workflow.
          Administrators can change these protections here when a legitimate
          correction is required.
        </div>
        <div className="rc-settings-toggle-grid" style={styles.toggleGrid}>
          <Toggle
            checked={lockArtistNameEditing}
            onChange={setLockArtistNameEditing}
            title="Lock artist names in storefront profiles"
            help="Artists can update their image, biography, rights details and links, but only an administrator can rename the artist."
          />
          <Toggle
            checked={lockContributorIdentityAfterSubmission}
            onChange={setLockContributorIdentityAfterSubmission}
            title="Lock contributor credits after submission"
            help="Credit identity and publishing fields become read-only once the contributor is used on a submitted release."
          />
        </div>
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("identity")}
            className="rc-button rc-button--primary"
          >
            Save identity protection
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="identifier"
        title="ISRC assignment"
        description="Choose who assigns permanent track identifiers."
        summary={isrcMode === "AUTO" ? "ReleaseCore assigns" : "Admin provides"}
      >
        <ActionFeedback feedback={feedbackFor("isrc")} />
        <div style={styles.sectionIntro}>
          Existing ISRCs are permanent. Changing modes never replaces a code
          already assigned to a recording.
        </div>
        <div className="rc-settings-choice-grid" style={styles.choiceGrid}>
          <label
            style={{
              ...styles.choice,
              ...(isrcMode === "AUTO" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={isrcMode === "AUTO"}
              onChange={() => setIsrcMode("AUTO")}
            />
            <span>
              <strong>ReleaseCore assigns ISRCs</strong>
              <span style={styles.toggleHelp}>
                Reserve the next code automatically and fill only tracks that
                do not already have one.
              </span>
            </span>
          </label>
          <label
            style={{
              ...styles.choice,
              ...(isrcMode === "ADMIN" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={isrcMode === "ADMIN"}
              onChange={() => setIsrcMode("ADMIN")}
            />
            <span>
              <strong>Aggregator / admin provides ISRCs</strong>
              <span style={styles.toggleHelp}>
                Artists can submit without ISRCs. Enter each permanent code in
                the Distribution workspace.
              </span>
            </span>
          </label>
        </div>
        {isrcMode === "AUTO" ? (
          <>
            <div className="rc-settings-grid" style={{ ...styles.grid, marginTop: 16 }}>
              <Field label="Country Code (2 characters)">
                <input
                  value={countryCode}
                  onChange={(e) =>
                    setCountryCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, "")
                        .slice(0, 2),
                    )
                  }
                  className="rc-control"
                />
              </Field>
              <Field label="Registrant Code (3 characters)">
                <input
                  value={registrantCode}
                  onChange={(e) =>
                    setRegistrantCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, "")
                        .slice(0, 3),
                    )
                  }
                  className="rc-control"
                />
              </Field>
              <Field label="Reference year">
                <div style={styles.readonly}>
                  {data.year} · {isrcYearDigits(data.year)}
                </div>
              </Field>
              <Field label="Next Designation Code">
                <input
                  type="number"
                  min="1"
                  max="99999"
                  value={nextDesignation}
                  onChange={(e) => setNextDesignation(e.target.value)}
                  className="rc-control"
                />
              </Field>
            </div>
            <div style={styles.previewCard}>
              <div>
                <div style={styles.previewLabel}>Next ISRC</div>
                <div style={styles.previewCode}>{previewIsrc}</div>
              </div>
              <div style={styles.previewMeta}>
                {data.assignedCount} assigned · {data.unassignedCount} waiting
              </div>
            </div>
          </>
        ) : (
          <div style={styles.previewCard}>
            <div>
              <div style={styles.previewLabel}>Distribution workflow</div>
              <div style={styles.setupTitle}>Admin assignment enabled</div>
              <div style={styles.muted}>
                Missing ISRCs no longer block artist submission. Codes are
                validated, normalized, audit-logged, and locked after entry.
              </div>
            </div>
            <div style={styles.previewMeta}>
              {data.assignedCount} assigned · {data.unassignedCount} waiting
            </div>
          </div>
        )}
        <div className="rc-form-actions" style={styles.actionRow}>
          {isrcMode === "AUTO" ? (
            <button
              type="button"
              disabled={busy || !data.isrcConfigured || !data.unassignedCount}
              onClick={backfill}
              className="rc-button"
            >
              Assign missing ISRCs
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => save("isrc")}
            className="rc-button rc-button--primary"
          >
            Save ISRC settings
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="barcode"
        title="UPC / GTIN-12 handling"
        description="Choose who assigns release-level product codes."
        summary={
          upcMode === "GS1" ? "ReleaseCore assigns" : "Distributor provides"
        }
      >
        <ActionFeedback feedback={feedbackFor("upc")} />
        <div style={styles.sectionIntro}>
          Choose whether your distributor supplies UPCs or ReleaseCore assigns
          them from your licensed GS1 U.P.C. Company Prefix.
        </div>
        <div className="rc-settings-choice-grid" style={styles.choiceGrid}>
          <label
            style={{
              ...styles.choice,
              ...(upcMode === "AGGREGATOR" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={upcMode === "AGGREGATOR"}
              onChange={() => setUpcMode("AGGREGATOR")}
            />
            <span>
              <strong>Aggregator / admin provides UPC</strong>
              <span style={styles.toggleHelp}>
                Enter the UPC in Distribution after your distributor assigns it.
              </span>
            </span>
          </label>
          <label
            style={{
              ...styles.choice,
              ...(upcMode === "GS1" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={upcMode === "GS1"}
              onChange={() => setUpcMode("GS1")}
            />
            <span>
              <strong>Generate from GS1 Company Prefix</strong>
              <span style={styles.toggleHelp}>
                ReleaseCore allocates the Item Reference and calculates the
                GTIN-12 check digit.
              </span>
            </span>
          </label>
        </div>
        {upcMode === "GS1" ? (
          <>
            <div className="rc-settings-grid" style={{ ...styles.grid, marginTop: 16 }}>
              <Field
                label="GS1 U.P.C. Company Prefix"
                help="Enter the numeric prefix exactly as licensed to your organization."
              >
                <input
                  value={gs1CompanyPrefix}
                  onChange={(e) =>
                    setGs1CompanyPrefix(
                      e.target.value.replace(/\D/g, "").slice(0, 10),
                    )
                  }
                  className="rc-control"
                  placeholder="123456"
                />
              </Field>
              <Field label="Next Item Reference" help={upcCapacity}>
                <input
                  type="number"
                  min="0"
                  value={nextUpcItemReference}
                  onChange={(e) => setNextUpcItemReference(e.target.value)}
                  className="rc-control"
                />
              </Field>
            </div>
            <div style={styles.previewCard}>
              <div>
                <div style={styles.previewLabel}>Next UPC / GTIN-12</div>
                <div style={styles.previewCode}>{previewUpc}</div>
              </div>
              <div style={styles.previewMeta}>
                {data.upcAssigned} assigned · {data.upcMissing} approved
                releases waiting
              </div>
            </div>
          </>
        ) : null}
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("upc")}
            className="rc-button rc-button--primary"
          >
            Save UPC settings
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="catalog"
        title="Catalog number assignment"
        description="Control release-level catalog numbers and sequencing."
        summary={catalogMode === "AUTO" ? "Automatic" : "Manual"}
      >
        <ActionFeedback feedback={feedbackFor("catalog")} />
        <div style={styles.sectionIntro}>
          Catalog numbers are controlled by your organization. Automatic mode
          can follow patterns such as ERE260046: prefix + two-digit year +
          padded sequence.
        </div>
        <div className="rc-settings-choice-grid" style={styles.choiceGrid}>
          <label
            style={{
              ...styles.choice,
              ...(catalogMode === "AUTO" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={catalogMode === "AUTO"}
              onChange={() => setCatalogMode("AUTO")}
            />
            <span>
              <strong>ReleaseCore generates catalog numbers</strong>
              <span style={styles.toggleHelp}>
                Use a configurable prefix, optional year, and sequential number.
              </span>
            </span>
          </label>
          <label
            style={{
              ...styles.choice,
              ...(catalogMode === "MANUAL" ? styles.choiceActive : {}),
            }}
          >
            <input
              type="radio"
              className="rc-choice-input"
              checked={catalogMode === "MANUAL"}
              onChange={() => setCatalogMode("MANUAL")}
            />
            <span>
              <strong>Admin provides catalog number</strong>
              <span style={styles.toggleHelp}>
                Enter the catalog number in the Distribution workspace.
              </span>
            </span>
          </label>
        </div>
        {catalogMode === "AUTO" ? (
          <>
            <div className="rc-settings-grid" style={{ ...styles.grid, marginTop: 16 }}>
              <Field
                label="Catalog prefix"
                help="Letters, numbers and hyphens. Example: ERE"
              >
                <input
                  value={catalogPrefix}
                  onChange={(e) =>
                    setCatalogPrefix(normalizeCatalogPrefix(e.target.value))
                  }
                  className="rc-control"
                  placeholder="ERE"
                />
              </Field>
              <Field label="Sequence digits">
                <select
                  value={catalogSequenceWidth}
                  onChange={(e) => setCatalogSequenceWidth(e.target.value)}
                  className="rc-control"
                >
                  {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n} digits
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Next sequence">
                <input
                  type="number"
                  min="1"
                  value={nextCatalogSequence}
                  onChange={(e) => setNextCatalogSequence(e.target.value)}
                  className="rc-control"
                />
              </Field>
            </div>
            <Toggle
              checked={catalogIncludeYear}
              onChange={setCatalogIncludeYear}
              title="Include two-digit year"
              help="Example: ERE + 26 + 0046 → ERE260046."
            />
            <Toggle
              checked={autoAssignCatalogNumber}
              onChange={setAutoAssignCatalogNumber}
              title="Automatically assign before Shopify product creation"
              help="ReleaseCore will reserve the next catalog number if the release reaches Distribution without one."
            />
            <div style={styles.previewCard}>
              <div>
                <div style={styles.previewLabel}>Next catalog number</div>
                <div style={styles.previewCode}>{previewCatalog}</div>
              </div>
              <div style={styles.previewMeta}>
                {data.catalogAssigned} assigned · {data.catalogMissing} approved
                releases waiting
              </div>
            </div>
          </>
        ) : null}
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("catalog")}
            className="rc-button rc-button--primary"
          >
            Save catalog settings
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="shopify"
        title="Shopify integration"
        description="Keep the product data ReleaseCore publishes available to your theme."
        summary={metaReady ? "Ready" : "Action required"}
      >
        <ActionFeedback feedback={feedbackFor("shopify")} />
        <div style={styles.sectionIntro}>
          ReleaseCore can create the product data definitions needed by your
          storefront automatically.
        </div>
        <div style={styles.shopifySetup}>
          <div>
            <div style={styles.setupTitle}>
              {metaReady
                ? "Shopify product data ready"
                : "Shopify product data needs setup"}
            </div>
            <div style={styles.muted}>
              {data.metafields.installed}/{data.metafields.total} definitions
              found
              {data.metafields.hidden.length
                ? ` · ${data.metafields.hidden.length} need Storefront access`
                : ""}
              {data.metafields.mismatched.length
                ? ` · ${data.metafields.mismatched.length} type mismatch`
                : ""}
              {data.metafields.unconstrained?.length
                ? ` · ${data.metafields.unconstrained.length} need Digital Music category scoping`
                : ""}
            </div>
            {data.metafields.missing.length ? (
              <div style={styles.smallList}>
                Missing: {data.metafields.missing.join(", ")}
              </div>
            ) : null}
            {data.metafields.mismatched.length ? (
              <div style={styles.smallList}>
                Type mismatch:{" "}
                {data.metafields.mismatched.map((x) => x.key).join(", ")}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={installMetafields}
            className={`rc-button ${metaReady ? "" : "rc-button--primary"}`.trim()}
          >
            {metaReady ? "Check and repair" : "Complete setup"}
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="product"
        title="Shopify product publishing"
        description="Choose how track products enter the Online Store and which theme templates ReleaseCore assigns when products are first created."
        summary={shopifyTrackProductDefaultState === "DRAFT" ? "Draft by default" : shopifyTrackProductDefaultState === "PUBLISH_NOW" ? "Publish immediately" : shopifyTrackProductDefaultState === "SCHEDULE_RELEASE_DATE" ? "Schedule for release date" : "Active / unpublished"}
      >
        <ActionFeedback feedback={feedbackFor("products")} />
        <div className="rc-settings-grid" style={styles.grid}>
          <Field
            label="New track product default"
            help="This only applies when ReleaseCore creates a new track product. Later syncs preserve the product's current publication state."
          >
            <select
              value={shopifyTrackProductDefaultState}
              onChange={(event) => setShopifyTrackProductDefaultState(event.target.value)}
              className="rc-control"
            >
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE_UNPUBLISHED">Active, not published</option>
              <option value="PUBLISH_NOW">Publish immediately to Online Store</option>
              <option value="SCHEDULE_RELEASE_DATE">Schedule Online Store publication for release date</option>
            </select>
          </Field>
          <Field
            label="New Album / EP product default"
            help="Applies only when ReleaseCore creates the release-level Album/EP product. Later syncs preserve its current publication state."
          >
            <select
              value={shopifyAlbumProductDefaultState}
              onChange={(event) => setShopifyAlbumProductDefaultState(event.target.value)}
              className="rc-control"
            >
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE_UNPUBLISHED">Active, not published</option>
              <option value="PUBLISH_NOW">Publish immediately to Online Store</option>
              <option value="SCHEDULE_RELEASE_DATE">Schedule Online Store publication for release date</option>
            </select>
          </Field>
          <Field
            label="Single-track product template"
            help="Enter the Shopify product template suffix, such as music. Leave blank to use the theme default."
          >
            <input
              value={shopifySingleTemplateSuffix}
              onChange={(event) => setShopifySingleTemplateSuffix(event.target.value)}
              placeholder="music"
              className="rc-control"
            />
          </Field>
          <Field
            label="Album / EP product template"
            help="Used when ReleaseCore creates the release-level Album/EP product. Leave blank to use the theme default."
          >
            <input
              value={shopifyAlbumTemplateSuffix}
              onChange={(event) => setShopifyAlbumTemplateSuffix(event.target.value)}
              placeholder="album"
              className="rc-control"
            />
          </Field>
          <Field
            label="Artist collection template"
            help="Used for Shopify artist collections created or synchronized by ReleaseCore. Leave blank to use the theme default."
          >
            <input
              value={shopifyArtistCollectionTemplateSuffix}
              onChange={(event) =>
                setShopifyArtistCollectionTemplateSuffix(
                  event.target.value,
                )
              }
              placeholder="artist"
              className="rc-control"
            />
          </Field>
        </div>
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("products")}
            className="rc-button rc-button--primary"
          >
            Save Shopify product defaults
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="audio"
        title="Audio previews"
        description="Create storefront listening previews while keeping WAV masters private."
        summary={generateShopifyAudioPreview ? "Enabled" : "Disabled"}
      >
        <ActionFeedback feedback={feedbackFor("previews")} />
        <div style={styles.sectionIntro}>
          When enabled, ReleaseCore can generate a browser-friendly MP3 preview
          for each track during distribution.
        </div>
        <Toggle
          checked={generateShopifyAudioPreview}
          onChange={setGenerateShopifyAudioPreview}
          title="Enable MP3 preview generation"
          help="Adds preview controls to the Distribution workspace and attaches finished previews to track products."
        />
        {generateShopifyAudioPreview ? (
          <div className="rc-settings-grid" style={{ ...styles.grid, marginTop: 14 }}>
            <Field
              label="Preview duration (seconds)"
              help="Use 0 for the full track. Short previews keep storefront playback fast."
            >
              <input
                type="number"
                min="0"
                max="3600"
                step="1"
                value={audioPreviewDurationSeconds}
                onChange={(e) => setAudioPreviewDurationSeconds(e.target.value)}
                className="rc-control"
              />
            </Field>
            <Field label="MP3 bitrate">
              <select
                value={audioPreviewBitrateKbps}
                onChange={(e) => setAudioPreviewBitrateKbps(e.target.value)}
                className="rc-control"
              >
                {[128, 160, 192, 256, 320].map((n) => (
                  <option key={n} value={n}>
                    {n} kbps
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("previews")}
            className="rc-button rc-button--primary"
          >
            Save audio preview settings
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="audio"
        title="Customer download files"
        description="Generate private, tagged MP3 and FLAC purchase files from the WAV master. Buyers never receive the master WAV."
        summary={customerDownloadsEnabled ? "Enabled" : "Disabled"}
      >
        <ActionFeedback feedback={feedbackFor("downloads")} />
        <div style={styles.sectionIntro}>
          ReleaseCore keeps the WAV master private and creates customer-ready
          derivatives with artwork and available public release metadata.
          Changing the master, artwork, metadata, credits, or encoding settings
          makes the previous derivative stale so it is rebuilt before delivery.
        </div>

        <div className="rc-settings-toggle-grid" style={styles.toggleGrid}>
          <Toggle
            checked={customerDownloadsEnabled}
            onChange={setCustomerDownloadsEnabled}
            title="Enable customer music downloads"
            help="Purchase entitlements can download generated formats only. The original WAV master is never a buyer download."
          />
          <Toggle
            checked={customerDownloadAutoGenerate}
            onChange={setCustomerDownloadAutoGenerate}
            title="Prepare files automatically after purchase"
            help="ReleaseCore starts generation after a paid order. Missing or stale files are also generated on demand for an entitled customer."
          />
          <Toggle
            checked={customerDownloadMp3Enabled}
            onChange={setCustomerDownloadMp3Enabled}
            title="Offer MP3"
            help="Creates an ID3v2.4 MP3 with ID3v1 compatibility."
          />
          <Toggle
            checked={customerDownloadFlacEnabled}
            onChange={setCustomerDownloadFlacEnabled}
            title="Offer FLAC"
            help="Creates a lossless FLAC with Vorbis comments and embedded front-cover artwork."
          />
          <Toggle
            checked={customerDownloadEmbedArtwork}
            onChange={setCustomerDownloadEmbedArtwork}
            title="Embed cover artwork"
            help="Adds the release artwork as the front cover when artwork is available."
          />
          <Toggle
            checked={customerDownloadEmbedLyrics}
            onChange={setCustomerDownloadEmbedLyrics}
            title="Embed lyrics"
            help="Adds the track lyrics when lyrics are available."
          />
          <Toggle
            checked={customerDownloadEmbedCredits}
            onChange={setCustomerDownloadEmbedCredits}
            title="Embed public credits"
            help="Includes names and public credit roles. IPI, PRO, ownership percentages, email and internal rights data are excluded."
          />
          <Toggle
            checked={customerDownloadEmbedArtistLinks}
            onChange={setCustomerDownloadEmbedArtistLinks}
            title="Embed public artist links"
            help="Adds available website, Spotify, Apple Music and social profile URLs as metadata."
          />
        </div>

        {customerDownloadsEnabled ? (
          <div
            className="rc-settings-grid"
            style={{ ...styles.grid, marginTop: 14 }}
          >
            {customerDownloadMp3Enabled ? (
              <Field
                label="MP3 download bitrate"
                help="320 kbps is the default high-quality customer MP3."
              >
                <select
                  value={customerDownloadMp3BitrateKbps}
                  onChange={(event) =>
                    setCustomerDownloadMp3BitrateKbps(event.target.value)
                  }
                  className="rc-control"
                >
                  {[128, 160, 192, 256, 320].map((value) => (
                    <option key={value} value={value}>
                      {value} kbps
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {customerDownloadFlacEnabled ? (
              <Field
                label="FLAC compression level"
                help="Compression affects file size and encoding time, not audio quality. Level 5 is the balanced default."
              >
                <select
                  value={customerDownloadFlacCompressionLevel}
                  onChange={(event) =>
                    setCustomerDownloadFlacCompressionLevel(event.target.value)
                  }
                  className="rc-control"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                    <option key={value} value={value}>
                      Level {value}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("downloads")}
            className="rc-button rc-button--primary"
          >
            Save customer download settings
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="defaults"
        title="Distribution and product defaults"
        description="Pre-fill common organization, metadata, and pricing values."
        summary={defaultLabelName || "Not configured"}
      >
        <ActionFeedback feedback={feedbackFor("defaults")} />
        <div className="rc-settings-grid" style={styles.grid}>
          <Field label="Default label name">
            <input
              value={defaultLabelName}
              onChange={(e) => setDefaultLabelName(e.target.value)}
              className="rc-control"
            />
          </Field>
          <Field label="Default copyright holder">
            <input
              value={defaultCopyrightHolder}
              onChange={(e) => setDefaultCopyrightHolder(e.target.value)}
              className="rc-control"
            />
          </Field>
          <Field label="Default genre">
            <Select
              value={defaultGenre}
              onChange={(e) => setDefaultGenre(e.target.value)}
              options={GENRES}
              placeholder="No default genre"
            />
          </Field>
          <Field label="Default track language">
            <Select
              value={defaultLanguage}
              onChange={(e) => setDefaultLanguage(e.target.value)}
              options={LANGUAGES}
              placeholder="No default language"
            />
          </Field>
          <Field
            label="Default track price"
            help="Used when creating or syncing individual digital track products from Distribution."
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={defaultTrackPrice}
              onChange={(e) => setDefaultTrackPrice(e.target.value)}
              className="rc-control"
            />
          </Field>
          <Field
            label="Default Album / EP price"
            help="Used for the release-level Album/EP product. The Distribution workspace can override it per release."
          >
            <input
              type="number"
              min="0"
              step="0.01"
              value={defaultAlbumPrice}
              onChange={(e) => setDefaultAlbumPrice(e.target.value)}
              className="rc-control"
            />
          </Field>
        </div>
        <div className="rc-form-actions" style={styles.actionRow}>
          <button
            type="button"
            disabled={busy}
            onClick={() => save("defaults")}
            className="rc-button rc-button--primary"
          >
            Save defaults
          </button>
        </div>
      </CollapsibleSection>
    </s-page>
  );
}

const styles = {
  hero: { padding: "3px 0 7px" },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#6d7175",
    marginBottom: 7,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 750,
    color: "#202223",
    marginBottom: 7,
  },
  heroCopy: { maxWidth: 800, color: "#6d7175", lineHeight: 1.5 },
  sectionIntro: {
    fontSize: 13,
    color: "#6d7175",
    lineHeight: 1.5,
    marginBottom: 16,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 14,
  },
  field: { display: "block", minWidth: 0 },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 650,
    color: "#303030",
    marginBottom: 6,
  },
  help: {
    display: "block",
    fontSize: 11,
    color: "#6d7175",
    lineHeight: 1.4,
    marginTop: 6,
  },
  input: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    height: 40,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 11px",
    font: "inherit",
    background: "#fff",
    color: "#202223",
  },
  readonly: {
    height: 40,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    padding: "0 11px",
    border: "1px solid #e1e3e5",
    borderRadius: 8,
    background: "#f6f6f7",
    color: "#5c5f62",
    fontSize: 12,
  },
  toggleGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
    gap: 10,
  },
  toggle: {
    display: "flex",
    gap: 9,
    alignItems: "flex-start",
    border: "1px solid #e3e3e3",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    fontSize: 12,
    marginTop: 10,
  },
  toggleHelp: {
    display: "block",
    color: "#6d7175",
    fontWeight: 400,
    lineHeight: 1.4,
    marginTop: 3,
  },
  choiceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
    gap: 10,
  },
  choice: {
    display: "flex",
    gap: 10,
    border: "1px solid #d8dadd",
    borderRadius: 11,
    padding: 14,
    background: "#fff",
    fontSize: 12,
  },
  choiceActive: { borderColor: "#303030", boxShadow: "0 0 0 1px #303030" },
  previewCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 17,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #e1e3e5",
    background: "#fafafa",
  },
  previewLabel: {
    fontSize: 11,
    color: "#6d7175",
    fontWeight: 650,
    marginBottom: 5,
  },
  previewCode: {
    fontSize: 21,
    fontWeight: 750,
    letterSpacing: ".06em",
    color: "#202223",
  },
  previewMeta: { fontSize: 12, color: "#6d7175" },
  actionRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 9,
    flexWrap: "wrap",
    marginTop: 18,
  },
  primaryButton: {
    appearance: "none",
    border: "1px solid #303030",
    borderRadius: 8,
    background: "#303030",
    color: "#fff",
    minHeight: 36,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  secondaryButton: {
    appearance: "none",
    border: "1px solid #8c9196",
    borderRadius: 8,
    background: "#fff",
    color: "#303030",
    minHeight: 36,
    padding: "0 14px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  noticeGood: {
    maxWidth: 1000,
    margin: "0 auto 12px",
    borderRadius: 8,
    background: "#eaf7ee",
    color: "#176c37",
    padding: "10px 13px",
    fontSize: 13,
  },
  noticeBad: {
    maxWidth: 1000,
    margin: "0 auto 12px",
    borderRadius: 8,
    background: "#fff1f0",
    color: "#8e1f0b",
    padding: "10px 13px",
    fontSize: 13,
  },
  shopifySetup: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
    flexWrap: "wrap",
    border: "1px solid #e1e3e5",
    borderRadius: 12,
    padding: 16,
    background: "#fafafa",
  },
  setupTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#202223",
    marginBottom: 4,
  },
  muted: { fontSize: 12, color: "#6d7175", lineHeight: 1.45 },
  smallList: {
    fontSize: 11,
    color: "#8a5700",
    marginTop: 6,
    maxWidth: 760,
    lineHeight: 1.4,
  },
  leadTimeCard: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: 18,
    alignItems: "end",
    marginTop: 14,
    padding: 16,
    border: "1px solid #e1e3e5",
    borderRadius: 12,
    background: "#fafafa",
  },
};
export const headers = (headersArgs) => boundary.headers(headersArgs);
