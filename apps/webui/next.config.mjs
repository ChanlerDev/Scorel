/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@scorel/protocol", "@scorel/client"],
  webpack(config) {
    // Allow `.js` import specifiers (TS NodeNext convention) to resolve to
    // sibling `.ts`/`.tsx` files in the workspace packages we transpile.
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
