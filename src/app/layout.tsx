import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wish Export Agent',
  description: '面向外贸团队的上传问答与日常办公智能体骨架',
  applicationName: 'Wish Export Agent',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Wish Export Agent'
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
