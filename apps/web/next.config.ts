import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@prolora/shared'],
  // Native Node-Addons (.node) kann webpack nicht bündeln. sharp war schon so
  // eingetragen; @resvg/resvg-js (SVG->PNG für die Bild-Templates, Plan 2 /
  // 2A.6) ist derselbe Fall und muss zur Laufzeit aufgelöst werden.
  serverExternalPackages: ['sharp', '@resvg/resvg-js'],
};

export default nextConfig;
