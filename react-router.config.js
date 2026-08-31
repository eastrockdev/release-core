/** @type {import("@react-router/dev/config").Config} */
export default {
  // Shopify's embedded app requires server rendering. Opt into the React Router v8
  // request/runtime behavior while ReleaseCore is still on React Router v7.
  ssr: true,
  future: {
    v8_middleware: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
  },
};
