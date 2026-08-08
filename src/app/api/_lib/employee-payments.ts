import "server-only";

export type EmployeePayment = {
  id: string;
  employeeId: string;
  employeeName: string;
  paymentType: "advance" | "salary";
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  comment: string;
  status: "paid" | "cancelled";
  createdBy: string;
  createdAt: string;
};

type JsonRecord = Record<string, unknown>;

const TABLE_PATH = "/rest/v1/crm_employee_payments";
const SELECT_COLUMNS = "id,employee_id,employee_name,payment_type,amount,payment_date,payment_method,comment,status,created_by,created_at";

export class EmployeePaymentsStorageError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "EmployeePaymentsStorageError";
    this.status = status;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, ""),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

function storageError(status: number, payload: unknown) {
  const row = asRecord(payload);
  const code = asString(row.code);
  if (status === 404 || code === "PGRST205" || code === "42P01") {
    return new EmployeePaymentsStorageError(
      "Таблица crm_employee_payments отсутствует. Примените миграцию supabase/employee-payments.sql.",
    );
  }
  const message = asString(row.message) || asString(row.hint);
  return new EmployeePaymentsStorageError(
    message ? `Supabase не сохранил выплату: ${message}` : `Ошибка Supabase при работе с выплатами (${status}).`,
    status >= 400 && status < 500 ? status : 503,
  );
}

async function paymentFetch(url: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new EmployeePaymentsStorageError("Для авансов настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw storageError(response.status, payload);
    return payload;
  } catch (caught) {
    if (caught instanceof EmployeePaymentsStorageError) throw caught;
    throw new EmployeePaymentsStorageError("Не удалось подключиться к Supabase для работы с авансами.");
  } finally {
    clearTimeout(timeout);
  }
}

function tableUrl(params: Record<string, string> = {}) {
  const config = getConfig();
  const url = new URL(`${config.url}${TABLE_PATH}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function normalizePayment(value: unknown): EmployeePayment {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    employeeId: asString(row.employee_id),
    employeeName: asString(row.employee_name),
    paymentType: row.payment_type === "salary" ? "salary" : "advance",
    amount: asNumber(row.amount),
    paymentDate: asString(row.payment_date),
    paymentMethod: asString(row.payment_method),
    comment: asString(row.comment),
    status: row.status === "cancelled" ? "cancelled" : "paid",
    createdBy: asString(row.created_by),
    createdAt: asString(row.created_at),
  };
}

export async function listEmployeePayments(filters: { dateFrom?: string; dateTo?: string; employeeId?: string } = {}) {
  const params: Record<string, string> = { select: SELECT_COLUMNS, status: "eq.paid", order: "payment_date.desc,created_at.desc" };
  if (filters.dateFrom) params.payment_date = `gte.${filters.dateFrom}`;
  if (filters.dateTo) params.and = `(payment_date.lte.${filters.dateTo})`;
  if (filters.employeeId) params.employee_id = `eq.${filters.employeeId}`;
  const rows = await paymentFetch(tableUrl(params)) as unknown[];
  return rows.map(normalizePayment);
}

export async function createEmployeePayment(input: Omit<EmployeePayment, "id" | "createdAt" | "status">) {
  const rows = await paymentFetch(tableUrl({ select: SELECT_COLUMNS }), {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      employee_id: input.employeeId,
      employee_name: input.employeeName,
      payment_type: input.paymentType,
      amount: input.amount,
      payment_date: input.paymentDate,
      payment_method: input.paymentMethod,
      comment: input.comment,
      status: "paid",
      created_by: input.createdBy,
    }),
  }) as unknown[];
  if (!rows[0]) throw new EmployeePaymentsStorageError("Supabase не вернул сохранённую выплату.");
  return normalizePayment(rows[0]);
}
