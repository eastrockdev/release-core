import { useMemo, useState } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { AUTOMATION_EVENT_KEYS } from "../lib/automations";
import { authenticatedPost } from "../lib/authenticated-post";
import { smtpEncryptionConfigured } from "../lib/smtp.server";

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
  new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
const setCsv = (set) => [...set].join(",");

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const stored = await db.appSettings.findUnique({ where: { shop: session.shop } });
  if (!stored) {
    return {
      settings: null,
      smtpPasswordStored: false,
      encryptionConfigured: smtpEncryptionConfigured(),
    };
  }
  const { smtpPasswordEncrypted, ...settings } = stored;
  return {
    settings,
    smtpPasswordStored: Boolean(smtpPasswordEncrypted),
    encryptionConfigured: smtpEncryptionConfigured(),
  };
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
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{title}</strong>
        {help ? <span style={styles.help}>{help}</span> : null}
      </span>
    </label>
  );
}

export default function AutomationPage() {
  const { settings: raw, smtpPasswordStored, encryptionConfigured } = useLoaderData();
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

  const [artistEvents, setArtistEvents] = useState(
    csvSet(s.artistEmailEvents || "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,SUBMITTED_TO_STORES,DELIVERED"),
  );
  const [adminEvents, setAdminEvents] = useState(
    csvSet(s.adminEmailEvents || "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED"),
  );
  const [flowEvents, setFlowEvents] = useState(
    csvSet(s.flowEvents || "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,PROCESSING,SUBMITTED_TO_STORES,DELIVERED,SHOPIFY_PRODUCTS_SYNCED"),
  );

  const [smtpEnabled, setSmtpEnabled] = useState(s.smtpEnabled ?? false);
  const [smtpHost, setSmtpHost] = useState(s.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(String(s.smtpPort || 587));
  const [smtpSecurity, setSmtpSecurity] = useState(s.smtpSecurity || "STARTTLS");
  const [smtpUsername, setSmtpUsername] = useState(s.smtpUsername || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);
  const [testEmail, setTestEmail] = useState(s.adminNotificationEmail || s.emailFromAddress || "");

  const [senderName, setSenderName] = useState(s.emailSenderName || "");
  const [fromAddress, setFromAddress] = useState(s.emailFromAddress || "");
  const [replyTo, setReplyTo] = useState(s.emailReplyTo || "");
  const [adminEmail, setAdminEmail] = useState(s.adminNotificationEmail || "");
  const [brandName, setBrandName] = useState(s.emailBrandName || "");
  const [footer, setFooter] = useState(s.emailFooterText || "");
  const [portalUrl, setPortalUrl] = useState(s.portalUrl || "");

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const toggle = (setter, current, key) => {
    const next = new Set(current);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const appendCommonSettings = (form) => {
    form.set("intent", "save-automation");
    [["releaseSingleEnabled", singleEnabled], ["releaseEpEnabled", epEnabled], ["releaseAlbumEnabled", albumEnabled]].forEach(
      ([key, value]) => {
        if (value) form.set(key, "on");
      },
    );
    form.set("releaseSingleRequiredTags", singleTags);
    form.set("releaseEpRequiredTags", epTags);
    form.set("releaseAlbumRequiredTags", albumTags);
    form.set("releaseTagMatchMode", matchMode);
    form.set("releaseAccessLockMessage", lockMessage);
    form.set("artistEmailEvents", setCsv(artistEvents));
    form.set("adminEmailEvents", setCsv(adminEvents));
    form.set("flowEvents", setCsv(flowEvents));

    if (smtpEnabled) form.set("smtpEnabled", "on");
    form.set("smtpHost", smtpHost);
    form.set("smtpPort", smtpPort);
    form.set("smtpSecurity", smtpSecurity);
    form.set("smtpUsername", smtpUsername);
    if (smtpPassword) form.set("smtpPassword", smtpPassword);
    if (clearSmtpPassword) form.set("clearSmtpPassword", "on");

    form.set("emailSenderName", senderName);
    form.set("emailFromAddress", fromAddress);
    form.set("emailReplyTo", replyTo);
    form.set("adminNotificationEmail", adminEmail);
    form.set("emailBrandName", brandName);
    form.set("emailFooterText", footer);
    form.set("portalUrl", portalUrl);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      appendCommonSettings(form);
      const response = await authenticatedPost(shopify, "/api/automation", form);
      setSmtpPassword("");
      setClearSmtpPassword(false);
      setNotice({ tone: "good", message: response.message || "Automation settings saved." });
      shopify.toast.show("Automation settings saved");
      await revalidator.revalidate();
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not save automation settings." });
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("intent", "test-smtp");
      const response = await authenticatedPost(shopify, "/api/automation", form);
      setNotice({ tone: "good", message: response.message });
      shopify.toast.show("SMTP connection succeeded");
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "SMTP connection failed." });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("intent", "send-test-email");
      form.set("testEmail", testEmail);
      const response = await authenticatedPost(shopify, "/api/automation", form);
      setNotice({ tone: "good", message: response.message });
      shopify.toast.show("Test email sent");
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not send test email." });
    } finally {
      setBusy(false);
    }
  };

  const channelRows = useMemo(
    () => AUTOMATION_EVENT_KEYS.map((key) => ({ key, label: LABELS[key] || key })),
    [],
  );

  const passwordState = clearSmtpPassword
    ? "Stored password will be removed when you save."
    : smtpPassword
      ? "A new password will be encrypted and stored when you save."
      : smtpPasswordStored
        ? "A password is already stored securely. Leave this blank to keep it."
        : "No SMTP password is currently stored.";

  return (
    <s-page heading="Automation & access">
      <s-section>
        <div style={styles.hero}>
          <div style={styles.eyebrow}>Milestone 9</div>
          <div style={styles.title}>Portal access, SMTP, notifications & Flow</div>
          <div style={styles.copy}>
            Control release-format access by Shopify customer tag and deliver transactional email through each merchant&apos;s own SMTP server.
          </div>
        </div>
      </s-section>

      {notice ? (
        <s-section>
          <div style={{ ...styles.notice, borderColor: notice.tone === "bad" ? "#d72c0d55" : "#16803d55" }}>
            {notice.message}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Distribution access by customer tag">
        <div style={styles.stack}>
          <div style={styles.card}>
            <Toggle checked={singleEnabled} onChange={setSingleEnabled} title="Single distribution" help="Disable to hide/lock Singles for everyone." />
            <Field label="Required customer tags" help="Comma-separated. Leave blank for everyone.">
              <input style={styles.input} value={singleTags} onChange={(event) => setSingleTags(event.target.value)} placeholder="RLIAB, RLIAB_PRO" />
            </Field>
          </div>
          <div style={styles.card}>
            <Toggle checked={epEnabled} onChange={setEpEnabled} title="EP distribution" help="Server-side enforcement prevents bypassing the storefront lock." />
            <Field label="Required customer tags">
              <input style={styles.input} value={epTags} onChange={(event) => setEpTags(event.target.value)} placeholder="RLIAB_PRO" />
            </Field>
          </div>
          <div style={styles.card}>
            <Toggle checked={albumEnabled} onChange={setAlbumEnabled} title="Album distribution" />
            <Field label="Required customer tags">
              <input style={styles.input} value={albumTags} onChange={(event) => setAlbumTags(event.target.value)} placeholder="RLIAB_PRO, PARTNER" />
            </Field>
          </div>
          <div style={styles.grid}>
            <Field label="Tag matching" help="ANY allows access when one required tag matches. ALL requires every listed tag.">
              <select style={styles.input} value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
                <option value="ANY">Match any required tag</option>
                <option value="ALL">Require all listed tags</option>
              </select>
            </Field>
            <Field label="Locked message">
              <input style={styles.input} value={lockMessage} onChange={(event) => setLockMessage(event.target.value)} placeholder="Upgrade your plan to unlock this release type." />
            </Field>
          </div>
        </div>
      </s-section>

      <s-section heading="Transactional email · Custom SMTP">
        <div style={styles.stack}>
          <div style={styles.notice}>
            {encryptionConfigured
              ? "SMTP credential encryption is configured on this ReleaseCore server."
              : "RELEASECORE_ENCRYPTION_KEY is missing. Add it to the server environment before saving an SMTP password."}
          </div>
          <Toggle
            checked={smtpEnabled}
            onChange={setSmtpEnabled}
            title="Enable SMTP email delivery"
            help="ReleaseCore sends through this store's own mail server. Email failures never block the underlying release workflow."
          />
          <div style={styles.grid}>
            <Field label="SMTP host" help="Examples: smtp.example.com, smtp.office365.com">
              <input style={styles.input} value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <input style={styles.input} type="number" min="1" max="65535" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} />
            </Field>
            <Field label="Security">
              <select style={styles.input} value={smtpSecurity} onChange={(event) => setSmtpSecurity(event.target.value)}>
                <option value="STARTTLS">STARTTLS · usually port 587</option>
                <option value="SSL_TLS">SSL/TLS · usually port 465</option>
                <option value="NONE">No transport encryption · not recommended</option>
              </select>
            </Field>
            <Field label="SMTP username" help="Leave blank only if your server explicitly allows unauthenticated SMTP.">
              <input style={styles.input} autoComplete="username" value={smtpUsername} onChange={(event) => setSmtpUsername(event.target.value)} placeholder="distribution@example.com" />
            </Field>
            <Field label="SMTP password / app password" help={passwordState}>
              <input style={styles.input} type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => { setSmtpPassword(event.target.value); if (event.target.value) setClearSmtpPassword(false); }} placeholder={smtpPasswordStored ? "Stored — enter only to replace" : "Enter SMTP password"} />
            </Field>
            <Field label="Stored credential">
              <label style={styles.inlineCheck}>
                <input type="checkbox" checked={clearSmtpPassword} onChange={(event) => { setClearSmtpPassword(event.target.checked); if (event.target.checked) setSmtpPassword(""); }} />
                Remove stored SMTP password on save
              </label>
            </Field>
          </div>

          <div style={styles.divider} />

          <div style={styles.grid}>
            <Field label="Sender name">
              <input style={styles.input} value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder="East Rock Entertainment" />
            </Field>
            <Field label="From email">
              <input style={styles.input} type="email" value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="distribution@example.com" />
            </Field>
            <Field label="Reply-to">
              <input style={styles.input} type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="support@example.com" />
            </Field>
            <Field label="Internal notification email">
              <input style={styles.input} type="email" value={adminEmail} onChange={(event) => { setAdminEmail(event.target.value); if (!testEmail) setTestEmail(event.target.value); }} placeholder="distribution-team@example.com" />
            </Field>
            <Field label="Email brand name">
              <input style={styles.input} value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="RLIAB" />
            </Field>
            <Field label="Artist portal URL">
              <input style={styles.input} value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} placeholder="https://example.com/pages/music" />
            </Field>
          </div>
          <Field label="Email footer">
            <textarea style={{ ...styles.input, minHeight: 80 }} value={footer} onChange={(event) => setFooter(event.target.value)} placeholder="Support contact, legal or label footer text." />
          </Field>

          <div style={styles.smtpTest}>
            <div>
              <strong>Connection test</strong>
              <div style={styles.help}>Save SMTP settings first. ReleaseCore can verify authentication and then send a real test message.</div>
            </div>
            <input style={{ ...styles.input, maxWidth: 310 }} type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@example.com" />
            <button style={styles.secondary} disabled={busy} onClick={testConnection}>Test connection</button>
            <button style={styles.secondary} disabled={busy} onClick={sendTest}>Send test email</button>
          </div>
        </div>
      </s-section>

      <s-section heading="Event delivery">
        <div style={styles.table}>
          <div style={styles.tableHead}>
            <strong>Release event</strong>
            <strong>Artist email</strong>
            <strong>Admin email</strong>
            <strong>Shopify Flow</strong>
          </div>
          {channelRows.map((row) => (
            <div style={styles.tableRow} key={row.key}>
              <span>{row.label}</span>
              <input type="checkbox" checked={artistEvents.has(row.key)} onChange={() => toggle(setArtistEvents, artistEvents, row.key)} />
              <input type="checkbox" checked={adminEvents.has(row.key)} onChange={() => toggle(setAdminEvents, adminEvents, row.key)} />
              <input type="checkbox" checked={flowEvents.has(row.key)} onChange={() => toggle(setFlowEvents, flowEvents, row.key)} />
            </div>
          ))}
        </div>
        <div style={styles.help}>
          Flow uses the ReleaseCore “Release event occurred” trigger. A customer owner is required so Flow can expose the Shopify customer and tags to workflow conditions.
        </div>
      </s-section>

      <s-section>
        <div style={styles.actions}>
          <button style={styles.primary} disabled={busy} onClick={save}>{busy ? "Working…" : "Save automation settings"}</button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (args) => boundary.headers(args);

