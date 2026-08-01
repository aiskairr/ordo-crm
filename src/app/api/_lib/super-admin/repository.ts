import "server-only";

import type { SuperAdminHealthStatus, SuperAdminTableStatus } from "./types";

const tableDefinitions = [
  { key: "crm_modules", title: "Модули CRM", primaryKey: "key" },
  { key: "crm_system_settings", title: "Системные настройки", primaryKey: "key" },
  { key: "crm_integrations", title: "Интеграции", primaryKey: "key" },
  { key: "crm_branches", title: "Филиалы", primaryKey: "id" },
] as const;

type TableKey = typeof tableDefinitions[number]["key"];

function getSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, ""),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseCount(value: string | null) {
  const match = String(value || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function safeSupabaseError(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const row = payload as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code : "";
    if (code === "PGRST205" || code === "42P01") return "Таблица отсутствует";
  }
  return status === 404 ? "Таблица отсутствует" : `Supabase вернул ошибку ${status}`;
}

async function inspectTable(definition: typeof tableDefinitions[number]): Promise<SuperAdminTableStatus> {
  const config = getSupabaseConfig();
  if (!config.url || !config.key) {
    return { key: definition.key, title: definition.title, exists: false, count: null, error: "Supabase не настроен" };
  }

  const url = new URL(`${config.url}/rest/v1/${definition.key}`);
  url.searchParams.set("select", definition.primaryKey);
  url.searchParams.set("limit", "1");
  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return { key: definition.key, title: definition.title, exists: false, count: null, error: safeSupabaseError(payload, response.status) };
    }
    return {
      key: definition.key,
      title: definition.title,
      exists: true,
      count: parseCount(response.headers.get("content-range")) ?? 0,
      error: "",
    };
  } catch (caught) {
    const message = caught instanceof DOMException && caught.name === "AbortError"
      ? "Supabase не ответил вовремя"
      : "Не удалось подключиться к Supabase";
    return { key: definition.key, title: definition.title, exists: false, count: null, error: message };
  }
}

async function countFilteredRows(table: TableKey, primaryKey: "key" | "id", filter: string) {
  const config = getSupabaseConfig();
  if (!config.url || !config.key) return 0;
  const url = new URL(`${config.url}/rest/v1/${table}`);
  url.searchParams.set("select", primaryKey);
  const [name, value] = filter.split("=");
  if (name && value) url.searchParams.set(name, value);
  url.searchParams.set("limit", "1");
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  return response.ok ? parseCount(response.headers.get("content-range")) ?? 0 : 0;
}

export async function getSuperAdminDatabaseOverview() {
  const config = getSupabaseConfig();
  const configured = Boolean(config.url && config.key);
  const tables = await Promise.all(tableDefinitions.map(inspectTable));
  const existing = new Set(tables.filter((table) => table.exists).map((table) => table.key));
  const [enabledModules, activeBranches] = await Promise.all([
    existing.has("crm_modules") ? countFilteredRows("crm_modules", "key", "enabled=eq.true").catch(() => 0) : Promise.resolve(0),
    existing.has("crm_branches") ? countFilteredRows("crm_branches", "id", "active=eq.true").catch(() => 0) : Promise.resolve(0),
  ]);
  const missingCount = tables.filter((table) => !table.exists).length;
  const status: SuperAdminHealthStatus = !configured ? "not_configured" : missingCount ? "warning" : "healthy";
  return {
    configured,
    status,
    message: !configured
      ? "Добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY"
      : missingCount
        ? `Не готовы таблицы: ${missingCount}`
        : "Supabase и таблицы Super Admin доступны",
    tables,
    enabledModules,
    activeBranches,
  };
}
