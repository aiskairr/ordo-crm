import { ProductCatalogPage } from "@/src/fsd/pages/product-catalog";
import { AppShell } from "@/src/fsd/widgets/app-shell";

export default function ProductCatalogRoute() {
  return (
    <AppShell>
      <ProductCatalogPage />
    </AppShell>
  );
}
