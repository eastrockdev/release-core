import db from "../db.server";

const COVER_ART = "COVER_ART";

function releaseCoverFile(release) {
  return (release?.files || []).find(
    (file) =>
      file?.kind === COVER_ART &&
      (file?.trackId === null ||
        file?.trackId === undefined),
  );
}

export async function hydrateReleaseCoverUrl(
  admin,
  release,
) {
  if (!admin || !release) {
    return release;
  }

  const cover = releaseCoverFile(release);

  if (
    !cover ||
    cover.url ||
    !String(cover.storageKey || "").startsWith(
      "gid://shopify/",
    )
  ) {
    return release;
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query ReleaseCoreAdminReleaseArtwork(
          $id: ID!
        ) {
          node(id: $id) {
            id
            ... on MediaImage {
              fileStatus
              image {
                url
              }
            }
            ... on GenericFile {
              fileStatus
              url
            }
          }
        }
      `,
      {
        variables: {
          id: cover.storageKey,
        },
      },
    );

    const json = await response.json();

    const errors = (json?.errors || [])
      .map((error) =>
        String(error?.message || "").trim(),
      )
      .filter(Boolean);

    if (errors.length) {
      throw new Error(
        errors.join(" "),
      );
    }

    const node = json?.data?.node;
    if (!node) {
      return release;
    }

    const url =
      node?.image?.url ||
      node?.url ||
      null;

    const status =
      node?.fileStatus ||
      cover.status ||
      null;

    if (status) {
      cover.status = status;
    }

    if (!url) {
      return release;
    }

    cover.url = url;

    if (cover.id) {
      await db.releaseFile
        .update({
          where: {
            id: cover.id,
          },
          data: {
            url,
            ...(status
              ? { status }
              : {}),
          },
        })
        .catch((error) => {
          console.warn(
            "ReleaseCore release artwork URL persistence skipped",
            {
              fileId: cover.id,
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown database error",
            },
          );
        });
    }
  } catch (error) {
    console.warn(
      "ReleaseCore release artwork refresh skipped",
      error,
    );
  }

  return release;
}
