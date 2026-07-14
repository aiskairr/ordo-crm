import { PayrollPage } from "@/src/fsd/pages/payroll";
import { AppShell } from "@/src/fsd/widgets/app-shell";

export default function PayrollRoute() {
  return (
    <AppShell>
      <PayrollPage />
    </AppShell>
  );
}
