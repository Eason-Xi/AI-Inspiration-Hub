import type { Metadata } from "next";
import "./globals.css";
import Hub from "@/components/Hub";
export const metadata: Metadata = {
  title: "灵感扩散库 · Inspiration Hub",
  description: "记录每一个念头，让灵感持续生长。个人 AI 灵感与问题探索工作台。",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <Hub />
        {children}
      </body>
    </html>
  );
}
