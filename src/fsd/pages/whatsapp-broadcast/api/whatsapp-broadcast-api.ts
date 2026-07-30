import { apiClient } from "@/src/fsd/shared/api";

export type WhatsappCustomer = { id: string; name: string; phone: string; whatsappPhone: string; inn: string; customerTypeLabel: string };
export type WhatsappInboxMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt: string;
  status: "received" | "sent" | "error";
  author: "customer" | "manager" | "ai";
};

export type WhatsappInboxConversation = {
  chatId: string;
  phone: string;
  customerName: string;
  customerTypeLabel: string;
  lastMessageAt: string;
  unreadCount: number;
  draft: string;
  draftUpdatedAt: string;
  messages: WhatsappInboxMessage[];
};
export type WhatsappWebhookHealth = {
  ok: boolean;
  error?: string;
  message?: string;
  autoReplyEnabled: boolean;
  expectedWebhookUrl: string;
  expectedEvents: string[];
  session: null | {
    name: string;
    status: string;
    me: unknown;
    engine: unknown;
    webhooks: Array<{ url?: string; events?: string[] }>;
    webhookConfigured: boolean;
    webhookEventsMatch: boolean;
  };
  lastWebhook: null | {
    receivedAt?: string;
    parsed?: unknown;
    skipped?: boolean;
    skipReason?: string;
    raw?: unknown;
  };
};
type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord => (value && typeof value === "object" ? (value as UnknownRecord) : {});
const asArray = (value: unknown, key: string) => Array.isArray(value) ? value : Array.isArray(asRecord(value)[key]) ? asRecord(value)[key] as unknown[] : [];
const asString = (value: unknown) => typeof value === "string" ? value : "";

export async function getWhatsappCustomers(params: { search: string; customerType: string }) {
  const query = new URLSearchParams({ limit: "500" });
  if (params.search) query.set("search", params.search);
  if (params.customerType) query.set("customerType", params.customerType);
  return asArray(await apiClient<unknown>(`/api/whatsapp/customers?${query.toString()}`), "customers").map((value) => {
    const row = asRecord(value);
    return { id: asString(row.id), name: asString(row.name), phone: asString(row.phone), whatsappPhone: asString(row.whatsappPhone), inn: asString(row.inn), customerTypeLabel: asString(row.customerTypeLabel) };
  }).filter((item) => item.phone || item.whatsappPhone);
}

async function waha<T>(baseUrl: string, apiKey: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(asString(asRecord(data).error || asRecord(data).message) || "WAHA API error");
  return data as T;
}

async function wahaSessionApi<T>(
  method: "GET" | "POST",
  payload: { baseUrl: string; apiKey: string; session: string; action?: "start" | "stop" | "reconnect" },
): Promise<T> {
  if (method === "GET") {
    const query = new URLSearchParams({
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      session: payload.session,
    });
    return apiClient<T>(`/api/whatsapp/session?${query.toString()}`);
  }

  return apiClient<T>("/api/whatsapp/session", {
    method: "POST",
    body: payload,
  });
}

export type WahaRecipient = { phone: string; name?: string; chatId?: string };

export type WahaBatchPayload = {
  recipients: WahaRecipient[];
  textTemplate: string;
  videoLinks: string[];
  session: string;
  dryRun: boolean;
};

export const getWahaSession = (baseUrl: string, apiKey: string, session: string) => {
  return wahaSessionApi<unknown>("GET", { baseUrl, apiKey, session });
};
export const startWahaSession = (baseUrl: string, apiKey: string, session: string) => {
  return wahaSessionApi<unknown>("POST", { baseUrl, apiKey, session, action: "start" });
};
export const stopWahaSession = (baseUrl: string, apiKey: string, session: string) => {
  return wahaSessionApi<unknown>("POST", { baseUrl, apiKey, session, action: "stop" });
};
export const reconnectWahaSession = async (baseUrl: string, apiKey: string, session: string) => {
  return wahaSessionApi<unknown>("POST", { baseUrl, apiKey, session, action: "reconnect" });
};
export const sendWahaText = (baseUrl: string, apiKey: string, payload: { phone?: string; chatId?: string; text: string; session: string }) => {
  return waha<unknown>(baseUrl, apiKey, "/api/send-text", { method: "POST", body: JSON.stringify(payload) });
};
export const sendWahaBatch = (baseUrl: string, apiKey: string, payload: WahaBatchPayload) => {
  return waha<{ ok?: boolean; job?: { id?: string; total?: number; dryRun?: boolean }; jobId?: string; total?: number }>(baseUrl, apiKey, "/api/send-batch", { method: "POST", body: JSON.stringify(payload) });
};

export const getWhatsappInbox = async () => {
  const payload = await apiClient<{ conversations?: unknown[] }>("/api/whatsapp/inbox");
  return asArray(payload, "conversations").map((value) => {
    const row = asRecord(value);
    return {
      chatId: asString(row.chatId),
      phone: asString(row.phone),
      customerName: asString(row.customerName),
      customerTypeLabel: asString(row.customerTypeLabel),
      lastMessageAt: asString(row.lastMessageAt),
      unreadCount: Number(row.unreadCount || 0) || 0,
      draft: asString(row.draft),
      draftUpdatedAt: asString(row.draftUpdatedAt),
      messages: asArray(row.messages, "messages").map((messageValue) => {
        const message = asRecord(messageValue);
        return {
          id: asString(message.id),
          direction: (message.direction === "outgoing" ? "outgoing" : "incoming") as "incoming" | "outgoing",
          text: asString(message.text),
          createdAt: asString(message.createdAt),
          status: (message.status === "sent" ? "sent" : message.status === "error" ? "error" : "received") as "received" | "sent" | "error",
          author: (message.author === "manager" ? "manager" : message.author === "ai" ? "ai" : "customer") as "customer" | "manager" | "ai",
        };
      }),
    } satisfies WhatsappInboxConversation;
  });
};

export const generateWhatsappAiReply = (payload: {
  chatId?: string;
  message?: string;
  customerName?: string;
  customerTypeLabel?: string;
}) => apiClient<{ draft: string }>("/api/ai/whatsapp-reply", { method: "POST", body: payload });

export const sendWhatsappAiReply = (payload: {
  baseUrl: string;
  apiKey: string;
  session: string;
  chatId?: string;
  phone?: string;
  text: string;
  customerName?: string;
  customerTypeLabel?: string;
}) => apiClient<{ ok: boolean; chatId: string }>("/api/whatsapp/send-ai", { method: "POST", body: payload });

export const getWhatsappWebhookHealth = () => apiClient<WhatsappWebhookHealth>("/api/whatsapp/webhook-health");
export const registerWhatsappWebhook = () => apiClient<WhatsappWebhookHealth>("/api/whatsapp/webhook-health", { method: "POST" });
