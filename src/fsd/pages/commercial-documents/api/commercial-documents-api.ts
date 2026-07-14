import type { Customer } from "@/src/fsd/entities/customer";
import type { Product } from "@/src/fsd/entities/product";
import { apiClient } from "@/src/fsd/shared/api";
import { getRetailStores, getSalesSession, type RetailStore } from "../../sales/api/sales-api";

export type CommercialItem = {
  id: string;
  productName: string;
  code: string;
  assortmentHref: string;
  assortmentType: string;
  productPrice: number;
  quantity: number;
  minPrice?: number;
  wholesalePrice?: number;
};

export type CommercialPayload = {
  documentType: "demand";
  description: string;
  customerMode: "new" | "existing";
  customerName: string;
  customerInn: string;
  customerBank: string;
  customerBik: string;
  customerSettlementAccount: string;
  customerCorrAccount: string;
  customerOkpo: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerHref: string;
  customerGroups: string[];
  storeHref: string;
  employeeName: string;
  branchName: string;
  items: CommercialItem[];
};

export type CommercialPdfResult = {
  blob: Blob;
  fileName: string;
  documentName: string;
  documentWebUrl: string;
};

export type CommercialCustomer = Customer & {
  inn?: string;
  bank?: string;
  bik?: string;
  settlementAccount?: string;
  corrAccount?: string;
  okpo?: string;
  email?: string;
  groups?: string[];
};

export type CommercialProduct = Product & {
  minPrice?: number;
  wholesalePrice?: number;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asArray(value: unknown, key: string) {
  const record = asRecord(value);
  return Array.isArray(value) ? value : Array.isArray(record[key]) ? record[key] : [];
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function productPriceValue(value: unknown) {
  const record = asRecord(value);
  return asNumber(record.value);
}

function normalizeProduct(value: unknown): CommercialProduct {
  const record = asRecord(value);
  const minPrice = productPriceValue(record.minPrice);
  const wholesalePrice = productPriceValue(record.wholesalePrice);
  return {
    id: asNumber(record.id),
    href: asString(record.href),
    type: asString(record.assortmentType || record.type || "product"),
    name: asString(record.name),
    code: asString(record.code),
    sku: asString(record.sku),
    barcode: asString(record.barcode),
    price: minPrice || asNumber(record.price),
    minPrice,
    wholesalePrice,
  };
}

function normalizeCustomer(value: unknown): CommercialCustomer {
  const record = asRecord(value);
  return {
    id: asNumber(record.id),
    href: asString(record.href),
    name: asString(record.name),
    phone: asString(record.phone),
    actualAddress: asString(record.actualAddress || record.address),
    inn: asString(record.inn),
    bank: asString(record.bank),
    bik: asString(record.bik),
    settlementAccount: asString(record.settlementAccount),
    corrAccount: asString(record.corrAccount),
    okpo: asString(record.okpo),
    email: asString(record.email),
    groups: asStringArray(record.groups),
  };
}

export async function searchCommercialProducts(search: string, storeHref = ""): Promise<CommercialProduct[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (storeHref) params.set("storeHref", storeHref);
  return asArray(await apiClient<unknown>(`/api/products?${params.toString()}`), "products").map(normalizeProduct).filter((item) => item.href);
}

export async function searchCommercialCustomers(search: string): Promise<CommercialCustomer[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return asArray(await apiClient<unknown>(`/api/customers?${params.toString()}`), "customers").map(normalizeCustomer).filter((item) => item.href);
}

export async function getCommercialRetailStores(): Promise<RetailStore[]> {
  return getRetailStores();
}

export async function getCommercialSession() {
  return getSalesSession();
}

function getHeaderFilename(header: string | null) {
  const match = String(header || "").match(/filename\*=UTF-8''([^;]+)/i);
  return match ? decodeURIComponent(match[1]) : "schet-na-oplatu.pdf";
}

export async function createCommercialPdf(payload: CommercialPayload): Promise<CommercialPdfResult> {
  const response = await fetch("/api/commercial-documents/pdf", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/pdf, application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = asRecord(await response.json().catch(() => ({})));
    throw new Error(asString(data.error || data.message) || "Не удалось сформировать PDF-счет.");
  }

  return {
    blob: await response.blob(),
    fileName: getHeaderFilename(response.headers.get("Content-Disposition")),
    documentName: decodeURIComponent(response.headers.get("X-Commercial-Document-Name") || ""),
    documentWebUrl: decodeURIComponent(response.headers.get("X-Commercial-Document-Web-Url") || ""),
  };
}

export function makeCommercialItem(): CommercialItem {
  return {
    id: crypto.randomUUID(),
    productName: "",
    code: "",
    assortmentHref: "",
    assortmentType: "product",
    productPrice: 0,
    quantity: 1,
  };
}
