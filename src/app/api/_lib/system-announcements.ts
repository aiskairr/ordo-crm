import "server-only";

import { randomUUID } from "node:crypto";

export type SystemAnnouncement = {
  id: string;
  title: string;
  message: string;
  important: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

const SETTINGS_KEY = "system_announcements";
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 4000;

export class SystemAnnouncementsStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemAnnouncementsStorageError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeAnnouncement(value: unknown): SystemAnnouncement | null {
  const row = asRecord(value);
  const id = asString(row.id).trim();
  const title = asString(row.title).trim();
  const message = asString(row.message).trim();
  const createdAt = asString(row.createdAt);
  const updatedAt = asString(row.updatedAt);
  if (!id || !title || !message || !createdAt || !updatedAt) return null;
  return {
    id,
    title: title.slice(0, MAX_TITLE_LENGTH),
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    important: row.important === true,
    published: row.published === true,
    createdAt,
    updatedAt,
    publishedAt: asString(row.publishedAt) || null,
  };
}

function normalizeItems(value: unknown) {
  const items = asRecord(value).items;
  return (Array.isArray(items) ? items : [])
    .map(normalizeAnnouncement)
    .filter((item): item is SystemAnnouncement => Boolean(item))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, ""),
    key: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

function getEnvironmentFallback() {
  const raw = String(process.env.CRM_ANNOUNCEMENTS_JSON || "").trim();
  if (!raw) return [];
  try {
    return normalizeItems(JSON.parse(raw));
  } catch {
    console.error("CRM_ANNOUNCEMENTS_JSON contains invalid JSON.");
    return [];
  }
}

async function settingsFetch(url: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    throw new SystemAnnouncementsStorageError("Для новостей настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
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
    throw new SystemAnnouncementsStorageError("Не удалось подключиться к Supabase для работы с новостями.");
  } finally {
    clearTimeout(timeout);
  }
}

function storageError(status: number, payload: unknown) {
  const code = asString(asRecord(payload).code);
  if (status === 404 || code === "PGRST205" || code === "42P01") {
    return new SystemAnnouncementsStorageError("Таблица crm_system_settings отсутствует. Примените миграцию Super Admin.");
  }
  return new SystemAnnouncementsStorageError(`Supabase не сохранил новости (ошибка ${status}).`);
}

export async function getSystemAnnouncements(options: { fallbackOnError?: boolean } = {}) {
  const config = getConfig();
  if (!config.url || !config.key) {
    if (options.fallbackOnError) return getEnvironmentFallback();
    throw new SystemAnnouncementsStorageError("Для новостей настройте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  }
  const url = new URL(`${config.url}/rest/v1/crm_system_settings`);
  url.searchParams.set("key", `eq.${SETTINGS_KEY}`);
  url.searchParams.set("select", "value");
  url.searchParams.set("limit", "1");
  try {
    const response = await settingsFetch(url.toString());
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw storageError(response.status, payload);
    }
    const rows = await response.json() as Array<{ value?: unknown }>;
    return rows.length ? normalizeItems(rows[0]?.value) : getEnvironmentFallback();
  } catch (caught) {
    if (options.fallbackOnError) {
      console.error("System announcements fallback is used:", caught instanceof Error ? caught.message : caught);
      return getEnvironmentFallback();
    }
    throw caught;
  }
}

async function saveSystemAnnouncements(items: SystemAnnouncement[]) {
  const config = getConfig();
  const url = new URL(`${config.url}/rest/v1/crm_system_settings`);
  url.searchParams.set("on_conflict", "key");
  const response = await settingsFetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ key: SETTINGS_KEY, value: { items }, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw storageError(response.status, payload);
  }
  return items;
}

function validateInput(value: unknown) {
  const row = asRecord(value);
  const title = asString(row.title).trim();
  const message = asString(row.message).trim();
  if (!title) throw new Response("Введите заголовок новости.", { status: 400 });
  if (!message) throw new Response("Введите текст новости.", { status: 400 });
  if (title.length > MAX_TITLE_LENGTH) throw new Response(`Заголовок не должен превышать ${MAX_TITLE_LENGTH} символов.`, { status: 400 });
  if (message.length > MAX_MESSAGE_LENGTH) throw new Response(`Текст не должен превышать ${MAX_MESSAGE_LENGTH} символов.`, { status: 400 });
  return { title, message, important: row.important === true, published: row.published === true };
}

export async function createSystemAnnouncement(value: unknown) {
  const input = validateInput(value);
  const items = await getSystemAnnouncements();
  const timestamp = new Date().toISOString();
  const announcement: SystemAnnouncement = {
    id: randomUUID(),
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: input.published ? timestamp : null,
  };
  await saveSystemAnnouncements([announcement, ...items]);
  return announcement;
}

export async function updateSystemAnnouncement(id: string, value: unknown) {
  const input = validateInput(value);
  const items = await getSystemAnnouncements();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Response("Новость не найдена.", { status: 404 });
  const current = items[index];
  const timestamp = new Date().toISOString();
  const updated: SystemAnnouncement = {
    ...current,
    ...input,
    updatedAt: timestamp,
    publishedAt: input.published ? current.publishedAt || timestamp : null,
  };
  items[index] = updated;
  await saveSystemAnnouncements(items);
  return updated;
}

export async function deleteSystemAnnouncement(id: string) {
  const items = await getSystemAnnouncements();
  const nextItems = items.filter((item) => item.id !== id);
  if (nextItems.length === items.length) throw new Response("Новость не найдена.", { status: 404 });
  await saveSystemAnnouncements(nextItems);
}
