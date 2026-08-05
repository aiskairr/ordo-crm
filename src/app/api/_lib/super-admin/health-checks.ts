import "server-only";

import type { SuperAdminIntegrationStatus } from "./types";
import { moySkladRateLimitedFetch } from "../moysklad-rate-limiter";

async function timedCheck(
  input: Omit<SuperAdminIntegrationStatus, "checkedAt" | "responseTimeMs">,
  check?: () => Promise<{ ok: boolean; message: string }>,
): Promise<SuperAdminIntegrationStatus> {
  const checkedAt = new Date().toISOString();
  if (!input.configured || !check) return { ...input, checkedAt, responseTimeMs: null };
  const startedAt = Date.now();
  try {
    const result = await check();
    return {
      ...input,
      status: result.ok ? "healthy" : "error",
      message: result.message,
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
    };
  } catch {
    return {
      ...input,
      status: "error",
      message: "Сервис не ответил на безопасную проверку",
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
    };
  }
}

async function checkedFetch(url: string, headers: HeadersInit, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSuperAdminIntegrationChecks(supabaseReady: boolean) {
  const moySkladToken = String(process.env.MOYSKLAD_TOKEN || "").trim();
  const telegramToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const telegramChatId = String(process.env.TELEGRAM_RECEIPT_CHAT_ID || "").trim();
  const whatsappEnabled = String(process.env.WHATSAPP_AI_AUTOREPLY_ENABLED || "").toLowerCase() === "true";

  return Promise.all([
    timedCheck({
      key: "supabase",
      title: "Supabase",
      configured: supabaseReady,
      status: supabaseReady ? "healthy" : "not_configured",
      message: supabaseReady ? "Подключение настроено" : "Переменные Supabase отсутствуют",
    }),
    timedCheck({
      key: "moysklad",
      title: "МойСклад",
      configured: Boolean(moySkladToken),
      status: moySkladToken ? "warning" : "not_configured",
      message: moySkladToken ? "Ожидает проверки" : "MOYSKLAD_TOKEN отсутствует",
    }, moySkladToken ? async () => {
      const response = await moySkladRateLimitedFetch("https://api.moysklad.ru/api/remap/1.2/context/companysettings", {
        headers: {
          Authorization: `Bearer ${moySkladToken}`,
          Accept: "application/json;charset=utf-8",
        },
      });
      return { ok: response.ok, message: response.ok ? "API МойСклад доступен" : `МойСклад вернул ${response.status}` };
    } : undefined),
    timedCheck({
      key: "telegram",
      title: "Telegram",
      configured: Boolean(telegramToken && telegramChatId),
      status: telegramToken && telegramChatId ? "warning" : "not_configured",
      message: telegramToken && telegramChatId ? "Ожидает проверки" : "Токен бота или ID чата отсутствует",
    }, telegramToken && telegramChatId ? async () => {
      const response = await checkedFetch(`https://api.telegram.org/bot${telegramToken}/getMe`, { Accept: "application/json" });
      const payload = await response.json().catch(() => null) as { ok?: boolean } | null;
      const ok = response.ok && payload?.ok === true;
      return { ok, message: ok ? "Бот Telegram доступен, чат настроен" : "Telegram не подтвердил токен бота" };
    } : undefined),
    timedCheck({
      key: "whatsapp",
      title: "WhatsApp",
      configured: whatsappEnabled,
      status: whatsappEnabled ? "warning" : "not_configured",
      message: whatsappEnabled ? "Автоответ включён; состояние сессии проверяется в CRM" : "Автоответ WhatsApp выключен",
    }),
  ]);
}
