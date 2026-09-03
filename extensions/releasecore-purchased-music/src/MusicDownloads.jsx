import '@shopify/ui-extensions/preact';

import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const DEFAULT_API_BASE = 'https://releasecore-web-production.up.railway.app';

export default async () => {
  render(<MusicDownloads />, document.body);
};

function stateLabel(state) {
  if (state === 'READY') return 'Ready';
  if (state === 'STALE') return 'Refreshes on download';
  if (state === 'NO_MASTER') return 'Unavailable';
  return 'Prepares on download';
}

function MusicDownloads() {
  const [library, setLibrary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const token = await shopify.sessionToken.get();
      const configured =
        String(shopify.settings.value?.api_base_url || '').trim();
      const apiBase = (configured || DEFAULT_API_BASE)
        .replace(/\/+$/, '');

      const response = await fetch(
        `${apiBase}/customer-account/downloads`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        },
      );

      const data = await response.json();
      if (!data.ok) {
        throw new Error(
          data.error || 'Purchased music could not be loaded.',
        );
      }

      const releases = (data.library?.releases || []).map(
        (release) => ({
          ...release,
          tracks: (release.tracks || []).map((track) => ({
            ...track,
            formats: (track.formats || []).map((format) => ({
              ...format,
              downloadUrl: format.downloadPath
                ? new URL(
                    format.downloadPath,
                    `${apiBase}/`,
                  ).toString()
                : null,
            })),
          })),
        }),
      );

      setLibrary({
        ...data.library,
        releases,
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Purchased music could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <s-page heading="Music downloads" inlineSize="large">
      <s-button slot="primary-action" onClick={load} loading={loading}>
        Refresh
      </s-button>

      {loading && !library ? (
        <s-section>
          <s-text>Loading your purchased music…</s-text>
        </s-section>
      ) : null}

      {error ? (
        <s-section>
          <s-stack direction="block" gap="small-400">
            <s-heading>Music downloads unavailable</s-heading>
            <s-text>{error}</s-text>
          </s-stack>
        </s-section>
      ) : null}

      {!loading && !error && library?.releases?.length === 0 ? (
        <s-section>
          <s-stack direction="block" gap="small-400">
            <s-heading>No purchased music yet</s-heading>
            <s-text>
              Digital music purchased from this store will appear here.
            </s-text>
          </s-stack>
        </s-section>
      ) : null}

      {!error &&
        library?.releases?.map((release) => (
          <s-section
            key={release.releaseId}
            heading={release.releaseTitle}
          >
            <s-stack direction="block" gap="base">
              {release.coverUrl ? (
                <s-image
                  src={release.coverUrl}
                  accessibilityDescription={`${release.releaseTitle} cover artwork`}
                />
              ) : null}

              <s-text color="subdued">
                {[release.releaseType, release.orderName]
                  .filter(Boolean)
                  .join(' · ')}
              </s-text>

              {release.tracks.map((track) => (
                <s-section key={track.entitlementId}>
                  <s-stack direction="block" gap="small-400">
                    <s-heading>
                      {track.position
                        ? `${track.position}. `
                        : ''}
                      {track.title}
                      {track.version
                        ? ` (${track.version})`
                        : ''}
                    </s-heading>

                    <s-stack direction="inline" gap="small-400">
                      {track.formats.map((format) =>
                        format.downloadUrl ? (
                          <s-button
                            key={format.format}
                            href={format.downloadUrl}
                            target="_blank"
                          >
                            {format.label}
                          </s-button>
                        ) : (
                          <s-button
                            key={format.format}
                            disabled
                          >
                            {format.label}
                          </s-button>
                        ),
                      )}
                    </s-stack>

                    <s-text color="subdued">
                      {track.formats
                        .map(
                          (format) =>
                            `${format.label}: ${stateLabel(
                              format.state,
                            )}`,
                        )
                        .join(' · ')}
                    </s-text>

                    {track.downloadCount ? (
                      <s-text color="subdued">
                        {track.downloadCount} previous download
                        {track.downloadCount === 1 ? '' : 's'}
                      </s-text>
                    ) : null}
                  </s-stack>
                </s-section>
              ))}
            </s-stack>
          </s-section>
        ))}
    </s-page>
  );
}
