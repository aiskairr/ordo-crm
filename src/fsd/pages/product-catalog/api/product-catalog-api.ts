import { apiClient } from "@/src/fsd/shared/api";
import type { CatalogProduct, ProductCatalogFile, ProductCatalogPayload } from "../model/product-catalog-model";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getHeaderFileName(header: string | null) {
  const encodedName = String(header || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return encodedName ? decodeURIComponent(encodedName) : "katalog-belek-tehnika.pdf";
}

function normalizeProduct(value: unknown): CatalogProduct {
  const row = asRecord(value);
  const prices = Array.isArray(row.prices) ? row.prices.map((price) => {
    const record = asRecord(price);
    return {
      name: asString(record.name),
      value: asNumber(record.value),
      currency: asString(record.currency),
    };
  }).filter((price) => price.name) : [];
  return {
    href: asString(row.href),
    name: asString(row.name),
    code: asString(row.code),
    article: asString(row.article || row.sku),
    price: asNumber(row.price),
    stock: asNumber(row.stock),
    prices,
  };
}

export async function searchCatalogProducts(search: string, signal?: AbortSignal): Promise<CatalogProduct[]> {
  const params = new URLSearchParams({ search });
  const response = await apiClient<unknown>(`/api/products?${params.toString()}`, { signal, timeoutMs: 30_000 });
  const products = Array.isArray(response) ? response : asRecord(response).products;
  return (Array.isArray(products) ? products : []).map(normalizeProduct).filter((product) => product.href && product.name);
}

export async function createProductCatalog(payload: ProductCatalogPayload): Promise<ProductCatalogFile> {
  const response = await fetch("/api/product-catalog/pdf", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/pdf, text/html, application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const errorPayload = contentType.includes("application/json")
      ? asRecord(await response.json().catch(() => ({})))
      : {};
    throw new Error(asString(errorPayload.error || errorPayload.message) || "Не удалось создать PDF-каталог.");
  }

  return {
    blob: await response.blob(),
    fileName: getHeaderFileName(response.headers.get("Content-Disposition")),
    contentType: response.headers.get("Content-Type") || "application/octet-stream",
  };
}
