import { NextRequest, NextResponse } from "next/server";
import {
  getWahaBackendApiKey,
  getWahaBackendUrl,
  getWahaSessionName,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionPayload = {
  baseUrl?: string;
  apiKey?: string;
  session?: string;
};

function resolveConfig(input: SessionPayload = {}) {
  const envBaseUrl = getWahaBackendUrl();
  const envApiKey = getWahaBackendApiKey();
  const rawBaseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  const rawApiKey = String(input.apiKey || "").trim();
  const rawSession = String(input.session || "").trim();

  const baseUrl =
    !rawBaseUrl || rawBaseUrl === "http://127.0.0.1:3300" || rawBaseUrl === "http://localhost:3300"
      ? envBaseUrl
      : rawBaseUrl;
  const apiKey = !rawApiKey || rawApiKey === "change-me" ? envApiKey : rawApiKey;

  return {
    baseUrl,
    apiKey,
    session: rawSession || getWahaSessionName() || "default",
  };
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

function extractErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.error ?? record.message ?? record.detail;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function callWaha(path: string, init: RequestInit, config: ReturnType<typeof resolveConfig>) {
  if (!config.baseUrl) {
    return NextResponse.json({ error: "Не задан WAHA backend URL." }, { status: 400 });
  }
  if (!config.apiKey) {
    return NextResponse.json({ error: "Не задан WAHA API key." }, { status: 400 });
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    const payload = await readJson(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          error: extractErrorMessage(payload, `WAHA вернул ошибку ${response.status}.`),
          details: payload,
          status: response.status,
          baseUrl: config.baseUrl,
          session: config.session,
        },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось подключиться к WAHA.",
        baseUrl: config.baseUrl,
        session: config.session,
      },
      { status: 502 },
    );
  }
}

async function callWahaQr(path: string, config: ReturnType<typeof resolveConfig>) {
  if (!config.baseUrl) {
    return NextResponse.json({ error: "Не задан WAHA backend URL." }, { status: 400 });
  }
  if (!config.apiKey) {
    return NextResponse.json({ error: "Не задан WAHA API key." }, { status: 400 });
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: "GET",
      headers: {
        "x-api-key": config.apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await readJson(response);
      return NextResponse.json(
        {
          error: extractErrorMessage(payload, `WAHA не отдал QR (${response.status}).`),
          details: payload,
          status: response.status,
          baseUrl: config.baseUrl,
          session: config.session,
        },
        { status: response.status },
      );
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось загрузить QR из WAHA.",
        baseUrl: config.baseUrl,
        session: config.session,
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  const config = resolveConfig({
    baseUrl: request.nextUrl.searchParams.get("baseUrl") || undefined,
    apiKey: request.nextUrl.searchParams.get("apiKey") || undefined,
    session: request.nextUrl.searchParams.get("session") || undefined,
  });
  if (request.nextUrl.searchParams.get("format") === "qr") {
    return callWahaQr(`/api/${encodeURIComponent(config.session)}/auth/qr`, config);
  }
  return callWaha(`/api/sessions/${encodeURIComponent(config.session)}`, { method: "GET" }, config);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as SessionPayload & { action?: string };
  const config = resolveConfig(body);
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "start") {
    return callWaha(`/api/sessions/${encodeURIComponent(config.session)}/start`, { method: "POST" }, config);
  }

  if (action === "stop") {
    return callWaha(`/api/sessions/${encodeURIComponent(config.session)}/stop`, { method: "POST" }, config);
  }

  if (action === "reconnect") {
    await callWaha(`/api/sessions/${encodeURIComponent(config.session)}/stop`, { method: "POST" }, config);
    return callWaha(`/api/sessions/${encodeURIComponent(config.session)}/start`, { method: "POST" }, config);
  }

  return NextResponse.json({ error: "Неизвестное действие WAHA session." }, { status: 400 });
}
