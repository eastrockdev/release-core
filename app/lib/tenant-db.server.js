import db from "../db.server";

export function findShopRelease(shop, id, args = {}) {
  return db.release.findFirst({
    ...args,
    where: { ...(args.where || {}), id, shop },
  });
}

export function findShopArtist(shop, id, args = {}) {
  return db.artist.findFirst({
    ...args,
    where: { ...(args.where || {}), id, shop },
  });
}

export function findShopContributor(shop, id, args = {}) {
  return db.contributor.findFirst({
    ...args,
    where: { ...(args.where || {}), id, shop },
  });
}

export function findShopReleaseFile(shop, id, args = {}) {
  return db.releaseFile.findFirst({
    ...args,
    where: {
      ...(args.where || {}),
      id,
      release: { ...(args.where?.release || {}), shop },
    },
  });
}

export function findShopSubmissionEvent(shop, id, args = {}) {
  return db.submissionEvent.findFirst({
    ...args,
    where: {
      ...(args.where || {}),
      id,
      release: { ...(args.where?.release || {}), shop },
    },
  });
}
