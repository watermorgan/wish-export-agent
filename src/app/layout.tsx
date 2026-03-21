import type { Metadata } from 'next';
import { Manrope, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta-sans',
});

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
    <html lang="zh-CN" className={`${manrope.variable} ${plusJakartaSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
