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
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ivory font-body text-on-surface selection:bg-primary/20">{children}</body>
    </html>
  );
}
