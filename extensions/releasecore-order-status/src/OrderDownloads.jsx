import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

const DEFAULT_API_BASE = 'https://releasecore-web-production.up.railway.app';

export default async () => { render(<OrderDownloads />, document.body); };

function uniqueProductIds(lines) {
  const ids = [];
  for (const line of lines || []) {
    const parentId = line?.merchandise?.product?.id;
    if (parentId) ids.push(parentId);
    for (const component of line?.lineComponents || []) {
      const componentId = component?.merchandise?.product?.id;
      if (componentId) ids.push(componentId);
    }
  }
  return [...new Set(ids)];
}

function apiBase() {
  const configured = String(shopify.settings.value?.api_base_url || '').trim();
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, '');
}

function attachDownloadUrls(library, base) {
  return {
    ...library,
    releases: (library?.releases || []).map((release) => ({
      ...release,
      tracks: (release.tracks || []).map((track) => ({
        ...track,
        formats: (track.formats || []).map((format) => ({
          ...format,
          downloadUrl: format.downloadPath ? new URL(format.downloadPath, `${base}/`).toString() : null,
        })),
      })),
    })),
  };
}

function OrderDownloads() {
  const order = shopify.order.value;
  const lines = shopify.lines.value;
  const authenticationState =
    shopify.authenticationState.value;
  const productIds = useMemo(
    () => uniqueProductIds(lines || []),
    [lines],
  );
  const [hasMusic, setHasMusic] = useState(null);
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function probe() {
      if (!productIds.length) { setHasMusic(false); return; }
      try {
        const token = await shopify.sessionToken.get();
        const response = await fetch(`${apiBase()}/customer-account/order-downloads`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'probe', productIds }),
        });
        const data = await response.json();
        if (active) setHasMusic(Boolean(data?.ok && data?.hasMusic));
      } catch { if (active) setHasMusic(false); }
    }
    probe();
    return () => { active = false; };
  }, [productIds]);

  useEffect(() => {
    let active = true;
    async function loadLibrary() {
      if (!hasMusic || authenticationState !== 'fully_authenticated' || !order?.id) return;
      setLoading(true); setError('');
      try {
        const base = apiBase();
        const token = await shopify.sessionToken.get();
        const response = await fetch(`${base}/customer-account/order-downloads`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'library', orderId: order.id }),
        });
        const data = await response.json();
        if (!response.ok || !data?.ok) throw new Error(data?.error || 'Purchased music could not be loaded.');
        if (active) setLibrary(attachDownloadUrls(data.library, base));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Purchased music could not be loaded.');
      } finally { if (active) setLoading(false); }
    }
    loadLibrary();
    return () => { active = false; };
  }, [hasMusic, authenticationState, order?.id]);

  if (hasMusic === null || hasMusic === false) return null;

  if (authenticationState === 'pre_authenticated') {
    return (
      <s-section heading="Digital music">
        <s-stack direction="block" gap="small-400">
          <s-text>Music from this order is available as a secure digital download.</s-text>
          <s-button onClick={() => shopify.requireLogin()}>Sign in to download</s-button>
        </s-stack>
      </s-section>
    );
  }

  if (loading && !library) return <s-section heading="Digital music"><s-text>Loading your music…</s-text></s-section>;
  if (error) return <s-section heading="Digital music"><s-text>{error}</s-text></s-section>;
  if (!library?.releases?.length) return null;

  return (
    <s-section heading="Digital music">
      <s-stack direction="block" gap="base">
        <s-text color="subdued">Download the music included with {library.orderName || 'this order'}.</s-text>
        {library.releases.map((release) => (
          <s-section key={release.releaseId} heading={release.releaseTitle}>
            <s-stack direction="block" gap="small-400">
              {release.tracks.map((track) => (
                <s-stack key={track.entitlementId} direction="block" gap="small-200">
                  <s-text type="strong">{track.position ? `${track.position}. ` : ''}{track.title}{track.version ? ` (${track.version})` : ''}</s-text>
                  <s-stack direction="inline" gap="small-300">
                    {track.formats.map((format) => format.downloadUrl ? (
                      <s-button key={format.format} href={format.downloadUrl} target="_blank">{format.label}</s-button>
                    ) : (
                      <s-button key={format.format} disabled>{format.label}</s-button>
                    ))}
                  </s-stack>
                </s-stack>
              ))}
            </s-stack>
          </s-section>
        ))}
      </s-stack>
    </s-section>
  );
}
