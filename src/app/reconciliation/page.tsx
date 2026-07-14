import { ReconciliationPage } from "@/src/fsd/pages/reconciliation";
import { AppShell } from "@/src/fsd/widgets/app-shell";

export default function ReconciliationRoute() {
  return (
    <AppShell>
      <ReconciliationPage />
    </AppShell>
  );
}
