import { apiClient } from "@/src/fsd/shared/api";

export type ExpenseCategory = "fixed" | "variable" | "one_time" | "operational" | "marketing" | "taxes" | "financial";

export type Expense = {
  id: string;
  expenseDate: string;
  category: ExpenseCategory;
  subcategory: string;
  amount: number;
  branchName: string;
  paymentMethod: string;
  description: string;
  createdBy: string;
};

export type ExpensePayload = {
  expenseDate: string;
  category: ExpenseCategory;
  subcategory: string;
  amount: string;
  branchName: string;
  paymentMethod: string;
  description: string;
};

export type ExpenseFilters = {
  dateFrom: string;
  dateTo: string;
  category?: ExpenseCategory | "";
};

const categories: ExpenseCategory[] = ["fixed", "variable", "one_time", "operational", "marketing", "taxes", "financial"];

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

function normalizeCategory(value: unknown): ExpenseCategory {
  return categories.includes(value as ExpenseCategory) ? (value as ExpenseCategory) : "operational";
}

function normalizeExpense(value: unknown): Expense {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    expenseDate: asString(record.expense_date ?? record.expenseDate),
    category: normalizeCategory(record.category),
    subcategory: asString(record.subcategory),
    amount: asNumber(record.amount),
    branchName: asString(record.branch_name ?? record.branchName),
    paymentMethod: asString(record.payment_method ?? record.paymentMethod),
    description: asString(record.description),
    createdBy: asString(record.created_by ?? record.createdBy),
  };
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, { label: string; hint: string; examples: string[] }> = {
  fixed: { label: "Постоянные", hint: "Регулярные платежи: аренда, зарплата, интернет, охрана.", examples: ["Аренда", "Зарплата", "Интернет", "Охрана"] },
  variable: { label: "Переменные", hint: "Зависят от продаж: закуп товара, доставка, упаковка.", examples: ["Закуп товара", "Доставка", "Упаковка"] },
  one_time: { label: "Разовые", hint: "Единоразовые вложения: ремонт, вывеска, техника.", examples: ["Ремонт", "Вывеска", "Техника"] },
  operational: { label: "Операционные", hint: "Ежедневная работа: топливо, расходники, грузчики.", examples: ["Топливо", "Канцелярия", "Грузчики"] },
  marketing: { label: "Маркетинг", hint: "Реклама, баннеры, розыгрыши и контент.", examples: ["Instagram", "Таргет", "Баннеры"] },
  taxes: { label: "Налоги", hint: "Налоги и обязательные платежи.", examples: ["Налоги", "Соцфонд", "Патент"] },
  financial: { label: "Финансовые", hint: "Комиссии банков, проценты и курсовые потери.", examples: ["Комиссия банка", "Эквайринг", "Проценты"] },
};

export async function getExpenses(filters: ExpenseFilters) {
  const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  if (filters.category) params.set("category", filters.category);
  const payload = asRecord(await apiClient<unknown>(`/api/expenses?${params.toString()}`));
  return asArray(payload.expenses).map(normalizeExpense).filter((expense) => expense.id);
}

export async function createExpense(payload: ExpensePayload) {
  return apiClient<unknown>("/api/expenses", { method: "POST", body: payload });
}

export async function updateExpense(id: string, payload: ExpensePayload) {
  return apiClient<unknown>(`/api/expenses/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export async function deleteExpense(id: string) {
  return apiClient<unknown>(`/api/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
}
