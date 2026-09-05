import { useMemo, useState } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AUTOMATION_EVENT_KEYS } from "../lib/automations";
import { authenticatedPost } from "../lib/authenticated-post";
import { revalidateInPlace } from "../lib/revalidate-in-place";
import { ActionFeedback, CollapsibleSection, PageIntro } from "../components/releasecore-ui";
import { loadAutomationSettings } from "../lib/automation-settings.server";

const EVENT_LABELS = {
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

export default function EmailSettingsPage() {
  const { settings: raw, smtpPasswordStored, resendApiKeyStored, encryptionConfigured } = useLoaderData();
  const s = raw || {};
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  const [enabled, setEnabled] = useState(s.smtpEnabled ?? false);
  const [provider, setProvider] = useState(
    String(s.emailDeliveryProvider || "SMTP").toUpperCase() === "RESEND" ? "RESEND" : "SMTP",
  );
  const [artistEvents, setArtistEvents] = useState(
    csvSet(s.artistEmailEvents || "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED,SUBMITTED_TO_STORES,DELIVERED"),
  );
  const [adminEvents, setAdminEvents] = useState(
    csvSet(s.adminEmailEvents || "SUBMITTED,CHANGES_REQUESTED,APPROVED,REJECTED"),
  );

  const [resendApiKey, setResendApiKey] = useState("");
  const [clearResendApiKey, setClearResendApiKey] = useState(false);
  const [smtpHost, setSmtpHost] = useState(s.smtpHost || "");
  const [smtpPort, setSmtpPort] = useState(String(s.smtpPort || 587));
  const [smtpSecurity, setSmtpSecurity] = useState(s.smtpSecurity || "STARTTLS");
  const [smtpUsername, setSmtpUsername] = useState(s.smtpUsername || "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [clearSmtpPassword, setClearSmtpPassword] = useState(false);

  const [senderName, setSenderName] = useState(s.emailSenderName || "");
  const [fromAddress, setFromAddress] = useState(s.emailFromAddress || "");
  const [replyTo, setReplyTo] = useState(s.emailReplyTo || "");
  const [adminEmail, setAdminEmail] = useState(s.adminNotificationEmail || "");
  const [brandName, setBrandName] = useState(s.emailBrandName || "");
  const [footer, setFooter] = useState(s.emailFooterText || "");
  const [portalUrl, setPortalUrl] = useState(s.portalUrl || "");
  const [testEmail, setTestEmail] = useState(s.adminNotificationEmail || s.emailFromAddress || "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const rows = useMemo(
    () => AUTOMATION_EVENT_KEYS.map((key) => ({ key, label: EVENT_LABELS[key] || key })),
    [],
  );

  const toggleEvent = (setter, current, key) => {
    const next = new Set(current);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const appendEmailSettings = (form) => {
    if (enabled) form.set("smtpEnabled", "on");
    form.set("emailDeliveryProvider", provider);
    form.set("artistEmailEvents", setCsv(artistEvents));
    form.set("adminEmailEvents", setCsv(adminEvents));
    if (resendApiKey) form.set("resendApiKey", resendApiKey);
    if (clearResendApiKey) form.set("clearResendApiKey", "on");
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

  const clearSecretInputs = () => {
    setSmtpPassword("");
    setClearSmtpPassword(false);
    setResendApiKey("");
    setClearResendApiKey(false);
  };

  const run = async (intent, pending, successFallback, includeTestRecipient = false) => {
    if (busy) return;
    setBusy(true);
    setNotice({ tone: "info", message: pending });
    try {
      const form = new FormData();
      form.set("intent", intent);
      form.set("emailSettingsIncluded", "on");
      appendEmailSettings(form);
      if (includeTestRecipient) form.set("testEmail", testEmail);
      const response = await authenticatedPost(shopify, "/api/automation", form);
      clearSecretInputs();
      setNotice({ tone: "good", message: response.message || successFallback });
      shopify.toast.show(successFallback);
      await revalidateInPlace(revalidator);
    } catch (error) {
      setNotice({ tone: "bad", message: error.message || "Could not update email delivery." });
    } finally {
      setBusy(false);
    }
  };

  const passwordState = clearSmtpPassword
    ? "The stored password will be removed when you save."
    : smtpPassword
      ? "A new password will replace the stored password when you save."
      : smtpPasswordStored
        ? "A password is already stored. Leave this blank to keep it."
        : "No SMTP password is stored.";

  return (
    <s-page heading="Email delivery">
      <s-button slot="secondary-actions" onClick={() => navigate("/app/notifications")}>Delivery history</s-button>

      <s-section>
        <PageIntro title="Control how ReleaseCore emails artists and your team.">
          Choose when messages are sent, who they come from, and which delivery provider ReleaseCore uses.
        </PageIntro>
      </s-section>

      <ActionFeedback feedback={notice} />

      <CollapsibleSection
        icon="email"
        title="Email notifications"
        description="Turn email on or off and choose which release events send a message."
        summary={enabled ? "Enabled" : "Disabled"}
        defaultOpen
      >
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          title="Enable email notifications"
          help="A delivery failure is recorded in Notifications and does not block the release workflow."
        />
        <div className="rc-automation-table" style={{ ...styles.table, marginTop: 18 }}>
          <div className="rc-automation-table__head" style={styles.tableHead}>
            <strong>Release event</strong>
            <strong>Artist</strong>
            <strong>Internal team</strong>
          </div>
          {rows.map((row) => (
            <div className="rc-automation-table__row" style={styles.tableRow} key={row.key}>
              <span>{row.label}</span>
              <input
                type="checkbox"
                className="rc-choice-input"
                checked={artistEvents.has(row.key)}
                onChange={() => toggleEvent(setArtistEvents, artistEvents, row.key)}
              />
              <input
                type="checkbox"
                className="rc-choice-input"
                checked={adminEvents.has(row.key)}
                onChange={() => toggleEvent(setAdminEvents, adminEvents, row.key)}
              />
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="files"
        title="Sender"
        description="Set the identity recipients see in ReleaseCore email."
        summary={fromAddress || "Not configured"}
        defaultOpen
      >
        <div style={styles.grid}>
          <Field label="Sender name">
            <input className="rc-control" value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder="East Rock Entertainment" />
          </Field>
          <Field label="From email">
            <input className="rc-control" type="email" value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="distribution@example.com" />
          </Field>
          <Field label="Reply-to">
            <input className="rc-control" type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="support@example.com" />
          </Field>
          <Field label="Internal notification email">
            <input
              className="rc-control"
              type="email"
              value={adminEmail}
              onChange={(event) => {
                setAdminEmail(event.target.value);
                if (!testEmail) setTestEmail(event.target.value);
              }}
              placeholder="distribution-team@example.com"
            />
          </Field>
          <Field label="Email brand name">
            <input className="rc-control" value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="RLIAB" />
          </Field>
          <Field label="Artist portal URL">
            <input className="rc-control" value={portalUrl} onChange={(event) => setPortalUrl(event.target.value)} placeholder="https://example.com/pages/music" />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Email footer">
            <textarea className="rc-control" style={{ minHeight: 80 }} value={footer} onChange={(event) => setFooter(event.target.value)} placeholder="Support contact or label footer text." />
          </Field>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        icon="settings"
        title="Delivery provider"
        description="Connect Resend or a custom SMTP server."
        summary={provider === "RESEND" ? "Resend" : "Custom SMTP"}
      >
        <div style={styles.stack}>
          <Field label="Provider">
            <select className="rc-control" value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="RESEND">Resend API</option>
              <option value="SMTP">Custom SMTP</option>
            </select>
          </Field>

          {provider === "RESEND" ? (
            <div style={styles.grid}>
              <Field
                label="Resend API key"
                help={resendApiKeyStored ? "A key is already stored. Leave this blank to keep it." : "Enter the API key for your verified Resend account."}
              >
                <input className="rc-control" type="password" autoComplete="new-password" value={resendApiKey} onChange={(event) => setResendApiKey(event.target.value)} placeholder="re_…" />
              </Field>
              <Field label="Stored credential">
                <label style={styles.inlineCheck}>
                  <input type="checkbox" className="rc-choice-input" checked={clearResendApiKey} onChange={(event) => setClearResendApiKey(event.target.checked)} />
                  Remove stored Resend API key on save
                </label>
              </Field>
            </div>
          ) : (
            <>
              <div className="rc-notice rc-notice--info">
                Custom SMTP requires outbound SMTP access from your hosting provider. Resend is the simpler option when SMTP ports are blocked.
              </div>
              <div style={styles.grid}>
                <Field label="SMTP host"><input className="rc-control" value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} placeholder="smtp.example.com" /></Field>
                <Field label="Port"><input className="rc-control" type="number" min="1" max="65535" value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} /></Field>
                <Field label="Security">
                  <select className="rc-control" value={smtpSecurity} onChange={(event) => setSmtpSecurity(event.target.value)}>
                    <option value="STARTTLS">STARTTLS · usually port 587</option>
                    <option value="SSL_TLS">SSL/TLS · usually port 465</option>
                    <option value="NONE">No transport encryption</option>
                  </select>
                </Field>
                <Field label="SMTP username"><input className="rc-control" autoComplete="username" value={smtpUsername} onChange={(event) => setSmtpUsername(event.target.value)} /></Field>
                <Field label="SMTP password / app password" help={passwordState}>
                  <input
                    className="rc-control"
                    type="password"
                    autoComplete="new-password"
                    value={smtpPassword}
                    onChange={(event) => {
                      setSmtpPassword(event.target.value);
                      if (event.target.value) setClearSmtpPassword(false);
                    }}
                    placeholder={smtpPasswordStored ? "Stored — enter only to replace" : "Enter SMTP password"}
                  />
                </Field>
                <Field label="Stored credential">
                  <label style={styles.inlineCheck}>
                    <input
                      type="checkbox"
                      className="rc-choice-input"
                      checked={clearSmtpPassword}
                      onChange={(event) => {
                        setClearSmtpPassword(event.target.checked);
                        if (event.target.checked) setSmtpPassword("");
                      }}
                    />
                    Remove stored SMTP password on save
                  </label>
                </Field>
              </div>
            </>
          )}

          <div className="rc-notice rc-notice--info">
            {encryptionConfigured
              ? "Credential storage is ready. API keys and passwords are encrypted before they are stored."
              : "Credential encryption is not configured. Configure server encryption before saving a provider credential."}
          </div>
        </div>
      </CollapsibleSection>

      <s-section heading="Test delivery">
        <div className="rc-admin-inline-panel" style={styles.testPanel}>
          <div>
            <strong>Send yourself a test</strong>
            <div style={styles.help}>ReleaseCore saves the settings above before running the test.</div>
          </div>
          <input className="rc-control" style={{ maxWidth: 320 }} type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="test@example.com" />
          {provider === "SMTP" ? (
            <button
              className="rc-button"
              disabled={busy}
              onClick={() => run("test-email-provider", "Testing SMTP connection…", "SMTP connection succeeded")}
            >
              Test connection
            </button>
          ) : null}
          <button
            className="rc-button"
            disabled={busy}
            onClick={() => run("send-test-email", "Sending test email…", "Test email sent", true)}
          >
            Send test email
          </button>
        </div>
      </s-section>

      <s-section>
        <div className="rc-form-actions" style={styles.actions}>
          <button
            className="rc-button rc-button--primary"
            disabled={busy}
            onClick={() => run("save-email-settings", "Saving email settings…", "Email settings saved")}
          >
            Save email settings
          </button>
        </div>
      </s-section>
    </s-page>
  );
}

export const headers = (args) => boundary.headers(args);

const styles = {
  stack: { display: "grid", gap: 14 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 13, fontWeight: 650 },
  help: { display: "block", fontSize: 12, color: "#6d7175", lineHeight: 1.45, marginTop: 4 },
  toggle: { display: "flex", gap: 10, alignItems: "flex-start" },
  inlineCheck: { display: "flex", gap: 8, alignItems: "center", minHeight: 42, fontSize: 13 },
  table: { border: "1px solid #dedede", borderRadius: 12, overflow: "hidden" },
  tableHead: { display: "grid", gridTemplateColumns: "minmax(210px,1fr) 110px 110px", gap: 12, padding: 12, background: "#f7f7f7", fontSize: 12 },
  tableRow: { display: "grid", gridTemplateColumns: "minmax(210px,1fr) 110px 110px", gap: 12, alignItems: "center", padding: 12, borderTop: "1px solid #ededed" },
  testPanel: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", justifyContent: "space-between" },
  actions: { display: "flex", justifyContent: "flex-end" },
};
