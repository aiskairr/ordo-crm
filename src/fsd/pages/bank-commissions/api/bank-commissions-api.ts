import { apiClient } from "@/src/fsd/shared/api";

export type BankCommissionPayment = {
  saleId: string;
  saleName: string;
  customerName: string;
  moment: string;
  amount: number;
  rate: number;
  commission: number;
  netAmount: number;
};

export type BankCommissionRow = {
  paymentType: string;
  bankName: string;
  turnover: number;
  commission: number;
  netAmount: number;
  paymentCount: number;
  averageRate: number;
  shareOfTotalCommission: number;
  payments: BankCommissionPayment[];
};

export type BankCommissionReport = {
  rows: BankCommissionRow[];
  bankOptions: string[];
  paymentTypeOptions: string[];
  totals: {
    commission: number;
    turnover: number;
    netAmount: number;
    paymentCount: number;
    averageRate: number;
    topCommissionBank?: { paymentType?: string };
  };
};

export type BankCommissionFilters = {
  dateFrom: string;
  dateTo: string;
  bank?: string;
  paymentType?: string;
};

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

function normalizePayment(value: unknown): BankCommissionPayment {
  const record = asRecord(value);
  return {
    saleId: asString(record.saleId),
    saleName: asString(record.saleName),
    customerName: asString(record.customerName),
    moment: asString(record.moment),
    amount: asNumber(record.amount),
    rate: asNumber(record.rate),
    commission: asNumber(record.commission),
    netAmount: asNumber(record.netAmount),
  };
}

function normalizeRow(value: unknown): BankCommissionRow {
  const record = asRecord(value);
  return {
    paymentType: asString(record.paymentType),
    bankName: asString(record.bankName),
    turnover: asNumber(record.turnover),
    commission: asNumber(record.commission),
    netAmount: asNumber(record.netAmount),
    paymentCount: asNumber(record.paymentCount),
    averageRate: asNumber(record.averageRate),
    shareOfTotalCommission: asNumber(record.shareOfTotalCommission),
    payments: asArray(record.payments).map(normalizePayment),
  };
}

export async function getBankCommissions(filters: BankCommissionFilters): Promise<BankCommissionReport> {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.bank) params.set("bank", filters.bank);
  if (filters.paymentType) params.set("paymentType", filters.paymentType);
  const payload = asRecord(await apiClient<unknown>(`/api/reports/bank-commissions?${params.toString()}`));
  const totals = asRecord(payload.totals);

  return {
    rows: asArray(payload.rows).map(normalizeRow).filter((row) => row.paymentType),
    bankOptions: asArray(payload.bankOptions).map(String),
    paymentTypeOptions: asArray(payload.paymentTypeOptions).map(String),
    totals: {
      commission: asNumber(totals.commission),
      turnover: asNumber(totals.turnover),
      netAmount: asNumber(totals.netAmount),
      paymentCount: asNumber(totals.paymentCount),
      averageRate: asNumber(totals.averageRate),
      topCommissionBank: asRecord(totals.topCommissionBank),
    },
  };
}
