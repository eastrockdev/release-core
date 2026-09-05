import { useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AUTOMATION_EVENT_KEYS } from "../lib/automations";
import { authenticatedPost } from "../lib/authenticated-post";
import { revalidateInPlace } from "../lib/revalidate-in-place";
import { ActionFeedback, CollapsibleSection, PageIntro } from "../components/releasecore-ui";
import { loadAutomationSettings } from "../lib/automation-settings.server";

const LABELS = {
  SUBMITTED: "Submitted / resubmitted",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PROCESSING: "Distribution processing",
  SUBMITTED_TO_STORES: "Submitted to stores",
  DELIVERED: "Distribution complete",
  SHOPIFY_PRODUCTS_SYNCED: "Shopify products synced",
};

const csvSet = (value) =>
  new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
const setCsv = (set) => [...set].join(",");

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return loadAutomationSettings(session.shop);
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

function Toggle({ checked, onChange, title, help }) {
  return (
    <label style={styles.toggle}>
      <input
        type="checkbox"
        className="rc-choice-input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {help ? <span style={styles.help}>{help}</span> : null}
      </span>
    </label>
  );
}

export default function AutomationPage() {
  const { settings: raw } = useLoaderData();
  const s = raw || {};
  const shopify = useAppBridge();
  const revalidator = useRevalidator();

  const [singleEnabled, setSingleEnabled] = useState(s.releaseSingleEnabled ?? true);
  const [singleTags, setSingleTags] = useState(s.releaseSingleRequiredTags || "");
  const [epEnabled, setEpEnabled] = useState(s.releaseEpEnabled ?? true);
  const [epTags, setEpTags] = useState(s.releaseEpRequiredTags || "");
  const [albumEnabled, setAlbumEnabled] = useState(s.releaseAlbumEnabled ?? true);
  const [albumTags, setAlbumTags] = useState(s.releaseAlbumRequiredTags || "");
  const [matchMode, setMatchMode] = useState(s.releaseTagMatchMode || "ANY");
  const [lockMessage, setLockMessage] = useState(s.releaseAccessLockMessage || "");
  const [flowEvents, setFlowEvents] = useState(
    csvSet(
      s.flowEvents ||
        "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,PROCESSING,SUBMITTED_TO_STORES,DELIVERED,SHOPIFY_PRODUCTS_SYNCED",
    ),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const flowRows = useMemo(
    () => AUTOMATION_EVENT_KEYS.map((key) => ({ key, label: LABELS[key] || key })),
    [],
  );

  const toggleFlow = (key) => {
    const next = new Set(flowEvents);
    next.has(key) ? next.delete(key) : next.add(key);
    setFlowEvents(next);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setNotice({ tone: "info", message: "Saving release access rules…" });
    try {
      const form = new FormData();
      form.set("intent", "save-access-settings");
      if (singleEnabled) form.set("releaseSingleEnabled", "on");
      if (epEnabled) form.set("releaseEpEnabled", "on");
      if (albumEnabled) form.set("releaseAlbumEnabled", "on");
      form.set("releaseSingleRequiredTags", singleTags);
      form.set("releaseEpRequiredTags", epTags);
      form.set("releaseAlbumRequiredTags", albumTags);
      form.set("releaseTagMatchMode", matchMode);
      form.set("releaseAccessLockMessage", lockMessage);
      form.set("flowEvents", setCsv(flowEvents));

      const response = await authenticatedPost(shopify, "/api/automation", form);
      setNotice({ tone: "good", message: response.message || "Release access rules saved." });
      shopify.toast.show("Release access rules saved");
      await revalidateInPlace(revalidator);
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not save release access rules." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="Release access rules">
      <s-section>
        <PageIntro title="Control which customers can create each release type.">
          Use Shopify customer tags for plan or roster access. Email settings now live under Notifications so access rules stay focused here.
        </PageIntro>
      </s-section>

      <ActionFeedback feedback={notice} />

      <CollapsibleSection
        icon="artist"
        title="Release types"
        description="Choose who can create Singles, EPs, and Albums."
        summary="Customer tags"
        defaultOpen
      >
        <div style={styles.stack}>
          <div style={styles.card}>
            <Toggle
              checked={singleEnabled}
              onChange={setSingleEnabled}
              title="Singles"
              help="Disable to hide and block Single creation for everyone."
            />
            <Field label="Required customer tags" help="Comma-separated. Leave blank for everyone.">
              <input className="rc-control" value={singleTags} onChange={(event) => setSingleTags(event.target.value)} placeholder="RLIAB, RLIAB_PRO" />
            </Field>
          </div>
          <div style={styles.card}>
            <Toggle checked={epEnabled} onChange={setEpEnabled} title="EPs" help="The same rule is enforced on the server, not only in the storefront." />
            <Field label="Required customer tags" help="Comma-separated. Leave blank for everyone.">
              <input className="rc-control" value={epTags} onChange={(event) => setEpTags(event.target.value)} placeholder="RLIAB_PRO" />
            </Field>
          </div>
          <div style={styles.card}>
            <Toggle checked={albumEnabled} onChange={setAlbumEnabled} title="Albums" />
            <Field label="Required customer tags" help="Comma-separated. Leave blank for everyone.">
              <input className="rc-control" value={albumTags} onChange={(event) => setAlbumTags(event.target.value)} placeholder="RLIAB_PRO, PARTNER" />
            </Field>
          </div>
          <div style={styles.grid}>
            <Field label="Tag matching" help="ANY grants access when one required tag matches. ALL requires every listed tag.">
              <select className="rc-control" value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
                <option value="ANY">Match any required tag</option>
                <option value="ALL">Require all listed tags</option>
              </select>
            </Field>
            <Field label="Message shown when locked">
              <input className="rc-control" value={lockMessage} onChange={(event) => setLockMessage(event.target.value)} placeholder="Upgrade your plan to unlock this release type." />
            </Field>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="history"
        title="Shopify Flow"
        description="Choose which release events trigger the ReleaseCore Shopify Flow action."
        summary={`${flowEvents.size} events`}
      >
        <div style={styles.flowList}>
          {flowRows.map((row) => (
            <label key={row.key} style={styles.flowRow}>
              <input
                type="checkbox"
                className="rc-choice-input"
                checked={flowEvents.has(row.key)}
                onChange={() => toggleFlow(row.key)}
              />
              <span>{row.label}</span>
            </label>
          ))}
        </div>
        <div style={{ ...styles.help, marginTop: 12 }}>
          Shopify Flow receives the customer context when the release has an owning customer, so your Flow conditions can use customer tags.
        </div>
      </CollapsibleSection>

      <s-section>
        <div className="rc-form-actions" style={styles.actions}>
          <button className="rc-button rc-button--primary" disabled={busy} onClick={save}>
            Save release access rules
          </button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (args) => boundary.headers(args);

const styles = {
  stack: { display: "grid", gap: 14 },
  card: {
    display: "grid",
    gridTemplateColumns: "minmax(220px,.8fr) minmax(280px,1.4fr)",
    gap: 18,
    padding: 16,
    border: "1px solid #dedede",
    borderRadius: 12,
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 13, fontWeight: 650 },
  help: { display: "block", fontSize: 12, color: "#6d7175", lineHeight: 1.45, marginTop: 4 },
  toggle: { display: "flex", gap: 10, alignItems: "flex-start" },
  flowList: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8 },
  flowRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #e3e3e3", borderRadius: 10 },
  actions: { display: "flex", justifyContent: "flex-end" },
};
