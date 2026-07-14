import type { Customer } from "@/src/fsd/entities/customer";
import type { Product } from "@/src/fsd/entities/product";
import { apiClient } from "@/src/fsd/shared/api";

export type SelectOption = {
  id: string;
  href?: string;
  name: string;
  branchKey?: string;
  branches?: string[];
};

export type CurrentSalesUser = {
  id: string;
  name: string;
  login?: string;
  role: string;
  branches: string[];
};

export type PaymentTypeOption = SelectOption & {
  provider?: string;
  months?: number;
  rate: number;
  comment: string;
};

export type SalesConfig = {
  branches: SelectOption[];
  employees: SelectOption[];
};

export type RetailStore = SelectOption & {
  storeHref: string;
  storeName: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asArray(payload: unknown, key: string) {
  const record = asRecord(payload);
  return Array.isArray(payload) ? payload : Array.isArray(record[key]) ? record[key] : [];
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeOption(value: unknown): SelectOption {
  const record = asRecord(value);
  const branches = asStringArray(record.branches ?? record.branchIds);
  return {
    id: asString(record.href ?? record.id ?? record.value),
    href: asString(record.href, undefined),
    name: asString(record.name ?? record.title ?? record.label),
    branchKey: asString(record.branchKey ?? branches[0], undefined),
    branches,
  };
}

function normalizeCurrentSalesUser(value: unknown): CurrentSalesUser {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    login: asString(record.login, undefined),
    role: asString(record.role),
    branches: asStringArray(record.branches),
  };
}

function normalizePaymentType(value: unknown): PaymentTypeOption {
  const record = asRecord(value);
  return {
    ...normalizeOption(value),
    provider: asString(record.provider, undefined),
    months: asNumber(record.months, undefined),
    rate: asNumber(record.rate),
    comment: asString(record.comment, ""),
  };
}

function normalizeRetailStore(value: unknown): RetailStore {
  const record = asRecord(value);
  return {
    ...normalizeOption(value),
    storeHref: asString(record.storeHref),
    storeName: asString(record.storeName),
  };
}

function normalizeProduct(value: unknown): Product {
  const record = asRecord(value);

  return {
    id: asNumber(record.id),
    href: asString(record.href, undefined),
    type: asString(record.type, "product"),
    name: asString(record.name ?? record.title),
    code: asString(record.code, undefined),
    sku: asString(record.sku ?? record.article, undefined),
    barcode: asString(record.barcode, undefined),
    price: asNumber(record.price ?? record.salePrice),
    cost: asNumber(record.cost, undefined),
    stock: asNumber(record.stock ?? record.quantity, undefined),
  };
}

function normalizeCustomer(value: unknown): Customer {
  const record = asRecord(value);

  return {
    id: asNumber(record.id),
    href: asString(record.href, undefined),
    name: asString(record.name ?? record.fullName),
    phone: asString(record.phone, undefined),
    actualAddress: asString(record.actualAddress ?? record.address, undefined),
  };
}

export async function getSalesConfig(): Promise<SalesConfig> {
  const payload = await apiClient<unknown>("/api/config");
  const record = asRecord(payload);

  return {
    branches: asArray(record.branches ?? record.filials, "branches").map(normalizeOption).filter((item) => item.id),
    employees: [],
  };
}

export async function getSalesSession() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/session"));
  return {
    user: payload.user ? normalizeCurrentSalesUser(payload.user) : null,
  };
}

export async function getEmployees(): Promise<SelectOption[]> {
  return asArray(await apiClient<unknown>("/api/employees"), "employees")
    .map(normalizeOption)
    .filter((item) => item.id);
}

export async function getRetailStores(): Promise<RetailStore[]> {
  return asArray(await apiClient<unknown>("/api/retail-stores"), "retailStores")
    .map(normalizeRetailStore)
    .filter((item) => item.id);
}

export async function getPaymentTypes(): Promise<PaymentTypeOption[]> {
  return asArray(await apiClient<unknown>("/api/payment-types"), "paymentTypes")
    .map(normalizePaymentType)
    .filter((item) => item.id);
}

export async function getProducts(search = "", storeHref = "", branchName = ""): Promise<Product[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (storeHref) params.set("storeHref", storeHref);
  if (branchName) params.set("branchName", branchName);

  return asArray(await apiClient<unknown>(`/api/products?${params.toString()}`), "products")
    .map(normalizeProduct)
    .filter((item) => item.href || item.id > 0);
}

export async function getCustomers(search = "", branchName = ""): Promise<Customer[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (branchName) params.set("branchName", branchName);

  return asArray(await apiClient<unknown>(`/api/customers?${params.toString()}`), "customers")
    .map(normalizeCustomer)
    .filter((item) => item.href || item.id > 0);
}

export async function calculateSale(draft: unknown) {
  return apiClient<unknown>("/api/calculate", {
    method: "POST",
    body: draft,
  });
}

export async function createOrder(draft: unknown) {
  return apiClient<unknown>("/api/orders", {
    method: "POST",
    body: draft,
  });
}
