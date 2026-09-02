import { Link } from "react-router";

const TONE_CLASS = {
  good: "rc-badge--success",
  success: "rc-badge--success",
  bad: "rc-badge--critical",
  critical: "rc-badge--critical",
  warn: "rc-badge--warning",
  warning: "rc-badge--warning",
  info: "rc-badge--info",
  neutral: "rc-badge--neutral",
};

export function releaseCoverUrl(release) {
  return (release?.files || []).find((file) => file.kind === "COVER_ART" && file.url)?.url || null;
}

export function ReleaseArtwork({ release, src, title, size = "medium" }) {
  const artwork = src || releaseCoverUrl(release);
  const label = title || release?.title || "Release";
  const initial = label.trim().slice(0, 1).toUpperCase() || "R";

  return artwork ? (
    <img
      className={`rc-artwork rc-artwork--${size}`}
      src={artwork}
      alt={`${label} cover artwork`}
      loading="lazy"
    />
  ) : (
    <div
      className={`rc-artwork rc-artwork--${size} rc-artwork--placeholder`}
      role="img"
      aria-label={`${label} has no cover artwork`}
    >
      <span>{initial}</span>
    </div>
  );
}

export function ArtistAvatar({ artist, size = "medium" }) {
  const label = artist?.name || "Artist";
  const initial = label.trim().slice(0, 1).toUpperCase() || "A";
  return artist?.imageUrl ? (
    <img className={`rc-avatar rc-avatar--${size}`} src={artist.imageUrl} alt={`${label} profile`} loading="lazy" />
  ) : (
    <span className={`rc-avatar rc-avatar--${size} rc-avatar--placeholder`} aria-label={`${label} has no profile image`}>{initial}</span>
  );
}

const ICON_PATHS = {
  add: "M12 5v14M5 12h14",
  artist: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  audio: "M9 18V5l10-2v13M9 9l10-2M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  barcode: "M4 5v14M7 5v14M11 5v14M14 5v14M20 5v14M17 5v14",
  catalog: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Zm0 0A2.5 2.5 0 0 0 6.5 8H20",
  checklist: "m4 7 2 2 4-4M4 15l2 2 4-4M13 7h7M13 15h7",
  contributor: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5M3 20a5 5 0 0 1 10 0m1-6a5 5 0 0 1 7 4.6",
  defaults: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M13 4v4M7 10v4M15 16v4",
  files: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 13h6M9 17h6",
  history: "M4 12a8 8 0 1 0 2.3-5.7L4 8M4 4v4h4m4-1v5l3 2",
  identifier: "M7 4 5 20M15 4l-2 16M4 9h16M3 15h16",
  product: "m4 8 8-5 8 5-8 5-8-5Zm0 0v9l8 5 8-5V8M12 13v9",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4 2-1-2-4-2 .5-2-2 .5-2-4-2-1 2H9L8 3 4 5l.5 2-2 2L1 8v4l2 1 .5 2-1 2L5 21l2-1 2 1 1 2h4l1-2 2-1 2 1 3-4-1-2 .5-2Z",
  shopify: "M7 7h10l1 13H6L7 7Zm2 0c0-2 1-4 3-4s3 2 3 4",
  tracks: "M5 7h14M5 12h14M5 17h14M2 7h.01M2 12h.01M2 17h.01",
};

export function SectionIcon({ name = "settings" }) {
  return (
    <span className="rc-section-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICON_PATHS[name] || ICON_PATHS.settings} />
      </svg>
    </span>
  );
}


