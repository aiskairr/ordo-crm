import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  getWahaBackendApiKey,
  getWahaBackendUrl,
  getWahaSessionName,
  isWhatsappAiAutoreplyEnabled,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const debugFile = path.join(process.cwd(), ".ordo-data", "whatsapp-last-webhook.json");
const debugMessageFile = path.join(process.cwd(), ".ordo-data", "whatsapp-last-message-webhook.json");
const webhookEvents = ["*"];

function getOrigin(request: NextRequest) {
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

function getWebhookUrl(request: NextRequest) {
  const origin = getOrigin(request);
  const requestUrl = new URL(origin);
  const wahaUrl = new URL(getWahaBackendUrl());
  const isLocalRequestHost = ["localhost", "127.0.0.1"].includes(requestUrl.hostname);
  const isLocalWaha = ["localhost", "127.0.0.1"].includes(wahaUrl.hostname);

  if (isLocalRequestHost && isLocalWaha) {
    return `${requestUrl.protocol}//host.docker.internal:${requestUrl.port || "3000"}/api/whatsapp/webhook`;
  }

  return `${origin}/api/whatsapp/webhook`;
}

async function readDebugFile() {
  try {
    const raw = await readFile(debugFile, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readMessageDebugFile() {
  try {
    const raw = await readFile(debugMessageFile, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getSession(baseUrl: string, apiKey: string, session: string) {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, {
    headers: { "x-api-key": apiKey },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof (payload as { error?: unknown; message?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : typeof (payload as { message?: unknown }).message === "string"
          ? String((payload as { message: string }).message)
          : `WAHA session error ${response.status}`;
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}

async function registerWebhook(baseUrl: string, apiKey: string, session: string, url: string) {
  const putResponse = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      config: {
        webhooks: [{ url, events: webhookEvents }],
      },
    }),
    cache: "no-store",
  });
  const putPayload = await putResponse.json().catch(() => ({}));
  if (!putResponse.ok) {
    throw new Error(
      typeof (putPayload as { error?: unknown; message?: unknown }).error === "string"
        ? String((putPayload as { error: string }).error)
        : typeof (putPayload as { message?: unknown }).message === "string"
          ? String((putPayload as { message: string }).message)
          : `WAHA webhook update error ${putResponse.status}`,
    );
  }

  await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(session)}/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    cache: "no-store",
  }).catch(() => null);

  return putPayload;
}

function mapPayload(
  request: NextRequest,
  sessionPayload: Record<string, unknown> | null,
  debug: Record<string, unknown> | null,
  messageDebug: Record<string, unknown> | null,
) {
  const expectedUrl = getWebhookUrl(request);
  const rawConfig = sessionPayload?.config;
  const config =
    rawConfig && typeof rawConfig === "object"
      ? (rawConfig as Record<string, unknown>)
      : {};
  const webhooks = Array.isArray(config.webhooks) ? (config.webhooks as Array<Record<string, unknown>>) : [];
  const matchingWebhook = webhooks.find((item) => String(item.url || "").trim() === expectedUrl) || null;
  const matchingEvents = Array.isArray(matchingWebhook?.events) ? matchingWebhook?.events.map(String) : [];

  return {
    ok: true,
    autoReplyEnabled: isWhatsappAiAutoreplyEnabled(),
    expectedWebhookUrl: expectedUrl,
    expectedEvents: webhookEvents,
    session: sessionPayload
      ? {
          name: String(sessionPayload.name || ""),
          status: String(sessionPayload.status || ""),
          me: sessionPayload.me || null,
          engine: sessionPayload.engine || null,
          webhooks,
          webhookConfigured: Boolean(matchingWebhook),
          webhookEventsMatch: matchingEvents.includes("*") || webhookEvents.every((event) => matchingEvents.includes(event)),
        }
      : null,
    lastWebhook: debug,
    lastMessageWebhook: messageDebug,
  };
}

export async function GET(request: NextRequest) {
  const baseUrl = getWahaBackendUrl();
  const apiKey = getWahaBackendApiKey();
  const session = getWahaSessionName();
  const debug = await readDebugFile();
  const messageDebug = await readMessageDebugFile();

  try {
    const sessionPayload = await getSession(baseUrl, apiKey, session);
    return NextResponse.json(mapPayload(request, sessionPayload, debug, messageDebug));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось проверить webhook.",
      autoReplyEnabled: isWhatsappAiAutoreplyEnabled(),
      expectedWebhookUrl: getWebhookUrl(request),
      expectedEvents: webhookEvents,
      lastWebhook: debug,
      lastMessageWebhook: messageDebug,
    }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const baseUrl = getWahaBackendUrl();
  const apiKey = getWahaBackendApiKey();
  const session = getWahaSessionName();
  const expectedUrl = getWebhookUrl(request);

  try {
    await registerWebhook(baseUrl, apiKey, session, expectedUrl);
    const sessionPayload = await getSession(baseUrl, apiKey, session).catch(() => null);
    const debug = await readDebugFile();
    const messageDebug = await readMessageDebugFile();
    return NextResponse.json({
      ...mapPayload(request, sessionPayload, debug, messageDebug),
      message: "Webhook перерегистрирован.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Не удалось перерегистрировать webhook.",
      expectedWebhookUrl: expectedUrl,
      expectedEvents: webhookEvents,
    }, { status: 502 });
  }
}
