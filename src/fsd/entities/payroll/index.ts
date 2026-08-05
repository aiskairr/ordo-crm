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

export const PAYROLL_SCHEME_LABELS: Record<PayrollScheme, string> = {
  salary: "Только оклад",
  percent: "Только процент",
  salary_percent: "Оклад + процент",
  category_bonus: "Бонус по категории",
  salary_category_bonus: "Оклад + бонус категории",
};

export const PAYROLL_PERCENT_BASE_LABELS: Record<PayrollPercentBase, string> = {
  revenue: "Выручка",
  profit: "Прибыль",
};

export function isPercentPayrollScheme(scheme: PayrollScheme) {
  return scheme === "percent" || scheme === "salary_percent";
}

export function createDefaultPayrollConfig(monthlySalary = 0, customPosition = ""): PayrollConfig {
  return {
    enabled: monthlySalary > 0,
    position: "other",
    customPosition,
    scheme: "salary_percent",
    monthlySalary,
    percent: 0,
    percentBase: "revenue",
  };
}

export function normalizePayrollConfig(value: unknown): PayrollConfig {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const schemes: PayrollScheme[] = ["salary", "percent", "salary_percent", "category_bonus", "salary_category_bonus"];
  const monthlySalary = Number(record.monthlySalary);
  const percent = Number(record.percent);
  return {
    enabled: Boolean(record.enabled),
    position: typeof record.position === "string" && record.position ? record.position : "other",
    customPosition: typeof record.customPosition === "string" ? record.customPosition : "",
    scheme: schemes.includes(record.scheme as PayrollScheme) ? record.scheme as PayrollScheme : "salary_percent",
    monthlySalary: Number.isFinite(monthlySalary) ? monthlySalary : 0,
    percent: Number.isFinite(percent) ? percent : 0,
    percentBase: record.percentBase === "profit" ? "profit" : "revenue",
  };
}