export function ActionFeedback({ feedback, compact = false }) {
  if (!feedback?.message) return null;
  const tone = ["good", "bad", "info"].includes(feedback.tone) ? feedback.tone : "info";
  return (
    <div
      className={`rc-action-feedback rc-action-feedback--${tone}${compact ? " rc-action-feedback--compact" : ""}`}
      role={tone === "bad" ? "alert" : "status"}
      aria-live={tone === "bad" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="rc-action-feedback__indicator" aria-hidden="true">
        {tone === "good" ? "✓" : tone === "bad" ? "!" : ""}
      </span>
      <span className="rc-action-feedback__message">{feedback.message}</span>
    </div>
  );
}

export function StatusBadge({ children, tone = "neutral" }) {
  return <span className={`rc-badge ${TONE_CLASS[tone] || TONE_CLASS.neutral}`}>{children}</span>;
}

export function PageIntro({ eyebrow, title, children, actions }) {
  return (
    <div className="rc-page-intro">
      <div className="rc-page-intro__content">
        {eyebrow ? <div className="rc-eyebrow">{eyebrow}</div> : null}
        <h2 className="rc-page-intro__title">{title}</h2>
        {children ? <div className="rc-page-intro__copy">{children}</div> : null}
      </div>
      {actions ? <div className="rc-page-intro__actions">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({ label, value, detail, href }) {
  const content = (
    <>
      <span className="rc-metric__label">{label}</span>
      <strong className="rc-metric__value">{value}</strong>
      {detail ? <span className="rc-metric__detail">{detail}</span> : null}
    </>
  );

  return href ? <Link to={href} className="rc-metric rc-metric--link">{content}</Link> : <div className="rc-metric">{content}</div>;
}

export function MetricGrid({ children }) {
  return <div className="rc-metric-grid">{children}</div>;
}

export function FilterBar({ items, active, hrefFor }) {
  return (
    <nav className="rc-filter-bar" aria-label="Filter results">
      {items.map((item) => (
        <Link
          key={item.value}
          to={hrefFor(item.value)}
          className={`rc-filter${active === item.value ? " rc-filter--active" : ""}`}
          aria-current={active === item.value ? "page" : undefined}
        >
          <span>{item.label}</span>
          {item.count !== undefined ? <span className="rc-filter__count">{item.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function ReleaseListItem({ release, href, badges = [], meta, aside, actionLabel = "Open release" }) {
  return (
    <Link to={href} className="rc-release-row">
      <ReleaseArtwork release={release} size="medium" />
      <div className="rc-release-row__content">
        <div className="rc-release-row__title-line">
          <strong className="rc-release-row__title">{release.title}</strong>
          {badges.map((badge, index) => (
            <StatusBadge key={`${badge.label}-${index}`} tone={badge.tone}>{badge.label}</StatusBadge>
          ))}
        </div>
        {meta ? <div className="rc-release-row__meta">{meta}</div> : null}
      </div>
      <div className="rc-release-row__aside">
        {aside ? <div className="rc-release-row__aside-copy">{aside}</div> : null}
        <span className="rc-release-row__action">{actionLabel}<span aria-hidden="true"> →</span></span>
      </div>
    </Link>
  );
}

export function ReleaseHero({ release, badges = [], meta, eyebrow = "Release workspace", trailing }) {
  return (
    <div className="rc-release-hero">
      <ReleaseArtwork release={release} size="large" />
      <div className="rc-release-hero__content">
        <div className="rc-eyebrow">{eyebrow}</div>
        <div className="rc-release-hero__title-line">
          <h2 className="rc-release-hero__title">{release.title}</h2>
          {badges.map((badge, index) => (
            <StatusBadge key={`${badge.label}-${index}`} tone={badge.tone}>{badge.label}</StatusBadge>
          ))}
        </div>
        {meta ? <div className="rc-release-hero__meta">{meta}</div> : null}
      </div>
      {trailing ? <div className="rc-release-hero__trailing">{trailing}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="rc-empty-state">
      <div className="rc-empty-state__mark" aria-hidden="true">♪</div>
      <strong className="rc-empty-state__title">{title}</strong>
      {children ? <div className="rc-empty-state__copy">{children}</div> : null}
      {action ? <div className="rc-empty-state__action">{action}</div> : null}
    </div>
  );
}

export function CollapsibleSection({ title, description, summary, children, defaultOpen = false, icon = "settings" }) {
  return (
    <s-section padding="none">
      <details className="rc-disclosure" open={defaultOpen}>
        <summary className="rc-disclosure__summary">
          <span className="rc-disclosure__main">
            <SectionIcon name={icon} />
            <span className="rc-disclosure__heading">
              <strong className="rc-disclosure__title">{title}</strong>
              {description ? <span className="rc-disclosure__description">{description}</span> : null}
            </span>
          </span>
          <span className="rc-disclosure__end">
            {summary ? <span className="rc-disclosure__status">{summary}</span> : null}
            <span className="rc-disclosure__chevron" aria-hidden="true">⌄</span>
          </span>
        </summary>
        <div className="rc-disclosure__body">{children}</div>
      </details>
    </s-section>
  );
}
