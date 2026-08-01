import type { Metadata } from "next";
import { SuperAdminNewsPage } from "@/src/fsd/pages/super-admin-news";

export const metadata: Metadata = { title: "Новости" };

export default function SuperAdminNewsRoute() {
  return <SuperAdminNewsPage />;
}
