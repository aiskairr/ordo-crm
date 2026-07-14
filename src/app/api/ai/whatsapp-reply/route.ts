import { NextRequest, NextResponse } from "next/server";
import {
  buildWhatsappProductSearchQuery,
  findMoySkladProductsForWhatsapp,
  generateGeminiWhatsappReply,
  getWhatsappInboxConversations,
  readWhatsappStore,
  upsertConversation,
  writeWhatsappStore,
} from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const chatId = String(body.chatId || "").trim();
  const latestMessage = String(body.message || "").trim();
  const customerName = String(body.customerName || "").trim();
  const customerTypeLabel = String(body.customerTypeLabel || "").trim();

  if (!chatId && !latestMessage) {
    return NextResponse.json({ error: "Для AI-ответа нужен входящий диалог из WAHA или текст клиента." }, { status: 400 });
  }

  const [store, inboxConversations] = await Promise.all([readWhatsappStore(), getWhatsappInboxConversations()]);
  const conversation = chatId
    ? inboxConversations.find((item) => item.chatId === chatId) || store.conversations.find((item) => item.chatId === chatId)
    : null;
  const searchQuery = buildWhatsappProductSearchQuery({
    latestMessage,
    messages: conversation?.messages || [],
  });
  const products = await findMoySkladProductsForWhatsapp(searchQuery);
  const draft = await generateGeminiWhatsappReply({
    customerName: customerName || conversation?.customerName || "Клиент",
    customerTypeLabel: customerTypeLabel || conversation?.customerTypeLabel || "",
    messages: conversation?.messages || [],
    latestMessage,
    products,
  });

  if (conversation) {
    upsertConversation(store, {
      chatId: conversation.chatId,
      draft,
      draftUpdatedAt: new Date().toISOString(),
    });
    await writeWhatsappStore(store);
  }

  return NextResponse.json({ draft });
}
