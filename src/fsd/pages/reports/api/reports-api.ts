import { apiClient } from "@/src/fsd/shared/api";
import type { SalesReceiptData } from "@/src/fsd/features/print-sales-receipt";

export type ReportType = "retaildemand" | "demand" | "retailsalesreturn" | "salesreturn";
export type CustomerType = "legal" | "entrepreneur" | "individual" | "";

export type RetailStore = {
  id: string;
  name: string;
  href: string;
  storeHref: string;
};

export type ReportProduct = {
  index?: number;
  positionId?: string;
  code: string;
  name: string;
  quantity: number;
  price: number;
  sum: number;
  sourcePrice?: number;
  sourceSum?: number;
  currencyIsoCode?: string;
  exchangeRate?: number;
  isGift: boolean;
  categoryName?: string;
  categoryPath?: string;
};

export type ReportRow = {
  id: string;
  type: ReportType;
  typeLabel: string;
  name: string;
  moment: string;
  amount: number;
  paid: number;
  unpaid: number;
  sourceAmount?: number;
  sourcePaid?: number;
  sourceUnpaid?: number;
  currencyIsoCode?: string;
  exchangeRate?: number;
  commission?: number;
  netProfit: number;
  storeName: string;
  organizationName: string;
  customerId: string;
  customerHref: string;
  customerName: string;
  customerType: CustomerType;
  customerTypeLabel: string;
  customerPhone: string;
  customerInn: string;
  customerAddress: string;
  employeeName: string;
  employeeHref?: string;
  paymentType: string;
  comment: string;
  webUrl: string;
  productText: string;
  products: ReportProduct[];
};

export type SalesReport = {
  dateFrom?: string;
  dateTo?: string;
  rows: ReportRow[];
  totals?: {
    documents: number;
    amount: number;
    paid: number;
    unpaid: number;
    commission?: number;
    netProfit: number;
  };
  canViewProfit: boolean;
  canEditSales: boolean;
};

export type UpdateSalePricePayload = {
  documentId: string;
  documentType: Extract<ReportType, "retaildemand" | "demand">;
  productIndex: number;
  positionId?: string;
  price: number;
};

export type UpdateSalePriceResponse = {
  document: { id: string; name: string; amount: number; netProfit: number; receivable: number; webUrl: string };
  position: { id: string; previousPrice: number; price: number };
  profitUpdated: boolean;
  receivableUpdated: boolean;
  warning: string;
};

export type ReturnPayload = {
  documentId: string;
  documentType: Extract<ReportType, "retaildemand" | "demand">;
  productIndex: number;
  quantity: number;
};

export type ReturnResponse = {
  document: {
    id: string;
    name: string;
    type: "retailsalesreturn" | "salesreturn";
    webUrl: string;
  };
  receipt?: SalesReceiptData;
  telegramReturn?: {
    sent: boolean;
    error: string;
  };
};

export type ReportFilters = {
  dateFrom: string;
  dateTo: string;
  documentType?: ReportType;
  customerType?: CustomerType;
  search?: string;
  retailStoreHref?: string;
  storeHref?: string;
};

const reportTypes: ReportType[] = ["retaildemand", "demand", "retailsalesreturn", "salesreturn"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeReportType(value: unknown): ReportType {
  return reportTypes.includes(value as ReportType) ? (value as ReportType) : "retaildemand";
}

function normalizeCustomerType(value: unknown): CustomerType {
  if (value === "legal" || value === "entrepreneur" || value === "individual") return value;
  if (value === "person") return "individual";
  return "";
}

function normalizeStore(value: unknown): RetailStore {
  const record = asRecord(value);
  return {
    id: asString(record.id ?? record.href ?? record.name),
    name: asString(record.name),
    href: asString(record.href),
    storeHref: asString(record.storeHref ?? record.store_href),
  };
}

function normalizeProduct(value: unknown): ReportProduct {
  const record = asRecord(value);
  return {
    index: asNumber(record.index),
    positionId: asString(record.positionId ?? record.position_id),
    code: asString(record.code),
    name: asString(record.name),
    quantity: asNumber(record.quantity),
    price: asNumber(record.price),
    sum: asNumber(record.sum),
    sourcePrice: asNumber(record.sourcePrice ?? record.source_price),
    sourceSum: asNumber(record.sourceSum ?? record.source_sum),
    currencyIsoCode: asString(record.currencyIsoCode ?? record.currency_iso_code),
    exchangeRate: asNumber(record.exchangeRate ?? record.exchange_rate) || 1,
    isGift: record.isGift === true || record.is_gift === true,
    categoryName: asString(record.categoryName ?? record.category_name),
    categoryPath: asString(record.categoryPath ?? record.category_path),
  };
}

function normalizeRow(value: unknown): ReportRow {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    type: normalizeReportType(record.type),
    typeLabel: asString(record.typeLabel ?? record.type_label),
    name: asString(record.name),
    moment: asString(record.moment),
    amount: asNumber(record.amount),
    paid: asNumber(record.paid),
    unpaid: asNumber(record.unpaid),
    sourceAmount: asNumber(record.sourceAmount ?? record.source_amount),
    sourcePaid: asNumber(record.sourcePaid ?? record.source_paid),
    sourceUnpaid: asNumber(record.sourceUnpaid ?? record.source_unpaid),
    currencyIsoCode: asString(record.currencyIsoCode ?? record.currency_iso_code),
    exchangeRate: asNumber(record.exchangeRate ?? record.exchange_rate) || 1,
    commission: asNumber(record.commission ?? record.commission_amount),
    netProfit: asNumber(record.netProfit ?? record.net_profit),
    storeName: asString(record.storeName ?? record.store_name),
    organizationName: asString(record.organizationName ?? record.organization_name),
    customerId: asString(record.customerId ?? record.customer_id),
    customerHref: asString(record.customerHref ?? record.customer_href),
    customerName: asString(record.customerName ?? record.customer_name),
    customerType: normalizeCustomerType(record.customerType ?? record.customer_type),
    customerTypeLabel: asString(record.customerTypeLabel ?? record.customer_type_label),
    customerPhone: asString(record.customerPhone ?? record.customer_phone),
    customerInn: asString(record.customerInn ?? record.customer_inn),
    customerAddress: asString(record.customerAddress ?? record.customer_address),
    employeeName: asString(record.employeeName ?? record.employee_name),
    employeeHref: asString(record.employeeHref ?? record.employee_href),
    paymentType: asString(record.paymentType ?? record.payment_type),
    comment: asString(record.comment),
    webUrl: asString(record.webUrl ?? record.web_url),
    productText: asString(record.productText ?? record.product_text),
    products: asArray(record.products).map(normalizeProduct),
  };
}

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  retaildemand: "Продажи",
  demand: "Отгрузки",
  retailsalesreturn: "Возвраты продаж",
  salesreturn: "Возвраты отгрузок",
};

