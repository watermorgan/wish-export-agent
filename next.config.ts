import withPWAInit from '@ducanh2912/next-pwa';
import type { NextConfig } from 'next';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true
});

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default withPWA(nextConfig);
