import { NextResponse } from "next/server";
import {
  getWahaBackendApiKey,
  getWahaBackendUrl,
  getWahaSessionName,
  isWhatsappAiAutoreplyEnabled,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const MOYSKLAD_TOKEN = String(process.env.MOYSKLAD_TOKEN || "").trim();
const MOYSKLAD_BASE_URL = "https://api.moysklad.ru/api/remap/1.2";

type HealthBlock = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

function maskValue(value: string, visible = 4) {
  if (!value) return "";
  if (value.length <= visible * 2) return `${value.slice(0, visible)}***`;
  return `${value.slice(0, visible)}***${value.slice(-visible)}`;
}

async function checkGemini(): Promise<HealthBlock> {
  if (!GEMINI_API_KEY) {
    return { ok: false, message: "GEMINI_API_KEY не задан." };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Ответь одним словом: ok" }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 },
        }),
        cache: "no-store",
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        message: "Gemini недоступен.",
        details: {
          status: response.status,
          error: (payload as { error?: { message?: string } }).error?.message || "unknown",
        },
      };
    }

    return {
      ok: true,
      message: "Gemini отвечает.",
      details: { model: GEMINI_MODEL },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Не удалось подключиться к Gemini.",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkWaha(): Promise<HealthBlock> {
  const baseUrl = getWahaBackendUrl();
  const apiKey = getWahaBackendApiKey();
  const session = getWahaSessionName();

  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      message: "WAHA URL или API key не заданы.",
      details: { baseUrl, apiKeyPresent: Boolean(apiKey), session },
    };
  }

  try {
    const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, {
      headers: { "x-api-key": apiKey },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        message: "WAHA недоступен или не принимает API key.",
        details: {
          status: response.status,
          error: (payload as { error?: string; message?: string }).error || (payload as { message?: string }).message || "unknown",
          baseUrl,
          session,
        },
      };
    }

    const status = String((payload as { status?: string }).status || "").trim();
    return {
      ok: true,
      message: "WAHA доступен.",
      details: { baseUrl, session, status },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Не удалось подключиться к WAHA.",
      details: { baseUrl, session, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkMoySklad(): Promise<HealthBlock> {
  if (!MOYSKLAD_TOKEN) {
    return { ok: false, message: "MOYSKLAD_TOKEN не задан." };
  }

  try {
    const response = await fetch(`${MOYSKLAD_BASE_URL}/entity/product?limit=1`, {
      headers: {
        Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
        Accept: "application/json;charset=utf-8",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        message: "МойСклад недоступен для поиска товаров.",
        details: {
          status: response.status,
          error: (payload as { errors?: Array<{ error?: string }> }).errors?.[0]?.error || "unknown",
        },
      };
    }

    const payloadRows = (payload as { rows?: unknown[] }).rows;
    const rows: unknown[] = Array.isArray(payloadRows) ? payloadRows : [];
    return {
      ok: true,
      message: "Поиск товаров МойСклад доступен.",
      details: { sampleCount: rows.length },
    };
  } catch (error) {
    return {
      ok: false,
      message: "Не удалось подключиться к МойСклад.",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function GET() {
  const [gemini, waha, moysklad] = await Promise.all([checkGemini(), checkWaha(), checkMoySklad()]);

  return NextResponse.json({
    ok: gemini.ok && waha.ok && moysklad.ok && isWhatsappAiAutoreplyEnabled(),
    config: {
      autoReplyEnabled: isWhatsappAiAutoreplyEnabled(),
      geminiModel: GEMINI_MODEL,
      geminiKeyPresent: Boolean(GEMINI_API_KEY),
      geminiKeyMasked: GEMINI_API_KEY ? maskValue(GEMINI_API_KEY, 3) : "",
      wahaBaseUrl: getWahaBackendUrl(),
      wahaApiKeyPresent: Boolean(getWahaBackendApiKey()),
      wahaApiKeyMasked: getWahaBackendApiKey() ? maskValue(getWahaBackendApiKey(), 3) : "",
      wahaSession: getWahaSessionName(),
      moySkladTokenPresent: Boolean(MOYSKLAD_TOKEN),
      moySkladTokenMasked: MOYSKLAD_TOKEN ? maskValue(MOYSKLAD_TOKEN, 4) : "",
    },
    gemini,
    waha,
    moysklad,
  });
}
