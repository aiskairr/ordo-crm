import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  buildWhatsappProductSearchQuery,
  extractActualChatId,
  findMoySkladProductsForWhatsapp,
  generateGeminiWhatsappReply,
  getWahaBackendApiKey,
  getWahaBackendUrl,
  getWahaSessionName,
  isWhatsappAiAutoreplyEnabled,
  parseIncomingWhatsappWebhook,
  readWhatsappStore,
  sendWahaTextFromServer,
  upsertConversation,
  writeWhatsappStore,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const debugDir = path.join(process.cwd(), ".ordo-data");
const debugFile = path.join(debugDir, "whatsapp-last-webhook.json");

async function writeWebhookDebug(payload: unknown) {
  await mkdir(debugDir, { recursive: true });
  await writeFile(debugFile, JSON.stringify(payload, null, 2), "utf8");
}

async function readWebhookDebug() {
  try {
    const raw = await readFile(debugFile, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectSkipReason(payload: unknown) {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message =
    root.message && typeof root.message === "object"
      ? (root.message as Record<string, unknown>)
      : root.payload && typeof root.payload === "object"
        ? (root.payload as Record<string, unknown>)
        : root.data && typeof root.data === "object"
          ? (root.data as Record<string, unknown>)
          : root.body && typeof root.body === "object"
            ? (root.body as Record<string, unknown>)
            : {};
  const text =
    typeof message.text === "string"
      ? message.text
      : typeof message.body === "string"
        ? message.body
      : message.body && typeof message.body === "object" && typeof (message.body as Record<string, unknown>).text === "string"
        ? String((message.body as Record<string, unknown>).text)
        : typeof root.text === "string"
          ? root.text
          : typeof root.body === "string"
            ? root.body
            : "";
  const chatId = String(message.chatId || message.from || message.author || root.chatId || root.from || "").trim();
  const fromMeValue = message.fromMe ?? root.fromMe ?? root.outbound;
  const fromMe = fromMeValue === true || fromMeValue === "true";

  if (fromMe) return "ignored_from_me";
  if (!chatId) return "missing_chat_id";
  if (!text.trim()) return "missing_text";
  return "unrecognized_payload";
}

export async function GET() {
  const debug = await readWebhookDebug();
  return NextResponse.json({
    ok: true,
    debug,
    hint: {
      browserNetwork: "В Chrome ты обычно видишь только /api/whatsapp/inbox. Сам webhook /api/whatsapp/webhook приходит server-to-server от WAHA и часто не виден во вкладке Network браузера.",
      expectedWebhookMethod: "POST",
      expectedWebhookUrl: "/api/whatsapp/webhook",
    },
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({}));
  const incoming = parseIncomingWhatsappWebhook(payload);

  await writeWebhookDebug({
    receivedAt: new Date().toISOString(),
    raw: payload,
    parsed: incoming,
    skipped: !incoming,
    skipReason: incoming ? "" : detectSkipReason(payload),
  });

  if (!incoming) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const store = await readWhatsappStore();
  const existingConversation = store.conversations.find((item) => item.chatId === incoming.chatId);
  const alreadyStored = Boolean(
    existingConversation?.messages.some(
      (message) =>
        message.id === incoming.id ||
        (message.direction === "incoming" &&
          message.createdAt === incoming.createdAt &&
          message.text === incoming.text),
    ),
  );
  const conversation = upsertConversation(store, {
    chatId: incoming.chatId,
    phone: incoming.phone,
    customerName: incoming.customerName || incoming.phone,
    message: {
      id: incoming.id || randomUUID(),
      direction: "incoming",
      text: incoming.text,
      createdAt: incoming.createdAt,
      status: "received",
      author: "customer",
    },
    unreadDelta: 1,
  });

  if (conversation && !alreadyStored && isWhatsappAiAutoreplyEnabled()) {
    try {
      const searchQuery = buildWhatsappProductSearchQuery({
        latestMessage: incoming.text,
        messages: conversation.messages || [],
      });
      const products = await findMoySkladProductsForWhatsapp(searchQuery);
      const reply = await generateGeminiWhatsappReply({
        customerName: conversation.customerName || incoming.customerName || incoming.phone,
        customerTypeLabel: conversation.customerTypeLabel || "",
        messages: conversation.messages || [],
        latestMessage: incoming.text,
        products,
      });

      if (reply.trim()) {
        const sendPayload = await sendWahaTextFromServer({
          baseUrl: getWahaBackendUrl(),
          apiKey: getWahaBackendApiKey(),
          session: getWahaSessionName(),
          phone: incoming.phone,
          chatId: incoming.chatId,
          text: reply,
        });

        upsertConversation(store, {
          chatId: extractActualChatId(sendPayload, incoming.chatId) || incoming.chatId,
          phone: incoming.phone,
          customerName: conversation.customerName || incoming.customerName || incoming.phone,
          customerTypeLabel: conversation.customerTypeLabel || "",
          draft: "",
          draftUpdatedAt: "",
          message: {
            id: randomUUID(),
            direction: "outgoing",
            text: reply,
            createdAt: new Date().toISOString(),
            status: "sent",
            author: "ai",
          },
          unreadDelta: -999,
        });
      }
    } catch (error) {
      console.error("[whatsapp-ai webhook] auto reply failed:", error instanceof Error ? error.message : error);
      // Keep webhook resilient even when AI or WAHA is temporarily unavailable.
    }
  }

  await writeWhatsappStore(store);

  return NextResponse.json({ ok: true });
}
