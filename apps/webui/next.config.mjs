/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@scorel/protocol", "@scorel/client"],
};

export default nextConfig;
