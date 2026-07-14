import { apiClient } from "@/src/fsd/shared/api";

export type Debtor = {
  id: string;
  href?: string;
  name: string;
  customerType: string;
  customerTypeLabel: string;
  phone: string;
  inn: string;
  actualAddress: string;
  lastDocumentName: string;
  lastMoment: string;
  documentCount: number;
  amount?: number;
  paid: number;
  debt: number;
};

export type ReconciliationList = {
  debtors: Debtor[];
  totals: { debt: number; debtors: number; documents: number; paid: number };
  loadedAt: string;
  truncated: boolean;
  partial: boolean;
  page: { offset: number; limit: number; nextOffset: number; hasMore: boolean };
};

export type ReconciliationDetails = {
  debtor: Debtor;
  totals: { debt: number; amount: number; paid: number; documents: number };
  documents: Array<{
    id: string;
    name: string;
    type: string;
    typeLabel: string;
    moment: string;
    webUrl: string;
    amount: number;
    paid: number;
    debt: number;
    originalDebt: number;
    organizationName?: string;
    storeName?: string;
    paymentType?: string;
    comment?: string;
    customerPhone?: string;
    customerInn?: string;
    customerAddress?: string;
    appliedPayments: Array<{ id: string; name: string; amount: number; moment: string }>;
  }>;
  payments: Array<{ id: string; name: string; moment: string; webUrl: string; amount: number; description?: string; organizationName?: string }>;
  act: {
    customerName: string;
    date: string;
    rows: Array<{ id: string; moment: string; operation: string; debit: number; credit: number }>;
    totals: { debit: number; credit: number; saldo: number };
  };
};

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord => (value && typeof value === "object" ? (value as UnknownRecord) : {});
const asArray = (value: unknown, key: string) => Array.isArray(value) ? value : Array.isArray(asRecord(value)[key]) ? asRecord(value)[key] as unknown[] : [];
const asString = (value: unknown) => typeof value === "string" ? value : "";
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function debtor(value: unknown): Debtor {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    href: asString(row.href),
    name: asString(row.name),
    customerType: asString(row.customerType),
    customerTypeLabel: asString(row.customerTypeLabel),
    phone: asString(row.phone),
    inn: asString(row.inn),
    actualAddress: asString(row.actualAddress),
    lastDocumentName: asString(row.lastDocumentName),
    lastMoment: asString(row.lastMoment),
    documentCount: asNumber(row.documentCount),
    amount: asNumber(row.amount),
    paid: asNumber(row.paid),
    debt: asNumber(row.debt),
  };
}

export async function getReconciliationDebtors(params: { search: string; customerType: string; offset?: number; limit?: number }) {
  const query = new URLSearchParams({ limit: String(params.limit ?? 60), offset: String(params.offset ?? 0) });
  if (params.search) query.set("search", params.search);
  if (params.customerType) query.set("customerType", params.customerType);
  const payload = asRecord(await apiClient<unknown>(`/api/reconciliation/debtors?${query.toString()}`));
  const totals = asRecord(payload.totals);
  const page = asRecord(payload.page);
  return {
    debtors: asArray(payload.debtors, "debtors").map(debtor),
    totals: { debt: asNumber(totals.debt), debtors: asNumber(totals.debtors), documents: asNumber(totals.documents), paid: asNumber(totals.paid) },
    loadedAt: asString(payload.loadedAt),
    truncated: Boolean(payload.truncated),
    partial: payload.partial === true,
    page: {
      offset: asNumber(page.offset),
      limit: asNumber(page.limit),
      nextOffset: asNumber(page.nextOffset),
      hasMore: page.hasMore === true,
    },
  } satisfies ReconciliationList;
}

export async function getReconciliationDetails(id: string): Promise<ReconciliationDetails> {
  const payload = asRecord(await apiClient<unknown>(`/api/reconciliation/debtors/${encodeURIComponent(id)}`));
  const totals = asRecord(payload.totals);
  const mapDoc = (value: unknown) => {
    const row = asRecord(value);
    return {
      id: asString(row.id),
      name: asString(row.name),
      type: asString(row.type),
      typeLabel: asString(row.typeLabel),
      moment: asString(row.moment),
      webUrl: asString(row.webUrl),
      amount: asNumber(row.amount),
      paid: asNumber(row.paid),
      debt: asNumber(row.debt),
      originalDebt: asNumber(row.originalDebt),
      organizationName: asString(row.organizationName),
      storeName: asString(row.storeName),
      paymentType: asString(row.paymentType),
      comment: asString(row.comment),
      customerPhone: asString(row.customerPhone),
      customerInn: asString(row.customerInn),
      customerAddress: asString(row.customerAddress),
      appliedPayments: asArray(row.appliedPayments, "appliedPayments").map((payment) => {
        const item = asRecord(payment);
        return {
          id: asString(item.id),
          name: asString(item.name),
          amount: asNumber(item.amount),
          moment: asString(item.moment),
        };
      }),
    };
  };
  const mapPayment = (value: unknown) => {
    const row = asRecord(value);
    return { id: asString(row.id), name: asString(row.name), moment: asString(row.moment), webUrl: asString(row.webUrl), amount: asNumber(row.amount), description: asString(row.description), organizationName: asString(row.organizationName) };
  };
  const act = asRecord(payload.act);
  return {
    debtor: debtor(payload.debtor),
    totals: { debt: asNumber(totals.debt), amount: asNumber(totals.amount), paid: asNumber(totals.paid), documents: asNumber(totals.documents) },
    documents: asArray(payload.documents, "documents").map(mapDoc),
    payments: asArray(payload.payments, "payments").map(mapPayment),
    act: {
      customerName: asString(act.customerName),
      date: asString(act.date),
      rows: asArray(act.rows, "rows").map((row) => {
        const item = asRecord(row);
        return {
          id: asString(item.id),
          moment: asString(item.moment),
          operation: asString(item.operation),
          debit: asNumber(item.debit),
          credit: asNumber(item.credit),
        };
      }),
      totals: {
        debit: asNumber(asRecord(act.totals).debit),
        credit: asNumber(asRecord(act.totals).credit),
        saldo: asNumber(asRecord(act.totals).saldo),
      },
    },
  };
}
