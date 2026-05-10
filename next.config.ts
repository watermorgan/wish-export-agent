import withPWAInit from '@ducanh2912/next-pwa';
import type { NextConfig } from 'next';

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  cacheOnFrontEndNav: true
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfkit 依赖包内 AFM 度量文件；被打进 .next/server/chunks 后会 ENOENT，表格 PDF materialize 会整段失败。
  // xlsx 库的 fs.readFileSync 在 webpack bundle 中行为异常（Cannot access file），需排除打包。
  serverExternalPackages: ['pdfkit', 'xlsx'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withPWA(nextConfig);
