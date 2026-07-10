import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@echohub/shared'],
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
