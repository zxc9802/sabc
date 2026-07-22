import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SABC 项目优先级评估",
  description: "面向小团队的可追溯项目投入建议",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
