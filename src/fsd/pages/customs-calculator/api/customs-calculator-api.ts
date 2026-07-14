import { apiClient } from "@/src/fsd/shared/api";

export type CustomsHistory = { id: string; name: string; createdAt: string; rowsCount: number; totals?: Record<string, number> };
export type CustomsProduct = { id: string; href: string; name: string; code: string; article: string; buyPrice?: { value?: number; currencyIsoCode?: string; currencyName?: string } };
export type CustomsDraft = { rows?: unknown[]; rowSeq?: number; partyExpenses?: Record<string, unknown> };
type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord => v && typeof v === "object" ? v as UnknownRecord : {};
const asArray = (v: unknown, k: string) => Array.isArray(v) ? v : Array.isArray(asRecord(v)[k]) ? asRecord(v)[k] as unknown[] : [];
const asString = (v: unknown) => typeof v === "string" ? v : "";
const asNumber = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;
export async function getCustomsHistory() {
  return asArray(await apiClient<unknown>("/api/customs-calculator/history"), "rows").map((v) => {
    const r = asRecord(v);
    const payload = asRecord(r.payload);
    const draftRows = asArray(payload.rows, "rows");
    return {
      id: asString(r.id),
      name: asString(r.title) || asString(r.name),
      createdAt: asString(r.updated_at) || asString(r.created_at) || asString(r.createdAt),
      rowsCount: draftRows.length || asNumber(r.rowsCount),
      totals: asRecord(r.totals) as Record<string, number>,
    };
  });
}
export async function saveCustomsHistory(payload: unknown) {
  return apiClient<unknown>("/api/customs-calculator/history", { method: "POST", body: payload });
}
export async function deleteCustomsHistory(id: string) {
  return apiClient<unknown>(`/api/customs-calculator/history/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function getCustomsHistoryItem(id: string) {
  const data = asRecord(await apiClient<unknown>(`/api/customs-calculator/history/${encodeURIComponent(id)}`));
  return asRecord(asRecord(data.row).payload) as CustomsDraft;
}
export async function getCustomsProducts() {
  const products: CustomsProduct[] = [];
  let offset = 0;
  while (true) {
    const data = asRecord(await apiClient<unknown>(`/api/accounting/prices?offset=${offset}&limit=500&includePriceTypes=false`));
    for (const item of asArray(data.products, "products")) {
      const row = asRecord(item);
      const buy = asRecord(row.buyPrice);
      products.push({
        id: asString(row.id),
        href: asString(row.href),
        name: asString(row.name),
        code: asString(row.code),
        article: asString(row.article),
        buyPrice: { value: asNumber(buy.value), currencyIsoCode: asString(buy.currencyIsoCode), currencyName: asString(buy.currencyName) },
      });
    }
    if (!data.hasMore) break;
    offset = asNumber(data.nextOffset) || products.length;
  }
  return products.filter((product) => product.id);
}
