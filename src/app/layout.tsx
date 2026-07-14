import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
