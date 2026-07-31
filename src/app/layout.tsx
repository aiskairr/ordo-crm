import type { Metadata, Viewport } from "next";
import { TelegramMiniApp } from "@/src/fsd/shared/ui/telegram-mini-app";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ordo CRM",
  description: "CRM для продаж, сотрудников и операционных процессов",
  icons: {
    icon: "/ordo-logo.svg",
    shortcut: "/ordo-logo.svg",
    apple: "/ordo-logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#15182b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <TelegramMiniApp />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
