import "../styles/releasecore-public.css";

export function PublicPage({ eyebrow = "ReleaseCore", title, intro, children }) {
  return (
    <main className="rc-public">
      <div className="rc-public__shell">
        <header className="rc-public__header">
          <a className="rc-public__brand" href="/" aria-label="ReleaseCore home">ReleaseCore</a>
          <nav className="rc-public__nav" aria-label="ReleaseCore public navigation">
            <a href="/privacy-policy">Privacy</a>
            <a href="/support">Support</a>
          </nav>
        </header>
        <section className="rc-public__hero">
          <div className="rc-public__eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {intro ? <p className="rc-public__intro">{intro}</p> : null}
        </section>
        <div className="rc-public__content">{children}</div>
        <footer className="rc-public__footer">
          <span>ReleaseCore</span>
          <span>Music distribution operations for Shopify merchants.</span>
        </footer>
      </div>
    </main>
  );
}

export function PublicCard({ title, children }) {
  return (
    <section className="rc-public__card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
