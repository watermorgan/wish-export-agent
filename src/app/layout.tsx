import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Wish Export Agent',
    template: '%s · Wish Export Agent'
  },
  description: '面向外贸团队的上传、翻译、确认与导出工作台',
  applicationName: 'Wish Export Agent',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Wish Export Agent'
  }
};

export const viewport: Viewport = {
  themeColor: '#0f766e',
  width: 'device-width',
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="app-body">
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
