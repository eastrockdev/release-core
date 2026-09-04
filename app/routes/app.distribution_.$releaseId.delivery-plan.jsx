import {
  useEffect,
  useState,
} from "react";
import {
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  CHANNEL_MODES,
  CHANNEL_OVERRIDE_STATES,
  CHANNEL_TERRITORY_MODES,
  DELIVERY_CHANNELS,
  TERRITORIES,
  TERRITORY_MODES,
  channelModeLabel,
  deliveryChannel,
  territorySummary,
} from "../lib/delivery-plan";
import {
  loadReleaseDeliveryPlan,
} from "../lib/delivery-plan.server";
import { authenticatedPost } from "../lib/authenticated-post";
import {
  EmptyState,
  PageIntro,
  StatusBadge,
} from "../components/releasecore-ui";
import {
  formatDate,
  typeLabel,
} from "../lib/releasecore";

export const loader = async ({
  request,
  params,
}) => {
  const { session } =
    await authenticate.admin(request);
  const data =
    await loadReleaseDeliveryPlan({
      shop: session.shop,
      releaseId: params.releaseId,
    });

  if (!data) {
    throw new Response(
      "Release not found",
      { status: 404 },
    );
  }

  return data;
};

function inputDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function readableDate(value) {
  if (!value) return "Date not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date not set"
    : date.toLocaleDateString();
}

function TerritorySelect({
  id,
  name = "territoryCodes",
  defaultValue = [],
  disabled = false,
}) {
  return (
    <select
      id={id}
      className="rc-control rc-delivery-territory-select"
      name={name}
      multiple
      size={10}
      defaultValue={defaultValue}
      disabled={disabled}
    >
      {TERRITORIES.map((item) => (
        <option
          key={item.code}
          value={item.code}
        >
          {item.name} · {item.code}
        </option>
      ))}
    </select>
  );
}

function ChannelMultiSelect({
  defaultValue = [],
  disabled = false,
}) {
  return (
    <select
      className="rc-control rc-delivery-channel-select"
      name="channelKeys"
      multiple
      size={10}
      defaultValue={defaultValue}
      disabled={disabled}
    >
      {DELIVERY_CHANNELS.map(
        (channel) => (
          <option
            key={channel.key}
            value={channel.key}
          >
            {channel.label} ·{" "}
            {channel.kind === "SOCIAL"
              ? "Social"
              : "DSP"}
          </option>
        ),
      )}
    </select>
  );
}

function EffectiveChannel({
  channel,
}) {
  return (
    <article
      className={`rc-delivery-channel-card ${
        channel.enabled
          ? ""
          : "rc-delivery-channel-card--disabled"
      }`}
    >
      <div className="rc-delivery-channel-card__heading">
        <div>
          <strong>
            {channel.label}
          </strong>
          <span>
            {channel.kind === "SOCIAL"
              ? "Social platform"
              : "Music service"}
          </span>
        </div>
        <StatusBadge
          tone={
            channel.enabled
              ? "good"
              : "neutral"
          }
        >
          {channel.enabled
            ? "Included"
            : "Excluded"}
        </StatusBadge>
      </div>

      <div className="rc-delivery-channel-card__meta">
        <span>
          Release:{" "}
          <strong>
            {readableDate(
              channel.releaseDate,
            )}
          </strong>
        </span>
        <span>
          Territories:{" "}
          <strong>
            {territorySummary(
              channel.territoryMode,
              channel.territoryCodes,
            )}
          </strong>
        </span>
      </div>

      {channel.exclusiveHoldback ? (
        <div className="rc-notice rc-notice--info">
          Held until the exclusive window
          ends.
        </div>
      ) : null}

      {channel.override ? (
        <span className="rc-delivery-override-indicator">
          Exception applied
        </span>
      ) : null}
    </article>
  );
}

