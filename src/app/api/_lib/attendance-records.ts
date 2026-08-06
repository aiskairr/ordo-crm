import "server-only";

export type AttendanceStorageRecord = {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  checkInTime: string;
  checkOutTime: string;
  checkInDistanceMeters: number | null;
  checkOutDistanceMeters: number | null;
  totalWorkMinutes: number;
  currentWorkMinutes: number;
  lateMinutes: number;
  status: "open" | "closed";
  source: "wifi" | "geo" | "admin";
  telegramOpenMessageId?: number;
  telegramCloseMessageId?: number;
};

type JsonRecord = Record<string, unknown>;

const TABLE_PATH = "/rest/v1/crm_attendance_records";
const SELECT_COLUMNS = [
  "id",
  "user_id",
  "user_name",
  "store_id",
  "store_name",
  "check_in_time",
  "check_out_time",
  "total_work_minutes",
  "late_minutes",
  "status",
  "source",
  "telegram_open_message_id",
  "telegram_close_message_id",
].join(",");

export class AttendanceRecordsStorageError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "AttendanceRecordsStorageError";
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

export function canUseSupabaseAttendanceRecords(userId: string) {
  const config = getConfig();
  return Boolean(config.url && config.key && /^[0-9a-f-]{36}$/i.test(userId));
}

function storageError(status: number, payload: unknown) {
  const record = asRecord(payload);
  const code = asString(record.code);
  if (status === 404 || code === "PGRST205" || code === "42P01") {
    return new AttendanceRecordsStorageError(
      "Таблица crm_attendance_records отсутствует. Примените миграцию supabase/attendance-records.sql.",
      503,
    );
  }
  if (code === "23505") {
    return new AttendanceRecordsStorageError("У сотрудника уже есть открытая смена.", 409);
  }
  const message = asString(record.message) || asString(record.hint);
  return new AttendanceRecordsStorageError(
    message ? `Supabase не сохранил посещаемость: ${message}` : `Ошибка Supabase при сохранении посещаемости (${status}).`,
    status >= 400 && status < 500 ? status : 503,
  );
}

async function attendanceFetch(url: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new AttendanceRecordsStorageError("Для посещаемости настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
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
    if (caught instanceof AttendanceRecordsStorageError) throw caught;
    throw new AttendanceRecordsStorageError("Не удалось подключиться к Supabase для сохранения посещаемости.");
  } finally {
    clearTimeout(timeout);
  }
}

function tableUrl(params: Record<string, string>) {
  const config = getConfig();
  const url = new URL(`${config.url}${TABLE_PATH}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function normalizeRecord(value: unknown): AttendanceStorageRecord {
  const row = asRecord(value);
  const status = row.status === "open" ? "open" : "closed";
  const source = row.source === "admin" ? "admin" : row.source === "geo" ? "geo" : "wifi";
  const totalWorkMinutes = asNumber(row.total_work_minutes);
  return {
    id: asString(row.id),
    userId: asString(row.user_id),
    userName: asString(row.user_name),
    storeId: asString(row.store_id),
    storeName: asString(row.store_name),
    checkInTime: asString(row.check_in_time),
    checkOutTime: asString(row.check_out_time),
    checkInDistanceMeters: 0,
    checkOutDistanceMeters: status === "closed" ? 0 : null,
    totalWorkMinutes,
    currentWorkMinutes: totalWorkMinutes,
    lateMinutes: asNumber(row.late_minutes),
    status,
    source,
    telegramOpenMessageId: asNumber(row.telegram_open_message_id) || undefined,
    telegramCloseMessageId: asNumber(row.telegram_close_message_id) || undefined,
  };
}

function nextIsoDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export async function getOpenSupabaseAttendanceRecord(userId: string) {
  const rows = await attendanceFetch(tableUrl({
    select: SELECT_COLUMNS,
    user_id: `eq.${userId}`,
    status: "eq.open",
    order: "check_in_time.desc",
    limit: "1",
  })) as unknown[];
  return rows[0] ? normalizeRecord(rows[0]) : null;
}

export async function listSupabaseAttendanceRecords(filters: {
  dateFrom?: string;
  dateTo?: string;
  userId?: string;
  storeId?: string;
}) {
  const records: AttendanceStorageRecord[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const params: Record<string, string> = {
      select: SELECT_COLUMNS,
      order: "check_in_time.desc",
      limit: String(pageSize),
      offset: String(offset),
    };
    const lowerBound = filters.dateFrom ? `${filters.dateFrom}T00:00:00+06:00` : "";
    const upperBound = filters.dateTo ? `${nextIsoDate(filters.dateTo)}T00:00:00+06:00` : "";
    if (lowerBound && upperBound) params.and = `(check_in_time.gte.${lowerBound},check_in_time.lt.${upperBound})`;
    else if (lowerBound) params.check_in_time = `gte.${lowerBound}`;
    else if (upperBound) params.check_in_time = `lt.${upperBound}`;
    if (filters.userId) params.user_id = `eq.${filters.userId}`;
    if (filters.storeId) params.store_id = `eq.${filters.storeId}`;
    const rows = await attendanceFetch(tableUrl(params)) as unknown[];
    records.push(...rows.map(normalizeRecord));
    if (rows.length < pageSize) break;
  }
  return records;
}

export async function createSupabaseAttendanceRecord(
  record: Omit<AttendanceStorageRecord, "source"> & { source?: AttendanceStorageRecord["source"] },
  checkInIp: string,
) {
  const rows = await attendanceFetch(tableUrl({ select: SELECT_COLUMNS }), {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: record.id,
      user_id: record.userId,
      user_name: record.userName,
      store_id: record.storeId,
      store_name: record.storeName,
      check_in_time: record.checkInTime,
      total_work_minutes: 0,
      late_minutes: record.lateMinutes,
      status: "open",
      source: record.source || "wifi",
      check_in_ip: checkInIp || null,
    }),
  }) as unknown[];
  if (!rows[0]) throw new AttendanceRecordsStorageError("Supabase не вернул созданную смену.");
  return normalizeRecord(rows[0]);
}

export async function closeSupabaseAttendanceRecord(input: {
  id: string;
  checkOutTime: string;
  totalWorkMinutes: number;
  checkOutIp: string;
}) {
  const rows = await attendanceFetch(tableUrl({
    id: `eq.${input.id}`,
    status: "eq.open",
    select: SELECT_COLUMNS,
  }), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: "closed",
      check_out_time: input.checkOutTime,
      total_work_minutes: Math.max(0, Math.round(input.totalWorkMinutes)),
      check_out_ip: input.checkOutIp || null,
    }),
  }) as unknown[];
  if (!rows[0]) throw new AttendanceRecordsStorageError("Открытая смена уже закрыта или не найдена.", 409);
  return normalizeRecord(rows[0]);
}

export async function updateSupabaseAttendanceTelegramResult(input: {
  id: string;
  action: "open" | "close";
  messageId?: number;
  error?: string;
}) {
  const prefix = input.action === "open" ? "telegram_open" : "telegram_close";
  await attendanceFetch(tableUrl({ id: `eq.${input.id}` }), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      [`${prefix}_message_id`]: input.messageId || null,
      [`${prefix}_error`]: input.error ? input.error.slice(0, 1000) : null,
    }),
  });
}
