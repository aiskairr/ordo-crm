import "server-only";

export type AttendanceNetworkSettings = {
  ayu: string[];
  besh: string[];
  updatedAt: string;
};

const SETTINGS_KEY = "attendance_networks";
const CACHE_TTL_MS = 15_000;
let settingsCache: { value: AttendanceNetworkSettings; createdAt: number } | null = null;

export class AttendanceNetworkSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttendanceNetworkSettingsError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeRules(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\s,;]+/);
  return [...new Set(source.map((rule) => String(rule).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function environmentFallback(): AttendanceNetworkSettings {
  return {
    ayu: normalizeRules(process.env.ATTENDANCE_AYU_ALLOWED_IPS || process.env.ATTENDANCE_AYU_GRAND_ALLOWED_IPS),
    besh: normalizeRules(process.env.ATTENDANCE_BESH_ALLOWED_IPS || process.env.ATTENDANCE_BESH_SARY_ALLOWED_IPS),
    updatedAt: "",
  };
}

function normalizeSettings(value: unknown): AttendanceNetworkSettings {
  const record = asRecord(value);
  return {
    ayu: normalizeRules(record.ayu),
    besh: normalizeRules(record.besh),
    updatedAt: asString(record.updatedAt),
  };
}

function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, ""),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

async function settingsFetch(url: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new AttendanceNetworkSettingsError("Для сохранения IP настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new AttendanceNetworkSettingsError("Не удалось подключиться к Supabase для работы с IP посещаемости.");
  } finally {
    clearTimeout(timeout);
  }
}

function storageError(status: number, payload: unknown) {
  const code = asString(asRecord(payload).code);
  if (status === 404 || code === "PGRST205" || code === "42P01") {
    return new AttendanceNetworkSettingsError("Таблица crm_system_settings отсутствует. Примените миграцию Super Admin.");
  }
  return new AttendanceNetworkSettingsError(`Supabase не сохранил IP посещаемости (ошибка ${status}).`);
}

export async function getAttendanceNetworkSettings(options: { fresh?: boolean } = {}) {
  if (!options.fresh && settingsCache && Date.now() - settingsCache.createdAt < CACHE_TTL_MS) return settingsCache.value;
  const fallback = environmentFallback();
  const config = getConfig();
  if (!config.url || !config.key) return fallback;

  const url = new URL(`${config.url}/rest/v1/crm_system_settings`);
  url.searchParams.set("key", `eq.${SETTINGS_KEY}`);
  url.searchParams.set("select", "value");
  url.searchParams.set("limit", "1");
  try {
    const response = await settingsFetch(url.toString());
    if (!response.ok) return fallback;
    const rows = await response.json() as Array<{ value?: unknown }>;
    const stored = rows.length ? normalizeSettings(rows[0]?.value) : fallback;
    settingsCache = { value: stored, createdAt: Date.now() };
    return stored;
  } catch {
    return fallback;
  }
}

export async function saveAttendanceNetworkSettings(value: unknown) {
  const record = asRecord(value);
  const updatedAt = new Date().toISOString();
  const settings: AttendanceNetworkSettings = {
    ayu: normalizeRules(record.ayu),
    besh: normalizeRules(record.besh),
    updatedAt,
  };
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new AttendanceNetworkSettingsError("Для сохранения IP настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  }
  const url = new URL(`${config.url}/rest/v1/crm_system_settings`);
  url.searchParams.set("on_conflict", "key");
  const response = await settingsFetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ key: SETTINGS_KEY, value: settings, updated_at: updatedAt }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw storageError(response.status, payload);
  }
  settingsCache = { value: settings, createdAt: Date.now() };
  return settings;
}
