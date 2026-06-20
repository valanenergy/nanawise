/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We lint at the workspace root (eslint.config.mjs); skip Next's own lint step.
  eslint: { ignoreDuringBuilds: true },
  // Transpile the workspace packages (they ship raw TS, no prebuilt dist).
  transpilePackages: ['@nanawise/shared', '@nanawise/predict-sdk'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
