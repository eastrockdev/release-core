import { useMemo, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  buildBackCatalogTemplateCsv,
  importBackCatalogCsv,
  previewBackCatalogCsv,
} from "../lib/back-catalog-import.server";
import { apiErrorResponse } from "../lib/http-security.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  if (url.searchParams.get("template") === "1") {
    return new Response(buildBackCatalogTemplateCsv(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="releasecore-back-catalog-template.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  const artists = await db.artist.findMany({
    where: { shop: session.shop },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return { artists };
};

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const form = await request.formData();
    const intent = String(form.get("intent") || "preview");
    const artistId = String(form.get("artistId") || "").trim();
    const csvText = String(form.get("csvText") || "");
    const importState = String(form.get("importState") || "CATALOG");

    if (intent === "import") {
      const result = await importBackCatalogCsv({
        shop: session.shop,
        artistId,
        csvText,
        importState,
      });
      return Response.json({ ok: true, ...result });
    }

    const preview = await previewBackCatalogCsv({
      shop: session.shop,
      artistId,
      csvText,
    });
    return Response.json({ ok: true, preview });
  } catch (error) {
    return apiErrorResponse(request, error, {
      context: "back catalog CSV import",
      fallback: "ReleaseCore could not process this back catalog CSV.",
    });
  }
};

function formatReleaseDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function BackCatalogImportPage() {
  const { artists = [] } = useLoaderData();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [artistId, setArtistId] = useState(artists[0]?.id || "");
  const [importState, setImportState] = useState("CATALOG");
  const [filename, setFilename] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const selectedArtist = useMemo(
    () => artists.find((artist) => artist.id === artistId) || null,
    [artists, artistId],
  );

  const loadCsv = async (event) => {
    const file = event.target.files?.[0];
    setPreview(null);
    setNotice(null);
    if (!file) {
      setFilename("");
      setCsvText("");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFilename("");
      setCsvText("");
      setNotice({ tone: "bad", message: "Choose a .csv file created from the ReleaseCore template." });
      event.target.value = "";
      return;
    }

    if (file.size > 2_000_000) {
      setFilename("");
      setCsvText("");
      setNotice({ tone: "bad", message: "The CSV must be smaller than 2 MB." });
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      setFilename(file.name);
      setCsvText(text);
    } catch {
      setFilename("");
      setCsvText("");
      setNotice({ tone: "bad", message: "ReleaseCore could not read that CSV file." });
    }
  };

  const postCsv = async (intent) => {
    if (busy || !csvText || !artistId) return;
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("intent", intent);
      form.set("artistId", artistId);
      form.set("csvText", csvText);
      form.set("importState", importState);
      const result = await authenticatedPost(shopify, "/app/import/back-catalog", form);

      if (intent === "preview") {
        setPreview(result.preview);
        if (result.preview?.valid) shopify.toast.show("Back catalog CSV is ready to import");
        else shopify.toast.show("Back catalog CSV needs attention");
        return;
      }

      if (result.warnings?.length) {
        sessionStorage.setItem("releasecore-import-warnings", JSON.stringify(result.warnings));
      }
      shopify.toast.show(`Imported ${result.trackCount || 0} back catalog track${result.trackCount === 1 ? "" : "s"}`);
      navigate(`/app/release/${result.releaseId}`);
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not process the CSV." });
    } finally {
      setBusy(false);
    }
  };

  const canPreview = Boolean(artistId && csvText && !busy);
  const canImport = Boolean(preview?.valid && canPreview);

  return (
    <s-page heading="Import back catalog CSV">
      <s-button slot="primary-action" onClick={() => navigate("/app/import")}>Shopify product import</s-button>

      <s-section>
        <div style={styles.hero}>
          <div style={styles.eyebrow}>Back catalog</div>
          <div style={styles.title}>Import a complete existing project from CSV.</div>
          <div style={styles.copy}>
            Use one CSV per Single, EP or Album. ReleaseCore imports release metadata, track order and identifiers without creating artists, collaborators, contributors or credits.
          </div>
        </div>
      </s-section>

      {notice ? (
        <s-section>
          <div style={styles.notice}>{notice.message}</div>
        </s-section>
      ) : null}

      <s-section heading="1. Download the template">
        <div style={styles.split}>
          <div>
            <div style={styles.sectionTitle}>Start with ReleaseCore’s multi-track CSV</div>
            <div style={styles.muted}>
              The template includes project title/type/date, UPC, catalog number, label, P-line, genre, URLs, track number/title/version/language, explicit flag, ISRC and lyrics. Artist and credit columns are intentionally excluded.
            </div>
          </div>
          <a className="rc-secondary-link" href="/app/import/back-catalog?template=1" download>
            Download CSV template
          </a>
        </div>
      </s-section>

      <s-section heading="2. Choose existing artist">
        {artists.length ? (
          <div className="rc-import-grid" style={styles.grid}>
            <label style={styles.field}>
              <span style={styles.label}>Primary artist</span>
              <select
                className="rc-control"
                value={artistId}
                onChange={(event) => {
                  setArtistId(event.target.value);
                  setPreview(null);
                }}
              >
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>{artist.name}</option>
                ))}
              </select>
              <span style={styles.help}>Only existing ReleaseCore artists are available. This importer never creates a new artist record.</span>
            </label>
            <label style={styles.field}>
              <span style={styles.label}>Imported release state</span>
              <select
                className="rc-control"
                value={importState}
                onChange={(event) => setImportState(event.target.value)}
              >
                <option value="CATALOG">Existing / distributed catalog</option>
                <option value="DRAFT">Draft — review and complete later</option>
              </select>
              <span style={styles.help}>Existing catalog marks the project approved and delivered without replaying ReleaseCore’s submission workflow.</span>
            </label>
          </div>
        ) : (
          <div style={styles.notice}>
            No artists exist in ReleaseCore yet. Create or import the artist first, then return here. Back catalog CSV import will not create one automatically.
          </div>
        )}
      </s-section>

      <s-section heading="3. Upload and validate CSV">
        <div style={styles.uploadBox}>
          <label style={styles.fileLabel}>
            <span style={styles.sectionTitle}>{filename || "Choose back catalog CSV"}</span>
            <span style={styles.muted}>One project per file · CSV only · maximum 2 MB</span>
            <input type="file" accept=".csv,text/csv" onChange={loadCsv} style={styles.fileInput} />
          </label>
        </div>
        <div style={styles.actions}>
          <s-button variant="primary" disabled={!canPreview} onClick={() => postCsv("preview")}>
            {busy ? "Checking…" : "Preview import"}
          </s-button>
          <s-button onClick={() => navigate("/app/releases")}>Cancel</s-button>
        </div>
      </s-section>

      {preview ? (
        <s-section heading="4. Review import">
          <div style={styles.summaryGrid}>
            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Project</span>
              <strong>{preview.release?.title || "Untitled"}</strong>
              <span style={styles.muted}>{preview.release?.type || "—"} · {formatReleaseDate(preview.release?.releaseDate)}</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Artist</span>
              <strong>{selectedArtist?.name || preview.artist?.name || "Not selected"}</strong>
              <span style={styles.muted}>Existing ReleaseCore artist</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Tracks</span>
              <strong>{preview.tracks?.length || 0}</strong>
              <span style={styles.muted}>ISRC checked before import</span>
            </div>
            <div style={styles.summaryCard}>
              <span style={styles.summaryLabel}>Identifiers</span>
              <strong>{preview.release?.upc || "No UPC"}</strong>
              <span style={styles.muted}>{preview.release?.catalogNumber || "No catalog number"}</span>
            </div>
          </div>

          {preview.errors?.length ? (
            <div style={{ ...styles.validation, ...styles.validationBad }}>
              <strong>Fix before importing</strong>
              <ul style={styles.list}>{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          ) : (
            <div style={{ ...styles.validation, ...styles.validationGood }}>
              <strong>Ready to import</strong>
              <span>All required metadata and duplicate identifier checks passed.</span>
            </div>
          )}

          {preview.warnings?.length ? (
            <div style={styles.validation}>
              <strong>Review warnings</strong>
              <ul style={styles.list}>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          ) : null}

          <div style={styles.trackTableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Track</th>
                  <th style={styles.th}>ISRC</th>
                  <th style={styles.th}>Language</th>
                  <th style={styles.th}>Explicit</th>
                </tr>
              </thead>
              <tbody>
                {(preview.tracks || []).map((track) => (
                  <tr key={`${track.position}-${track.isrc}`}>
                    <td style={styles.td}>{track.position}</td>
                    <td style={styles.td}><strong>{track.title}</strong>{track.version ? <div style={styles.muted}>{track.version}</div> : null}</td>
                    <td style={styles.td}><code>{track.isrc}</code></td>
                    <td style={styles.td}>{track.language || "—"}</td>
                    <td style={styles.td}>{track.explicit ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.identityGuard}>
            <strong>Identity safety</strong>
            <span>This operation creates the Release and Track rows only. It links the selected existing artist and does not create or modify Contributor, TrackCredit, featured-artist or collaborator records.</span>
          </div>

          <div style={styles.actions}>
            <s-button variant="primary" disabled={!canImport} onClick={() => postCsv("import")}>
              {busy ? "Importing…" : `Import ${preview.tracks?.length || 0} track${preview.tracks?.length === 1 ? "" : "s"}`}
            </s-button>
            <s-button disabled={busy} onClick={() => postCsv("preview")}>Refresh validation</s-button>
          </div>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

const styles = {
  hero: { padding: "4px 0 8px" },
  eyebrow: { fontSize: 12, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase", color: "#6d7175" },
  title: { fontSize: 28, lineHeight: 1.15, fontWeight: 750, marginTop: 6, maxWidth: 760 },
  copy: { color: "#6d7175", maxWidth: 860, marginTop: 8, lineHeight: 1.5 },
  sectionTitle: { fontSize: 15, fontWeight: 700, marginBottom: 5 },
  muted: { color: "#6d7175", fontSize: 12, lineHeight: 1.45 },
  split: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 12, fontWeight: 700 },
  help: { color: "#6d7175", fontSize: 11, lineHeight: 1.4 },
  uploadBox: { border: "1px dashed #b7bdc4", borderRadius: 12, padding: 22, background: "#fafbfb" },
  fileLabel: { display: "grid", gap: 5, cursor: "pointer" },
  fileInput: { marginTop: 10, maxWidth: 460 },
  actions: { display: "flex", gap: 9, flexWrap: "wrap", marginTop: 18 },
  notice: { padding: 12, border: "1px solid #d72c0d55", borderRadius: 9, lineHeight: 1.45 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10, marginBottom: 14 },
  summaryCard: { display: "grid", gap: 5, border: "1px solid #dedede", borderRadius: 10, padding: 12, minWidth: 0 },
  summaryLabel: { color: "#6d7175", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" },
  validation: { display: "grid", gap: 6, marginTop: 10, padding: 12, borderRadius: 10, background: "#f6f6f7", fontSize: 12 },
  validationBad: { border: "1px solid #d72c0d55", background: "#fff4f2" },
  validationGood: { border: "1px solid #00806055", background: "#f1f8f5" },
  list: { margin: 0, paddingLeft: 20, display: "grid", gap: 4 },
  trackTableWrap: { overflowX: "auto", marginTop: 14, border: "1px solid #dedede", borderRadius: 10 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 680, fontSize: 12 },
  th: { textAlign: "left", padding: "10px 12px", background: "#f6f6f7", color: "#5c5f62", borderBottom: "1px solid #dedede" },
  td: { padding: "10px 12px", borderBottom: "1px solid #eee", verticalAlign: "top" },
  identityGuard: { display: "grid", gap: 4, marginTop: 14, padding: 13, borderRadius: 10, background: "#f6f6f7", color: "#4a4a4a", fontSize: 12 },
};
