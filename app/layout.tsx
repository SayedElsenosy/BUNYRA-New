import type { Metadata } from "next";
import "./globals.css";
import "./bunyra-theme.css";
import "./lead-workspace.css";

export const metadata: Metadata = {
  title: "BUNYRA | إدارة المنصة",
  description: "BUNYRA ERP & CRM — إدارة شركات التطوير العقاري",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