const styles = {
  hero: { padding: "20px 2px" },
  eyebrow: { fontSize: 12, fontWeight: 750, letterSpacing: ".08em", textTransform: "uppercase", color: "#6d7175" },
  title: { fontSize: 28, fontWeight: 750, marginTop: 6 },
  copy: { color: "#6d7175", maxWidth: 760, marginTop: 6, lineHeight: 1.5 },
  stack: { display: "grid", gap: 14 },
  card: { display: "grid", gridTemplateColumns: "minmax(220px,.8fr) minmax(280px,1.4fr)", gap: 18, padding: 16, border: "1px solid #dedede", borderRadius: 12 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 13, fontWeight: 650 },
  help: { display: "block", fontSize: 12, color: "#6d7175", lineHeight: 1.45, marginTop: 4 },
  input: { boxSizing: "border-box", width: "100%", minHeight: 42, padding: "9px 11px", border: "1px solid #c9cccf", borderRadius: 8, background: "#fff", fontSize: 14 },
  toggle: { display: "flex", gap: 10, alignItems: "flex-start" },
  inlineCheck: { display: "flex", gap: 8, alignItems: "center", minHeight: 42, fontSize: 13 },
  notice: { padding: 12, border: "1px solid #dedede", borderRadius: 9, background: "#fafafa", fontSize: 13 },
  divider: { height: 1, background: "#e8e8e8", margin: "2px 0" },
  smtpTest: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: 14, border: "1px solid #dedede", borderRadius: 10, background: "#fafafa" },
  table: { border: "1px solid #dedede", borderRadius: 12, overflow: "hidden" },
  tableHead: { display: "grid", gridTemplateColumns: "minmax(220px,1fr) repeat(3,110px)", padding: "11px 14px", background: "#f6f6f7", gap: 8, fontSize: 12 },
  tableRow: { display: "grid", gridTemplateColumns: "minmax(220px,1fr) repeat(3,110px)", padding: "12px 14px", borderTop: "1px solid #eee", gap: 8, alignItems: "center", fontSize: 13 },
  actions: { display: "flex", justifyContent: "flex-end" },
  primary: { border: 0, borderRadius: 8, background: "#202223", color: "#fff", padding: "11px 16px", fontWeight: 650, cursor: "pointer" },
  secondary: { border: "1px solid #c9cccf", borderRadius: 8, background: "#fff", color: "#202223", padding: "10px 13px", fontWeight: 650, cursor: "pointer" },
};
