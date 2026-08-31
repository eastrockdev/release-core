import { useState } from "react";
import { useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { typeLabel } from "../lib/releasecore";
import { authenticatedPost } from "../lib/authenticated-post";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const OPTIONS = [
  {
    type: "SINGLE",
    label: "Single",
    detail: "One-track release",
    note: "Best for a standalone song.",
  },
  {
    type: "EP",
    label: "EP",
    detail: "Multi-track release",
    note: "Build the tracklist after creation.",
  },
  {
    type: "ALBUM",
    label: "Album",
    detail: "Multi-track release",
    note: "Build and manage the full tracklist.",
  },
];

export default function NewRelease() {
  const [type, setType] = useState("SINGLE");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const createRelease = async () => {
    if (saving) return;
    setSaving(true);
    setError("");

    try {
      const formData = new FormData();
      formData.set("type", type);
      formData.set("title", title);

      const data = await authenticatedPost(
        shopify,
        "/api/releases/create",
        formData,
      );

      shopify.toast.show(`${typeLabel(type)} draft created`);
      navigate(`/app/release/${data.releaseId}`);
    } catch (err) {
      console.error("ReleaseCore: create release request failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "ReleaseCore could not create this release.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <s-page heading="Create release">
      <s-button slot="secondary-actions" onClick={() => navigate("/app/releases")}>
        Cancel
      </s-button>

      <div style={styles.pageStack}>
        <s-section>
          <div style={styles.intro}>
            <div style={styles.eyebrow}>New distribution release</div>
            <div style={styles.title}>Start once. Build the tracklist next.</div>
            <div style={styles.copy}>
              ReleaseCore uses the same release workspace for every format. The
              type defines the release; tracks, metadata and credits are managed
              from the workspace after creation.
            </div>
          </div>
        </s-section>

        <div style={styles.sectionGap}>
          <s-section heading="1. Choose a format">
            <div style={styles.optionGrid}>
              {OPTIONS.map((option) => {
                const selected = type === option.type;
                return (
                  <button
                    type="button"
                    key={option.type}
                    onClick={() => setType(option.type)}
                    style={{
                      ...styles.option,
                      ...(selected ? styles.optionSelected : {}),
                    }}
                    aria-pressed={selected}
                  >
                    <div style={styles.optionTop}>
                      <span style={styles.optionLabel}>{option.label}</span>
                      <span
                        style={{
                          ...styles.radio,
                          ...(selected ? styles.radioSelected : {}),
                        }}
                      >
                        {selected ? <span style={styles.radioDot} /> : null}
                      </span>
                    </div>
                    <div style={styles.optionDetail}>{option.detail}</div>
                    <div style={styles.optionNote}>{option.note}</div>
                  </button>
                );
              })}
            </div>
          </s-section>
        </div>

        <div style={styles.sectionGap}>
          <s-section heading="2. Name the release">
            <label style={styles.label} htmlFor="release-title">
              Release title
            </label>
            <input
              id="release-title"
              name="title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createRelease();
                }
              }}
              placeholder={`e.g. ${
                type === "SINGLE"
                  ? "Running Away"
                  : type === "EP"
                    ? "After Hours"
                    : "Midnight in New Haven"
              }`}
              style={styles.input}
            />
            <div style={styles.help}>
              Optional for now. You can change the title from the release
              workspace at any time.
            </div>

            {error ? <div style={styles.error}>{error}</div> : null}

            <div style={styles.footerActions}>
              <s-button onClick={() => navigate("/app/releases")}>Cancel</s-button>
              <button
                type="button"
                disabled={saving}
                onClick={createRelease}
                style={{
                  ...styles.submit,
                  ...(saving ? styles.submitDisabled : {}),
                }}
              >
                {saving ? "Creating…" : `Create ${typeLabel(type)}`}
              </button>
            </div>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}

const styles = {
  pageStack: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  sectionGap: {
    display: "block",
    marginTop: 8,
  },
  intro: { padding: "2px 0 6px" },
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "#6d7175",
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#202223",
    marginBottom: 8,
  },
  copy: { color: "#6d7175", lineHeight: 1.5, maxWidth: 760 },
  optionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px,1fr))",
    gap: 12,
  },
  option: {
    appearance: "none",
    width: "100%",
    textAlign: "left",
    border: "1px solid #d8d8d8",
    borderRadius: 14,
    background: "#fff",
    padding: 18,
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
    minHeight: 132,
  },
  optionSelected: {
    border: "2px solid #303030",
    padding: 17,
    boxShadow: "0 0 0 2px rgba(48,48,48,.06)",
  },
  optionTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  optionLabel: { fontSize: 17, fontWeight: 750, color: "#202223" },
  optionDetail: { fontSize: 12, fontWeight: 650, color: "#303030", marginBottom: 5 },
  optionNote: { fontSize: 12, lineHeight: 1.4, color: "#6d7175" },
  radio: {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid #aeb4b9",
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  },
  radioSelected: { borderColor: "#303030" },
  radioDot: { width: 8, height: 8, borderRadius: "50%", background: "#303030" },
  label: { display: "block", fontSize: 12, fontWeight: 650, color: "#303030", marginBottom: 6 },
  input: {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    height: 42,
    border: "1px solid #8c9196",
    borderRadius: 8,
    padding: "0 12px",
    font: "inherit",
    color: "#202223",
    background: "#fff",
  },
  help: { color: "#6d7175", fontSize: 11, lineHeight: 1.4, marginTop: 7 },
  error: {
    marginTop: 12,
    borderRadius: 8,
    padding: "10px 12px",
    background: "#fff1f0",
    color: "#8e1f0b",
    fontSize: 12,
  },
  footerActions: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
  },
  submit: {
    appearance: "none",
    border: "1px solid #303030",
    borderRadius: 8,
    background: "#303030",
    color: "#fff",
    minHeight: 38,
    padding: "0 15px",
    font: "inherit",
    fontWeight: 650,
    cursor: "pointer",
  },
  submitDisabled: { opacity: 0.6, cursor: "wait" },
};

export const headers = (headersArgs) => boundary.headers(headersArgs);