export default function DeliveryPlan() {
  const {
    release,
    plan,
    effective,
  } = useLoaderData();
  const navigate = useNavigate();
  const revalidator =
    useRevalidator();
  const shopify = useAppBridge();

  const [busy, setBusy] =
    useState(false);
  const [notice, setNotice] =
    useState(null);
  const [channelMode, setChannelMode] =
    useState(plan.channelMode);
  const [
    territoryMode,
    setTerritoryMode,
  ] = useState(plan.territoryMode);
  const [
    exceptionTerritoryMode,
    setExceptionTerritoryMode,
  ] = useState("INHERIT");

  useEffect(() => {
    setChannelMode(plan.channelMode);
    setTerritoryMode(
      plan.territoryMode,
    );
  }, [
    plan.updatedAt,
    plan.channelMode,
    plan.territoryMode,
  ]);

  const post = async (
    formData,
    successFallback,
  ) => {
    if (busy) return null;
    setBusy(true);
    setNotice(null);

    try {
      const result =
        await authenticatedPost(
          shopify,
          `/api/delivery-plan/${release.id}`,
          formData,
        );

      const message =
        result.message ||
        successFallback ||
        "Saved.";
      setNotice({
        tone: "good",
        message,
      });
      shopify.toast.show(message);
      await revalidator.revalidate();
      return result;
    } catch (error) {
      setNotice({
        tone: "bad",
        message:
          error instanceof Error
            ? error.message
            : "ReleaseCore could not update this delivery plan.",
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const savePlan = async (event) => {
    event.preventDefault();
    const formData =
      new FormData(event.currentTarget);
    formData.set(
      "intent",
      "save-plan",
    );
    await post(
      formData,
      "Delivery plan saved.",
    );
  };

  const saveException = async (
    event,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData =
      new FormData(form);
    formData.set(
      "intent",
      "save-channel",
    );

    const result = await post(
      formData,
      "Platform exception saved.",
    );
    if (result) {
      form.reset();
      setExceptionTerritoryMode(
        "INHERIT",
      );
    }
  };

  const removeException = async (
    channelKey,
  ) => {
    const channel =
      deliveryChannel(channelKey);
    if (
      !window.confirm(
        `Remove the delivery exception for ${
          channel?.label || channelKey
        }?`,
      )
    ) {
      return;
    }

    const formData =
      new FormData();
    formData.set(
      "intent",
      "remove-channel",
    );
    formData.set(
      "channelKey",
      channelKey,
    );
    await post(
      formData,
      "Platform exception removed.",
    );
  };

  return (
    <s-page heading="Delivery Plan">
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(
            `/app/distribution/${release.id}`,
          )
        }
      >
        Distribution workspace
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={() =>
          navigate(
            `/app/release/${release.id}`,
          )
        }
      >
        Release
      </s-button>

      <s-section>
        <PageIntro
          eyebrow="M17.3 · Advanced store & territory availability"
          title="Make the distribution workspace the authoritative delivery plan."
        >
          Control platform inclusion, territory
          availability, social-only delivery,
          exclusivity windows, store-specific
          dates, and exceptions without changing
          Shopify publication state.
        </PageIntro>
      </s-section>

      {notice ? (
        <s-section>
          <div
            className={`rc-notice rc-notice--${notice.tone}`}
          >
            {notice.message}
          </div>
        </s-section>
      ) : null}

      <s-section heading="Release baseline">
        <div className="rc-delivery-baseline">
          <div>
            <span>Release</span>
            <strong>
              {release.title}
            </strong>
          </div>
          <div>
            <span>Format</span>
            <strong>
              {typeLabel(
                release.type,
              )}
            </strong>
          </div>
          <div>
            <span>Catalog release date</span>
            <strong>
              {release.releaseDate
                ? formatDate(
                    release.releaseDate,
                  )
                : "Not set"}
            </strong>
          </div>
          <div>
            <span>Current plan</span>
            <strong>
              {channelModeLabel(
                plan.channelMode,
              )}
            </strong>
          </div>
        </div>
        {!release.releaseDate ? (
          <div className="rc-notice rc-notice--warning">
            The release has no catalog release
            date yet. Store-specific dates can
            still be configured, but the normal
            baseline date should be set from the
            Release workspace.
          </div>
        ) : null}
      </s-section>

      <s-section heading="1. Release-wide delivery rules">
        <form
          className="rc-delivery-plan-form"
          onSubmit={savePlan}
        >
          <label className="rc-field">
            <span className="rc-field__label">
              Platform availability
            </span>
            <select
              className="rc-control"
              name="channelMode"
              value={channelMode}
              onChange={(event) =>
                setChannelMode(
                  event.target.value,
                )
              }
              disabled={busy}
            >
              {CHANNEL_MODES.map(
                (mode) => (
                  <option
                    key={mode.value}
                    value={mode.value}
                  >
                    {mode.label}
                  </option>
                ),
              )}
            </select>
          </label>

          {[
            "INCLUDE_ONLY",
            "EXCLUDE",
          ].includes(channelMode) ? (
            <label className="rc-field rc-delivery-span-2">
              <span className="rc-field__label">
                {channelMode ===
                "INCLUDE_ONLY"
                  ? "Included platforms"
                  : "Excluded platforms"}
              </span>
              <ChannelMultiSelect
                defaultValue={
                  plan.channelKeys
                }
                disabled={busy}
              />
              <span className="rc-field__help">
                Use Command-click on macOS or
                Control-click on Windows to select
                multiple services.
              </span>
            </label>
          ) : null}

          <label className="rc-field">
            <span className="rc-field__label">
              Territory availability
            </span>
            <select
              className="rc-control"
              name="territoryMode"
              value={territoryMode}
              onChange={(event) =>
                setTerritoryMode(
                  event.target.value,
                )
              }
              disabled={busy}
            >
              {TERRITORY_MODES.map(
                (mode) => (
                  <option
                    key={mode.value}
                    value={mode.value}
                  >
                    {mode.label}
                  </option>
                ),
              )}
            </select>
          </label>

          {[
            "INCLUDE",
            "EXCLUDE",
          ].includes(territoryMode) ? (
            <label className="rc-field rc-delivery-span-2">
              <span className="rc-field__label">
                {territoryMode ===
                "INCLUDE"
                  ? "Included territories"
                  : "Excluded territories"}
              </span>
              <TerritorySelect
                defaultValue={
                  plan.territoryCodes
                }
                disabled={busy}
              />
              <span className="rc-field__help">
                ISO territory codes are stored
                locally in ReleaseCore&apos;s delivery
                plan.
              </span>
            </label>
          ) : null}

          <div className="rc-delivery-span-2 rc-delivery-exclusive-panel">
            <div>
              <span className="rc-eyebrow">
                Exclusive window
              </span>
              <strong>
                Optional early-access platform
              </strong>
              <span>
                Other included platforms are
                automatically shown as held until
                the exclusive window ends.
              </span>
            </div>

            <label className="rc-field">
              <span className="rc-field__label">
                Exclusive platform
              </span>
              <select
                className="rc-control"
                name="exclusiveChannelKey"
                defaultValue={
                  plan.exclusiveChannelKey ||
                  ""
                }
                disabled={busy}
              >
                <option value="">
                  No exclusive window
                </option>
                {DELIVERY_CHANNELS.map(
                  (channel) => (
                    <option
                      key={channel.key}
                      value={channel.key}
                    >
                      {channel.label}
                    </option>
                  ),
                )}
              </select>
            </label>

            <div className="rc-delivery-date-pair">
              <label className="rc-field">
                <span className="rc-field__label">
                  Start date
                </span>
                <input
                  className="rc-control"
                  name="exclusiveStartDate"
                  type="date"
                  defaultValue={inputDate(
                    plan.exclusiveStartDate ||
                      release.releaseDate,
                  )}
                  disabled={busy}
                />
              </label>
              <label className="rc-field">
                <span className="rc-field__label">
                  End date
                </span>
                <input
                  className="rc-control"
                  name="exclusiveEndDate"
                  type="date"
                  defaultValue={inputDate(
                    plan.exclusiveEndDate,
                  )}
                  disabled={busy}
                />
              </label>
            </div>
          </div>

          <label className="rc-field rc-delivery-span-2">
            <span className="rc-field__label">
              Delivery notes
            </span>
            <textarea
              className="rc-control"
              name="notes"
              maxLength={1000}
              defaultValue={
                plan.notes || ""
              }
              placeholder="Optional operational notes for this delivery plan."
              disabled={busy}
            />
          </label>

          <div className="rc-form-actions rc-delivery-span-2">
            <button
              className="rc-button rc-button--primary"
              disabled={busy}
            >
              {busy
                ? "Saving…"
                : "Save delivery plan"}
            </button>
          </div>
        </form>
      </s-section>

      <s-section
        heading={`2. Effective platform plan (${effective.enabledChannels.length} included)`}
      >
        <div className="rc-delivery-channel-grid">
          {effective.channels.map(
            (channel) => (
              <EffectiveChannel
                key={channel.key}
                channel={channel}
              />
            ),
          )}
        </div>
      </s-section>

      <s-section heading="3. Add platform exception">
        <form
          className="rc-delivery-exception-form"
          onSubmit={saveException}
        >
          <label className="rc-field">
            <span className="rc-field__label">
              Platform
            </span>
            <select
              className="rc-control"
              name="channelKey"
              required
              defaultValue=""
              disabled={busy}
            >
              <option value="">
                Choose platform…
              </option>
              {DELIVERY_CHANNELS.map(
                (channel) => (
                  <option
                    key={channel.key}
                    value={channel.key}
                  >
                    {channel.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Availability override
            </span>
            <select
              className="rc-control"
              name="enabledState"
              defaultValue="INHERIT"
              disabled={busy}
            >
              {CHANNEL_OVERRIDE_STATES.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Store-specific release date
            </span>
            <input
              className="rc-control"
              name="releaseDate"
              type="date"
              disabled={busy}
            />
          </label>

          <label className="rc-field">
            <span className="rc-field__label">
              Territory override
            </span>
            <select
              className="rc-control"
              name="territoryMode"
              value={
                exceptionTerritoryMode
              }
              onChange={(event) =>
                setExceptionTerritoryMode(
                  event.target.value,
                )
              }
              disabled={busy}
            >
              {CHANNEL_TERRITORY_MODES.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
          </label>

          {[
            "INCLUDE",
            "EXCLUDE",
          ].includes(
            exceptionTerritoryMode,
          ) ? (
            <label
              className="rc-field rc-delivery-span-2"
              htmlFor="delivery-exception-territories"
            >
              <span className="rc-field__label">
                Exception territories
              </span>
              <TerritorySelect
                id="delivery-exception-territories"
                disabled={busy}
              />
            </label>
          ) : null}

          <label className="rc-field rc-delivery-span-2">
            <span className="rc-field__label">
              Exception note
            </span>
            <input
              className="rc-control"
              name="notes"
              maxLength={800}
              placeholder="Optional explanation for this platform exception."
              disabled={busy}
            />
          </label>

          <div className="rc-form-actions rc-delivery-span-2">
            <button
              className="rc-button"
              disabled={busy}
            >
              Add / update exception
            </button>
          </div>
        </form>
      </s-section>

      <s-section
        heading={`Platform exceptions (${plan.overrides.length})`}
      >
        {plan.overrides.length ? (
          <div className="rc-delivery-exception-list">
            {plan.overrides.map(
              (override) => {
                const channel =
                  deliveryChannel(
                    override.channelKey,
                  );
                return (
                  <article
                    className="rc-delivery-exception-row"
                    key={override.id}
                  >
                    <div>
                      <strong>
                        {channel?.label ||
                          override.channelKey}
                      </strong>
                      <span>
                        {override.enabledState} ·{" "}
                        {override.releaseDate
                          ? readableDate(
                              override.releaseDate,
                            )
                          : "Inherited date"}{" "}
                        ·{" "}
                        {territorySummary(
                          override.territoryMode,
                          override.territoryCodes,
                        )}
                      </span>
                      {override.notes ? (
                        <span>
                          {override.notes}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="rc-button rc-button--danger rc-button--compact"
                      disabled={busy}
                      onClick={() =>
                        removeException(
                          override.channelKey,
                        )
                      }
                    >
                      Clear exception
                    </button>
                  </article>
                );
              },
            )}
          </div>
        ) : (
          <EmptyState title="No platform exceptions">
            The release-wide rules apply to
            every platform. Add an exception only
            when one service needs a different
            availability state, date, or
            territory set.
          </EmptyState>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (
  headersArgs,
) =>
  boundary.headers(headersArgs);
