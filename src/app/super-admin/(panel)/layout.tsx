import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SUPER_ADMIN_SESSION_COOKIE,
  SuperAdminConfigurationError,
  type SuperAdminSession,
  verifySuperAdminSessionToken,
} from "@/src/app/api/_lib/super-admin-auth";
import { SuperAdminShell } from "@/src/fsd/widgets/super-admin-shell";

export default async function SuperAdminPanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  let session: SuperAdminSession | null = null;

  try {
    session = verifySuperAdminSessionToken(cookieStore.get(SUPER_ADMIN_SESSION_COOKIE)?.value);
  } catch (caught) {
    if (!(caught instanceof SuperAdminConfigurationError)) throw caught;
  }

  if (!session) redirect("/super-admin/login");
  return <SuperAdminShell session={session}>{children}</SuperAdminShell>;
}
