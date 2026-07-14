import { apiClient } from "@/src/fsd/shared/api";

export type PayrollScheme = "salary" | "percent" | "salary_percent" | "category_bonus" | "salary_category_bonus";
export type PayrollPercentBase = "revenue" | "profit";

export type PayrollConfig = {
  enabled: boolean;
  position: string;
  customPosition: string;
  scheme: PayrollScheme;
  monthlySalary: number;
  percent: number;
  percentBase: PayrollPercentBase;
};

export type PayrollProduct = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  sum: number;
};

export type PayrollSale = {
  id: string;
  name: string;
  typeLabel: string;
  moment: string;
  amount: number;
  netProfit: number;
  webUrl: string;
  customerName: string;
  products: PayrollProduct[];
};

export type PayrollRow = {
  id: string;
  href: string;
  name: string;
  payroll: PayrollConfig;
  dirty?: boolean;
  loadingSales?: boolean;
  documents: number;
  revenue: number;
  profit: number;
  categoryBonus: number;
  sales: PayrollSale[];
  fixedSalary: number;
  commission: number;
  totalSalary: number;
};

export type PayrollTotals = {
  employees: number;
  documents: number;
  revenue: number;
  profit: number;
  fixedSalary: number;
  commission: number;
  totalSalary: number;
  unassignedDocuments: number;
  unassignedRevenue: number;
};

export type PayrollReport = {
  dateFrom: string;
  dateTo: string;
  partial?: boolean;
  rows: PayrollRow[];
  totals: PayrollTotals;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown) {
  return Boolean(value);
}

function normalizeScheme(value: unknown): PayrollScheme {
  const schemes: PayrollScheme[] = ["salary", "percent", "salary_percent", "category_bonus", "salary_category_bonus"];
  return schemes.includes(value as PayrollScheme) ? (value as PayrollScheme) : "salary_percent";
}

function normalizePercentBase(value: unknown): PayrollPercentBase {
  return value === "profit" ? "profit" : "revenue";
}

function normalizePayrollConfig(value: unknown): PayrollConfig {
  const record = asRecord(value);
  return {
    enabled: asBoolean(record.enabled),
    position: asString(record.position || "other"),
    customPosition: asString(record.customPosition),
    scheme: normalizeScheme(record.scheme),
    monthlySalary: asNumber(record.monthlySalary),
    percent: asNumber(record.percent),
    percentBase: normalizePercentBase(record.percentBase),
  };
}

function normalizeProduct(value: unknown): PayrollProduct {
  const record = asRecord(value);
  return {
    code: asString(record.code),
    name: asString(record.name),
    quantity: asNumber(record.quantity),
    price: asNumber(record.price),
    sum: asNumber(record.sum),
  };
}

function normalizeSale(value: unknown): PayrollSale {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    typeLabel: asString(record.typeLabel),
    moment: asString(record.moment),
    amount: asNumber(record.amount),
    netProfit: asNumber(record.netProfit),
    webUrl: asString(record.webUrl),
    customerName: asString(record.customerName),
    products: asArray(record.products).map(normalizeProduct),
  };
}

function normalizeRow(value: unknown): PayrollRow {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    href: asString(record.href),
    name: asString(record.name),
    payroll: normalizePayrollConfig(record.payroll),
    dirty: asBoolean(record.dirty),
    loadingSales: asBoolean(record.loadingSales),
    documents: asNumber(record.documents),
    revenue: asNumber(record.revenue),
    profit: asNumber(record.profit),
    categoryBonus: asNumber(record.categoryBonus),
    sales: asArray(record.sales).map(normalizeSale),
    fixedSalary: asNumber(record.fixedSalary),
    commission: asNumber(record.commission),
    totalSalary: asNumber(record.totalSalary),
  };
}

function normalizeTotals(value: unknown): PayrollTotals {
  const record = asRecord(value);
  return {
    employees: asNumber(record.employees),
    documents: asNumber(record.documents),
    revenue: asNumber(record.revenue),
    profit: asNumber(record.profit),
    fixedSalary: asNumber(record.fixedSalary),
    commission: asNumber(record.commission),
    totalSalary: asNumber(record.totalSalary),
    unassignedDocuments: asNumber(record.unassignedDocuments),
    unassignedRevenue: asNumber(record.unassignedRevenue),
  };
}

export async function getPayrollReport(params: { dateFrom: string; dateTo: string }): Promise<PayrollReport> {
  const searchParams = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  const payload = asRecord(await apiClient<unknown>(`/api/payroll?${searchParams.toString()}`));
  return {
    dateFrom: asString(payload.dateFrom),
    dateTo: asString(payload.dateTo),
    partial: asBoolean(payload.partial),
    rows: asArray(payload.rows).map(normalizeRow),
    totals: normalizeTotals(payload.totals),
  };
}

export async function getPayrollEmployeesReport(params: { dateFrom: string; dateTo: string }): Promise<PayrollReport> {
  const searchParams = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  const payload = asRecord(await apiClient<unknown>(`/api/payroll/employees?${searchParams.toString()}`));
  return {
    dateFrom: asString(payload.dateFrom),
    dateTo: asString(payload.dateTo),
    partial: asBoolean(payload.partial),
    rows: asArray(payload.rows).map(normalizeRow),
    totals: normalizeTotals(payload.totals),
  };
}

export async function savePayrollConfigs(rows: PayrollRow[]) {
  return apiClient<unknown>("/api/payroll/employees/config", {
    method: "POST",
    body: {
      employees: rows.map((row) => ({
        employeeHref: row.href,
        payroll: row.payroll,
      })),
    },
  });
}

export async function addPayrollExpense(payload: { expenseDate: string; amount: number; description: string }) {
  return apiClient<unknown>("/api/expenses", {
    method: "POST",
    body: {
      expenseDate: payload.expenseDate,
      category: "fixed",
      subcategory: "Зарплата сотрудников",
      amount: payload.amount,
      branchName: "",
      paymentMethod: "",
      description: payload.description,
    },
  });
}
