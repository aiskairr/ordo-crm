import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SuperAdminConfigurationError,
  type SuperAdminSession,
  verifySuperAdminSessionToken,
} from "@/src/app/api/_lib/super-admin-auth";
import { SuperAdminLogin } from "@/src/fsd/pages/super-admin";

export const metadata: Metadata = {
  title: "Super Admin — ORDO CRM",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SuperAdminLoginPage() {
  const cookieStore = await cookies();
  let session: SuperAdminSession | null = null;

  try {
    session = verifySuperAdminSessionToken(cookieStore.get(SUPER_ADMIN_SESSION_COOKIE)?.value);
  } catch (caught) {
    if (!(caught instanceof SuperAdminConfigurationError)) {
      throw caught;
    }
  }

  if (session) {
    redirect("/super-admin");
  }

  return <SuperAdminLogin />;
}
