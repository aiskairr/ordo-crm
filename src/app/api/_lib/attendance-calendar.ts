import "server-only";

export type AttendanceCalendarStorageKind = "present" | "late" | "absent" | "holiday" | "day_off" | "leave" | "short_day" | "delivery";

export type AttendanceCalendarStorageEntry = {
  id: string;
  kind: AttendanceCalendarStorageKind;
  dateFrom: string;
  dateTo: string;
  userId: string;
  storeId: string;
  title: string;
  workEndsAt: string;
  createdAt: string;
  createdBy: string;
};

type JsonRecord = Record<string, unknown>;

const TABLE_PATH = "/rest/v1/crm_attendance_calendar";
const SELECT_COLUMNS = "id,kind,date_from,date_to,user_id,store_id,title,work_ends_at,created_by,created_at";
const KINDS: AttendanceCalendarStorageKind[] = ["present", "late", "absent", "holiday", "day_off", "leave", "short_day", "delivery"];

export class AttendanceCalendarStorageError extends Error {
  status: number;

  constructor(message: string, status = 503) {
    super(message);
    this.name = "AttendanceCalendarStorageError";
    this.status = status;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
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
    return new AttendanceCalendarStorageError(
      "Таблица crm_attendance_calendar отсутствует. Примените миграцию supabase/attendance-calendar.sql.",
    );
  }
  const message = asString(row.message) || asString(row.hint);
  return new AttendanceCalendarStorageError(
    message ? `Supabase не сохранил отметку табеля: ${message}` : `Ошибка Supabase при работе с табелем (${status}).`,
    status >= 400 && status < 500 ? status : 503,
  );
}

async function calendarFetch(url: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new AttendanceCalendarStorageError("Для табеля настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
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
    if (caught instanceof AttendanceCalendarStorageError) throw caught;
    throw new AttendanceCalendarStorageError("Не удалось подключиться к Supabase для работы с отметками табеля.");
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

function normalizeEntry(value: unknown): AttendanceCalendarStorageEntry {
  const row = asRecord(value);
  const kind = KINDS.includes(row.kind as AttendanceCalendarStorageKind)
    ? row.kind as AttendanceCalendarStorageKind
    : "day_off";
  return {
    id: asString(row.id),
    kind,
    dateFrom: asString(row.date_from),
    dateTo: asString(row.date_to),
    userId: asString(row.user_id),
    storeId: asString(row.store_id),
    title: asString(row.title),
    workEndsAt: asString(row.work_ends_at),
    createdAt: asString(row.created_at),
    createdBy: asString(row.created_by),
  };
}

export async function listSupabaseAttendanceCalendarEntries() {
  const rows = await calendarFetch(tableUrl({ select: SELECT_COLUMNS, order: "date_from.desc,created_at.desc" })) as unknown[];
  return rows.map(normalizeEntry);
}

export async function replaceSupabaseAttendanceCalendarEntry(entry: AttendanceCalendarStorageEntry) {
  const filters = new URLSearchParams({
    date_from: `eq.${entry.dateFrom}`,
    date_to: `eq.${entry.dateTo}`,
    user_id: entry.userId ? `eq.${entry.userId}` : "is.null",
    store_id: entry.storeId ? `eq.${entry.storeId}` : "is.null",
  });
  await calendarFetch(`${tableUrl()}?${filters.toString()}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  const rows = await calendarFetch(tableUrl({ select: SELECT_COLUMNS }), {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: entry.id,
      kind: entry.kind,
      date_from: entry.dateFrom,
      date_to: entry.dateTo,
      user_id: entry.userId || null,
      store_id: entry.storeId || null,
      title: entry.title,
      work_ends_at: entry.workEndsAt,
      created_by: entry.createdBy,
      created_at: entry.createdAt,
    }),
  }) as unknown[];
  if (!rows[0]) throw new AttendanceCalendarStorageError("Supabase не вернул сохранённую отметку табеля.");
  return normalizeEntry(rows[0]);
}

export async function deleteSupabaseAttendanceCalendarEntry(id: string) {
  const rows = await calendarFetch(tableUrl({ id: `eq.${id}`, select: "id" }), {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  }) as unknown[];
  if (!rows.length) throw new AttendanceCalendarStorageError("Отметка табеля не найдена.", 404);
}
