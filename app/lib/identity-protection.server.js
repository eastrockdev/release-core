import db from "../db.server";

export async function contributorIdentityProtection({ shop, contributorId }) {
  const [settings, submittedCredits] = await Promise.all([
    db.appSettings.findUnique({
      where: { shop },
      select: { lockContributorIdentityAfterSubmission: true },
    }),
    db.trackCredit.count({
      where: {
        contributorId,
        track: {
          release: {
            shop,
            submittedAt: { not: null },
          },
        },
      },
    }),
  ]);

  const protectionEnabled =
    settings?.lockContributorIdentityAfterSubmission ?? true;
  return {
    identityLocked: protectionEnabled && submittedCredits > 0,
    protectionEnabled,
    submittedCredits,
  };
}
