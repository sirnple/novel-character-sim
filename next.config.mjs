/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Keep native sqlite binding outside the Next bundle
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