export async function getReportStores() {
  const payload = asRecord(await apiClient<unknown>("/api/retail-stores"));
  return asArray(payload.retailStores).map(normalizeStore).filter((store) => store.href || store.id);
}

export async function getSalesReport(filters: ReportFilters): Promise<SalesReport> {
  const params = new URLSearchParams({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });
  if (filters.documentType) params.set("documentType", filters.documentType);
  if (filters.customerType) params.set("customerType", filters.customerType);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.retailStoreHref) params.set("retailStoreHref", filters.retailStoreHref);
  if (filters.storeHref) params.set("storeHref", filters.storeHref);

  const payload = asRecord(await apiClient<unknown>(`/api/reports/sales?${params.toString()}`));
  return {
    dateFrom: asString(payload.dateFrom ?? payload.date_from),
    dateTo: asString(payload.dateTo ?? payload.date_to),
    rows: asArray(payload.rows).map(normalizeRow).filter((row) => row.id),
    totals: payload.totals ? {
      documents: asNumber(asRecord(payload.totals).documents),
      amount: asNumber(asRecord(payload.totals).amount),
      paid: asNumber(asRecord(payload.totals).paid),
      unpaid: asNumber(asRecord(payload.totals).unpaid),
      commission: asNumber(asRecord(payload.totals).commission),
      netProfit: asNumber(asRecord(payload.totals).netProfit ?? asRecord(payload.totals).net_profit),
    } : undefined,
    canViewProfit: payload.canViewProfit === true,
    canEditSales: payload.canEditSales === true,
  };
}

export async function updateReportSalePrice(payload: UpdateSalePricePayload): Promise<UpdateSalePriceResponse> {
  const data = asRecord(await apiClient<unknown>("/api/reports/sales/price", { method: "PATCH", body: payload }));
  const document = asRecord(data.document);
  const position = asRecord(data.position);
  return {
    document: {
      id: asString(document.id),
      name: asString(document.name),
      amount: asNumber(document.amount),
      netProfit: asNumber(document.netProfit),
      receivable: asNumber(document.receivable),
      webUrl: asString(document.webUrl ?? document.web_url),
    },
    position: {
      id: asString(position.id),
      previousPrice: asNumber(position.previousPrice ?? position.previous_price),
      price: asNumber(position.price),
    },
    profitUpdated: data.profitUpdated === true,
    receivableUpdated: data.receivableUpdated === true,
    warning: asString(data.warning),
  };
}

export async function createReportReturn(payload: ReturnPayload): Promise<ReturnResponse> {
  const data = asRecord(await apiClient<unknown>("/api/reports/returns", { method: "POST", body: payload }));
  const document = asRecord(data.document);
  const receipt = asRecord(data.receipt);
  const telegramReturn = asRecord(data.telegramReturn);
  return {
    document: {
      id: asString(document.id),
      name: asString(document.name),
      type: asString(document.type) === "salesreturn" ? "salesreturn" : "retailsalesreturn",
      webUrl: asString(document.webUrl ?? document.web_url),
    },
    receipt: Object.keys(receipt).length
      ? {
          receiptKind: "return",
          documentNumber: asString(receipt.documentNumber ?? receipt.document_number),
          sourceDocumentNumber: asString(receipt.sourceDocumentNumber ?? receipt.source_document_number),
          dateTime: asString(receipt.dateTime ?? receipt.date_time),
          storeName: asString(receipt.storeName ?? receipt.store_name),
          employeeName: asString(receipt.employeeName ?? receipt.employee_name),
          customerName: asString(receipt.customerName ?? receipt.customer_name),
          items: asArray(receipt.items).map((value) => {
            const item = asRecord(value);
            return {
              name: asString(item.name),
              price: asNumber(item.price),
              quantity: asNumber(item.quantity),
              lineTotal: asNumber(item.lineTotal ?? item.line_total),
              isGift: item.isGift === true || item.is_gift === true,
            };
          }),
          baseTotal: asNumber(receipt.baseTotal ?? receipt.base_total),
          finalTotal: asNumber(receipt.finalTotal ?? receipt.final_total),
          paymentType: asString(receipt.paymentType ?? receipt.payment_type),
          paidAmount: asNumber(receipt.paidAmount ?? receipt.paid_amount),
          unpaidAmount: asNumber(receipt.unpaidAmount ?? receipt.unpaid_amount),
        }
      : undefined,
    telegramReturn: data.telegramReturn && typeof data.telegramReturn === "object"
      ? {
          sent: telegramReturn.sent === true,
          error: asString(telegramReturn.error),
        }
      : undefined,
  };
}
