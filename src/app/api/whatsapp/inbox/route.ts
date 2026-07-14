import { NextResponse } from "next/server";
import { getWhatsappInboxConversations } from "../../_lib/whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    conversations: await getWhatsappInboxConversations(),
  });
}
