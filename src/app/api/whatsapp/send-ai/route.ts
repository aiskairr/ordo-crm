import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  extractActualChatId,
  normalizeChatId,
  phoneFromChatId,
  readWhatsappStore,
  sendWahaTextFromServer,
  upsertConversation,
  writeWhatsappStore,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const chatId = normalizeChatId(body.chatId);
  const phone = String(body.phone || phoneFromChatId(chatId)).trim();
  const text = String(body.text || "").trim();
  const baseUrl = String(body.baseUrl || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const session = String(body.session || "default").trim();
  const customerName = String(body.customerName || phone).trim();
  const customerTypeLabel = String(body.customerTypeLabel || "").trim();
  const resolvedChatId = chatId || `${phone}@c.us`;

  if (!text || (!chatId && !phone)) {
    return NextResponse.json({ error: "Нужны текст и chatId или phone." }, { status: 400 });
  }

  const payload = await sendWahaTextFromServer({ baseUrl, apiKey, session, phone, chatId, text });
  const actualChatId = extractActualChatId(payload, resolvedChatId) || resolvedChatId;

  const store = await readWhatsappStore();
  upsertConversation(store, {
    chatId: actualChatId,
    phone,
    customerName,
    customerTypeLabel,
    draft: "",
    draftUpdatedAt: "",
    message: {
      id: randomUUID(),
      direction: "outgoing",
      text,
      createdAt: new Date().toISOString(),
      status: "sent",
      author: "manager",
    },
    unreadDelta: -999,
  });
  await writeWhatsappStore(store);

  return NextResponse.json({ ok: true, payload, chatId: actualChatId });
}
