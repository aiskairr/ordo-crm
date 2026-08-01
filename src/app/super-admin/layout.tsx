import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Super Admin — ORDO Control",
    template: "%s — ORDO Control",
  },
  description: "Изолированная панель владельца ORDO CRM",
  robots: { index: false, follow: false },
};

export default function SuperAdminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
