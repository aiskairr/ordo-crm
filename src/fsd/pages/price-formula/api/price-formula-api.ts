import { apiClient } from "@/src/fsd/shared/api";

export type TierCurrency = "kgs" | "usd";

export type PriceTier = {
  from: string | number;
  to: string | number;
  amount: string | number;
  currency: TierCurrency;
};

export type PriceFormulaTemplate = {
  name: string;
  usdRate: number;
  tiers: PriceTier[];
  wholesaleTiers: PriceTier[];
  bank36: number;
  bank912: number;
  calculate36: boolean;
  calculate912: boolean;
  rounding: number;
  wholesaleRounding: number;
};

export type PriceType = { name: string; href: string };

export type ProductFolder = {
  href: string;
  name: string;
  pathName: string;
  template: PriceFormulaTemplate | null;
};

export type ProductPriceRecord = {
  priceTypeHref: string;
  priceTypeName: string;
  value: number;
  currencyHref: string;
  currencyIsoCode: string;
  currencyName: string;
};

export type ProductMoney = {
  value?: number;
  currencyHref?: string;
  currencyIsoCode?: string;
  currencyName?: string;
};

export type PriceProduct = {
  id: string;
  href: string;
  name: string;
  code: string;
  article: string;
  archived: boolean;
  folder: ProductFolder | null;
  buyPrice?: ProductMoney;
  minPrice?: ProductMoney;
  prices: ProductPriceRecord[];
};

export type PriceCatalogPage = {
  priceTypes: PriceType[];
  folders: ProductFolder[];
  products: PriceProduct[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
};

export type FormulaChange = {
  productId: string;
  wholesaleCurrencyHref: string;
  wholesalePrice: number;
  minPrice: number;
  price36: number | null;
  price912: number | null;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (value && typeof value === "object" ? (value as UnknownRecord) : {});
const asArray = (value: unknown, key: string) => (Array.isArray(value) ? value : Array.isArray(asRecord(value)[key]) ? (asRecord(value)[key] as unknown[]) : []);
const asString = (value: unknown) => (typeof value === "string" ? value : "");
const asNumber = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const asBoolean = (value: unknown) => Boolean(value);

const parseTierCurrency = (value: unknown): TierCurrency => (String(value || "").toLowerCase() === "usd" ? "usd" : "kgs");

function parseTier(value: unknown): PriceTier {
  const row = asRecord(value);
  return {
    from: typeof row.from === "number" || typeof row.from === "string" ? row.from : "",
    to: typeof row.to === "number" || typeof row.to === "string" ? row.to : "",
    amount: typeof row.amount === "number" || typeof row.amount === "string" ? row.amount : "",
    currency: parseTierCurrency(row.currency),
  };
}

function parseTemplate(value: unknown): PriceFormulaTemplate | null {
  const row = asRecord(value);
  if (!row.name && !row.tiers) return null;
  return {
    name: asString(row.name) || "Шаблон",
    usdRate: asNumber(row.usdRate) || 89,
    tiers: asArray(row.tiers, "tiers").map(parseTier),
    wholesaleTiers: asArray(row.wholesaleTiers, "wholesaleTiers").map(parseTier),
    bank36: asNumber(row.bank36) || 10,
    bank912: asNumber(row.bank912) || 20,
    calculate36: row.calculate36 !== false,
    calculate912: row.calculate912 !== false,
    rounding: asNumber(row.rounding) || 10,
    wholesaleRounding: asNumber(row.wholesaleRounding) || 0.1,
  };
}

function parseFolder(value: unknown): ProductFolder {
  const row = asRecord(value);
  return {
    href: asString(row.href),
    name: asString(row.name),
    pathName: asString(row.pathName),
    template: parseTemplate(row.template),
  };
}

function parseMoney(value: unknown): ProductMoney {
  const row = asRecord(value);
  return {
    value: asNumber(row.value),
    currencyHref: asString(row.currencyHref),
    currencyIsoCode: asString(row.currencyIsoCode),
    currencyName: asString(row.currencyName),
  };
}

function parseProduct(value: unknown): PriceProduct {
  const row = asRecord(value);
  const folder = row.folder ? parseFolder(row.folder) : null;
  return {
    id: asString(row.id),
    href: asString(row.href),
    name: asString(row.name),
    code: asString(row.code),
    article: asString(row.article),
    archived: asBoolean(row.archived),
    folder: folder?.href ? folder : null,
    buyPrice: parseMoney(row.buyPrice),
    minPrice: parseMoney(row.minPrice),
    prices: asArray(row.prices, "prices").map((item) => {
      const price = asRecord(item);
      return {
        priceTypeHref: asString(price.priceTypeHref),
        priceTypeName: asString(price.priceTypeName),
        value: asNumber(price.value),
        currencyHref: asString(price.currencyHref),
        currencyIsoCode: asString(price.currencyIsoCode),
        currencyName: asString(price.currencyName),
      };
    }),
  };
}

export async function getAccountingPriceCatalogPage(params: { offset: number; limit: number; includePriceTypes?: boolean }) {
  const query = new URLSearchParams({
    offset: String(params.offset),
    limit: String(params.limit),
  });
  if (params.includePriceTypes === false) query.set("includePriceTypes", "false");
  const data = asRecord(await apiClient<unknown>(`/api/accounting/prices?${query.toString()}`));
  return {
    priceTypes: asArray(data.priceTypes, "priceTypes").map((item) => ({ name: asString(asRecord(item).name), href: asString(asRecord(item).href) })).filter((item) => item.href),
    folders: asArray(data.folders, "folders").map(parseFolder).filter((item) => item.href),
    products: asArray(data.products, "products").map(parseProduct).filter((item) => item.id),
    total: asNumber(data.total),
    nextOffset: asNumber(data.nextOffset),
    hasMore: asBoolean(data.hasMore),
  } satisfies PriceCatalogPage;
}

export async function getAccountingPriceCatalog() {
  const first = await getAccountingPriceCatalogPage({ offset: 0, limit: 500 });
  const products = new Map(first.products.map((product) => [product.id, product]));
  let offset = first.nextOffset;
  while (first.total > products.size && offset < first.total) {
    const page = await getAccountingPriceCatalogPage({ offset, limit: 500, includePriceTypes: false });
    for (const product of page.products) products.set(product.id, product);
    offset = page.nextOffset || products.size;
    if (!page.hasMore) break;
  }
  return { ...first, products: [...products.values()] };
}

export async function getSupplyProducts(queryValue: string) {
  const query = new URLSearchParams({ query: queryValue });
  const data = asRecord(await apiClient<unknown>(`/api/accounting/supply-products?${query.toString()}`));
  return {
    name: asString(data.name),
    products: asArray(data.products, "products").map((item) => ({ href: asString(asRecord(item).href) })).filter((item) => item.href),
  };
}

export async function saveFolderTemplate(payload: { folderHref: string; template: PriceFormulaTemplate | null }) {
  const data = asRecord(await apiClient<unknown>("/api/accounting/price-formula/folder-template", { method: "POST", body: payload }));
  return parseFolder(data);
}

export async function saveFormulaPrices(payload: { priceType36Href: string; priceType912Href: string; priceTypeWholesaleHref: string; changes: FormulaChange[] }) {
  return apiClient<{ updated?: number; failed?: number; results?: Array<{ ok?: boolean; error?: string }> }>("/api/accounting/prices/formula-update", { method: "POST", body: payload });
}
