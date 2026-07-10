import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@prolora/shared'],
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
