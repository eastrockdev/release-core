export const action = async (args) => {
  const { action } = await import("../lib/api-releases-release-action.server");
  return action(args);
};
