/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Auth + libSQL pull in a native module (libsql) that webpack can't bundle.
  // Keep them external so route handlers require() them at runtime instead.
  serverExternalPackages: ["better-auth", "@libsql/kysely-libsql", "@libsql/client", "libsql"],
};

export default nextConfig;
