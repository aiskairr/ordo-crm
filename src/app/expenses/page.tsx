import { ExpensesPage } from "@/src/fsd/pages/expenses";
import { AppShell } from "@/src/fsd/widgets/app-shell";

export default function ExpensesRoute() {
  return (
    <AppShell>
      <ExpensesPage />
    </AppShell>
  );
}
