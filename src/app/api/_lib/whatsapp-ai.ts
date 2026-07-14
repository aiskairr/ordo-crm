import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredWhatsappMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  text: string;
  createdAt: string;
  status: "received" | "sent" | "error";
  author: "customer" | "manager" | "ai";
};

export type StoredWhatsappConversation = {
  chatId: string;
  phone: string;
  customerName: string;
  customerTypeLabel: string;
  lastMessageAt: string;
  unreadCount: number;
  draft: string;
  draftUpdatedAt: string;
  messages: StoredWhatsappMessage[];
};

type StoreShape = {
  conversations: StoredWhatsappConversation[];
};

type WahaBackendMessage = {
  id?: string;
  chatId?: string;
  phone?: string;
  name?: string;
  text?: string;
  direction?: string;
  timestamp?: string;
};

type MoySkladAiProduct = {
  name: string;
  code: string;
  article: string;
  barcode: string;
  price: number;
  categoryName: string;
  categoryPath: string;
};

const WHATSAPP_PRODUCT_STOP_WORDS = new Set([
  "это",
  "есть",
  "имеется",
  "наличии",
  "наличие",
  "сколько",
  "цена",
  "почем",
  "можно",
  "нужно",
  "нужен",
  "нужна",
  "нужны",
  "посоветуйте",
  "подскажите",
  "покажи",
  "покажите",
  "хочу",
  "ищу",
  "мне",
  "для",
  "или",
  "а",
  "и",
  "но",
  "да",
  "нет",
  "привет",
  "здравствуйте",
  "добрый",
  "день",
  "вечер",
  "утро",
  "ага",
  "ок",
  "okay",
  "окей",
  "что",
  "чо",
  "вот",
  "этот",
  "эта",
  "эти",
]);

const dataDir = process.env.ORDO_DATA_DIR || path.join(process.cwd(), ".ordo-data");
const dataFile = path.join(dataDir, "whatsapp-ai.json");

function emptyStore(): StoreShape {
  return { conversations: [] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function readWhatsappStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return { ...emptyStore(), ...parsed, conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [] };
  } catch {
    const seeded = emptyStore();
    await writeWhatsappStore(seeded);
    return seeded;
  }
}

export async function writeWhatsappStore(store: StoreShape) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(store, null, 2));
}

export function sortConversations(conversations: StoredWhatsappConversation[]) {
  return [...conversations].sort((left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime());
}

export function normalizeChatId(input: unknown) {
  const chatId = asString(input).trim();
  if (chatId) return chatId;
  const phone = digits(input);
  return phone ? `${phone}@c.us` : "";
}

export function phoneFromChatId(chatId: string) {
  return digits(chatId.split("@")[0] || chatId);
}

export function getWahaBackendUrl() {
  return String(process.env.WAHA_BACKEND_URL || "http://127.0.0.1:3300")
    .trim()
    .replace(/\/+$/, "");
}

export function getWahaBackendApiKey() {
  return String(process.env.WAHA_BACKEND_API_KEY || "change-me").trim();
}

export function getWahaSessionName() {
  return String(process.env.WAHA_SESSION || "default").trim();
}

export function upsertConversation(
  store: StoreShape,
  input: {
    chatId: string;
    phone?: string;
    customerName?: string;
    customerTypeLabel?: string;
    draft?: string;
    draftUpdatedAt?: string;
    message?: StoredWhatsappMessage;
    unreadDelta?: number;
  },
) {
  const chatId = normalizeChatId(input.chatId);
  if (!chatId) return null;

  const existing = store.conversations.find((conversation) => conversation.chatId === chatId);
  const phone = input.phone || phoneFromChatId(chatId);
  const lastMessageAt = input.message?.createdAt || existing?.lastMessageAt || new Date().toISOString();

  if (existing) {
    if (input.phone) existing.phone = input.phone;
    if (input.customerName) existing.customerName = input.customerName;
    if (input.customerTypeLabel) existing.customerTypeLabel = input.customerTypeLabel;
    if (input.draft !== undefined) {
      existing.draft = input.draft;
      existing.draftUpdatedAt = input.draftUpdatedAt || new Date().toISOString();
    }
    if (input.message) {
      const alreadyExists = existing.messages.some(
        (message) =>
          message.id === input.message?.id ||
          (message.direction === input.message?.direction &&
            message.createdAt === input.message?.createdAt &&
            message.text === input.message?.text),
      );
      if (!alreadyExists) existing.messages.push(input.message);
    }
    existing.lastMessageAt = lastMessageAt;
    existing.unreadCount = Math.max(0, existing.unreadCount + (input.unreadDelta || 0));
    return existing;
  }

  const created: StoredWhatsappConversation = {
    chatId,
    phone,
    customerName: input.customerName || phone || "Клиент",
    customerTypeLabel: input.customerTypeLabel || "",
    lastMessageAt,
    unreadCount: Math.max(0, input.unreadDelta || 0),
    draft: input.draft || "",
    draftUpdatedAt: input.draft ? input.draftUpdatedAt || new Date().toISOString() : "",
    messages: input.message ? [input.message] : [],
  };
  store.conversations.push(created);
  return created;
}

export function parseIncomingWhatsappWebhook(payload: unknown) {
  const root = asRecord(payload);
  const event = asString(root.event || root.eventName || root.type || root.trigger);
  const message = asRecord(root.message || root.payload || root.data || root.body);
  const text =
    asString(message.text) ||
    asString(message.body) ||
    asString(asRecord(message.body).text) ||
    asString(root.text) ||
    asString(root.body) ||
    asString(asRecord(root.content).text);
  const chatId =
    normalizeChatId(message.chatId || message.from || message.author || root.chatId || root.from) ||
    normalizeChatId(root.id);
  const fromMeValue = message.fromMe ?? root.fromMe ?? root.outbound;
  const fromMe = fromMeValue === true || fromMeValue === "true";
  const customerName =
    asString(message.pushName) ||
    asString(message.notifyName) ||
    asString(message.senderName) ||
    asString(root.pushName) ||
    "";
  const createdAtRaw = message.timestamp || root.timestamp || Date.now();
  const createdAt =
    typeof createdAtRaw === "number"
      ? new Date(createdAtRaw > 1e12 ? createdAtRaw : createdAtRaw * 1000).toISOString()
      : new Date(asString(createdAtRaw) || Date.now()).toISOString();

  const isMessageEvent =
    !event ||
    /message|msg|incoming|text/i.test(event) ||
    Boolean(text);

  if (!isMessageEvent || !chatId || !text || fromMe) {
    return null;
  }

  return {
    id: asString(message.id) || asString(asRecord(message.key).id) || asString(root.id) || `${chatId}:${createdAt}:${text}`,
    chatId,
    phone: phoneFromChatId(chatId),
    customerName,
    text,
    createdAt,
  };
}

function isDirectChat(chatId: string) {
  return Boolean(chatId) && (chatId.includes("@c.us") || chatId.includes("@lid"));
}

function mapBackendDirection(direction: string) {
  return direction === "out" ? "outgoing" : "incoming";
}

function mapBackendAuthor(direction: string): StoredWhatsappMessage["author"] {
  return direction === "out" ? "manager" : "customer";
}

function mergeConversationMessages(
  backendMessages: StoredWhatsappMessage[],
  localMessages: StoredWhatsappMessage[],
) {
  const merged = [...backendMessages];
  const seen = new Set(
    backendMessages.map((message) => `${message.direction}|${message.createdAt}|${message.text}`),
  );

  for (const message of localMessages) {
    const key = `${message.direction}|${message.createdAt}|${message.text}`;
    if (seen.has(key)) continue;
    merged.push(message);
    seen.add(key);
  }

  return merged.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export async function fetchWahaBackendMessages(limit = 500) {
  const url = `${getWahaBackendUrl()}/api/messages?limit=${Math.max(1, Math.min(1000, limit))}`;
  const response = await fetch(url, {
    headers: {
      "x-api-key": getWahaBackendApiKey(),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asString(asRecord(payload).error || asRecord(payload).message) || "WAHA backend недоступен.";
    throw new Error(message);
  }

  return asArray<WahaBackendMessage>(asRecord(payload).messages);
}

export async function getWhatsappInboxConversations() {
  const store = await readWhatsappStore();
  const localByChatId = new Map(store.conversations.map((conversation) => [conversation.chatId, conversation]));

  let backendMessages: WahaBackendMessage[] = [];
  try {
    backendMessages = await fetchWahaBackendMessages();
  } catch {
    return sortConversations(store.conversations);
  }

  const conversationsByChatId = new Map<string, StoredWhatsappConversation>();

  for (const rawMessage of backendMessages) {
    const chatId = normalizeChatId(rawMessage.chatId);
    if (!isDirectChat(chatId)) continue;

    const phone = String(rawMessage.phone || phoneFromChatId(chatId)).trim();
    const text = asString(rawMessage.text).trim();
    if (!text) continue;

    const direction = String(rawMessage.direction || "in").trim().toLowerCase();
    const createdAt = asString(rawMessage.timestamp) || new Date().toISOString();
    const existing = conversationsByChatId.get(chatId);
    const message: StoredWhatsappMessage = {
      id: asString(rawMessage.id) || `${chatId}:${createdAt}:${Math.random().toString(36).slice(2)}`,
      direction: mapBackendDirection(direction),
      text,
      createdAt,
      status: direction === "out" ? "sent" : "received",
      author: mapBackendAuthor(direction),
    };

    if (existing) {
      existing.messages.push(message);
      existing.lastMessageAt = createdAt;
      if (!existing.customerName && rawMessage.name) existing.customerName = String(rawMessage.name).trim();
      continue;
    }

    const local = localByChatId.get(chatId);
    conversationsByChatId.set(chatId, {
      chatId,
      phone,
      customerName: String(rawMessage.name || local?.customerName || phone || "Клиент").trim(),
      customerTypeLabel: local?.customerTypeLabel || "",
      lastMessageAt: createdAt,
      unreadCount: local?.unreadCount || 0,
      draft: local?.draft || "",
      draftUpdatedAt: local?.draftUpdatedAt || "",
      messages: [message],
    });
  }

  for (const conversation of conversationsByChatId.values()) {
    const local = localByChatId.get(conversation.chatId);
    if (!local) continue;
    conversation.messages = mergeConversationMessages(conversation.messages, local.messages || []);
    conversation.lastMessageAt =
      conversation.messages.at(-1)?.createdAt || local.lastMessageAt || conversation.lastMessageAt;
    if (!conversation.customerTypeLabel) conversation.customerTypeLabel = local.customerTypeLabel || "";
    if (!conversation.customerName) conversation.customerName = local.customerName || conversation.phone || "Клиент";
  }

  for (const local of store.conversations) {
    if (conversationsByChatId.has(local.chatId)) continue;
    if (!isDirectChat(local.chatId)) continue;
    conversationsByChatId.set(local.chatId, {
      ...local,
      messages: [...local.messages].sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      ),
    });
  }

  return sortConversations([...conversationsByChatId.values()]);
}

export async function generateGeminiWhatsappReply(input: {
  customerName: string;
  customerTypeLabel?: string;
  messages: StoredWhatsappMessage[];
  latestMessage?: string;
  products?: MoySkladAiProduct[];
}) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const model = String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  if (!apiKey) {
    throw new Error("Не задан GEMINI_API_KEY.");
  }

  const history = input.messages.slice(-4).map((message) => ({
    role: message.direction === "incoming" ? "Клиент" : "Менеджер",
    text: message.text,
  }));
  const latestMessage = input.latestMessage || history.at(-1)?.text || "";
  const productContext = (input.products ?? [])
    .slice(0, 6)
    .map((product, index) =>
      `${index + 1}. ${product.name}${product.categoryName ? ` | категория: ${product.categoryName}` : ""}${product.code ? ` | код: ${product.code}` : ""}${product.article ? ` | артикул: ${product.article}` : ""}${product.barcode ? ` | штрихкод: ${product.barcode}` : ""}${Number.isFinite(product.price) && product.price > 0 ? ` | цена: ${product.price.toLocaleString("ru-RU")} сом` : ""}`,
    )
    .join("\n");

  const prompt = [
    "Ты продавец-консультант магазина техники в WhatsApp.",
    "Отвечай только на русском.",
    "Пиши очень коротко, по делу, без лишних вступлений.",
    "Твоя цель: быстро понять, что нужно клиенту, и довести его до выбора товара.",
    "Если информации мало, задай только 1 короткий уточняющий вопрос.",
    "Если информации достаточно и есть товары, предложи 1-3 самых подходящих варианта.",
    "Если в найденных товарах есть разные категории, не своди ответ к одной категории без причины.",
    "Если товаров нет, честно скажи это и коротко уточни запрос.",
    "Опирайся только на товары из МойСклад и на историю ниже.",
    "Не выдумывай наличие, цену, скидки, доставку, рассрочку или характеристики.",
    "Ответ максимум 2 короткие фразы или 1 короткий список.",
    "Без пояснений для менеджера. Верни только текст для клиента.",
    `Имя клиента: ${input.customerName || "Клиент"}.`,
    input.customerTypeLabel ? `Тип клиента: ${input.customerTypeLabel}.` : "",
    productContext ? `Товары:\n${productContext}` : "Товары не найдены.",
    history.length ? `История:\n${history.map((message) => `${message.role}: ${message.text}`).join("\n")}` : "",
    `Последнее сообщение клиента: ${latestMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 120,
      },
    }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asString(asRecord(payload.error).message) || "Gemini не ответил.";
    throw new Error(message);
  }

  const candidates = Array.isArray(asRecord(payload).candidates) ? (asRecord(payload).candidates as unknown[]) : [];
  const first = asRecord(candidates[0]);
  const content = asRecord(first.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts.map((part) => asString(asRecord(part).text)).join("\n").trim();
  if (!text) throw new Error("Gemini вернул пустой ответ.");
  return text;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getMoySkladBaseUrl() {
  return "https://api.moysklad.ru/api/remap/1.2";
}

function getMoySkladToken() {
  return String(process.env.MOYSKLAD_TOKEN || "").trim();
}

function getMoySkladProductSearchQueries(search: string) {
  const query = String(search || "").trim();
  const queries = [query];
  if (/^\d+$/.test(query)) queries.push(`B${query}`, `b${query}`);
  return [...new Set(queries.filter(Boolean))];
}

function getProductBarcode(row: Record<string, unknown>) {
  const barcodes = Array.isArray(row.barcodes) ? row.barcodes.map(asRecord) : [];
  const barcode = barcodes[0] || {};
  return asString(barcode.ean13 ?? barcode.ean8 ?? barcode.code128 ?? barcode.gtin);
}

function getProductSalePrice(row: Record<string, unknown>, preferredName = process.env.MOYSKLAD_PRODUCT_PRICE_NAME || "3-6") {
  const salePrices = Array.isArray(row.salePrices) ? row.salePrices.map(asRecord) : [];
  const preferred = preferredName.trim().toLowerCase();
  const selected =
    salePrices.find((price) => asString(asRecord(price.priceType).name).toLowerCase() === preferred) ||
    salePrices.find((price) => asString(asRecord(price.priceType).name).toLowerCase().includes(preferred)) ||
    salePrices[0];
  return asNumber(selected?.value) / 100;
}

function getProductCategoryName(row: Record<string, unknown>) {
  return asString(asRecord(row.productFolder).name);
}

function getProductCategoryPath(row: Record<string, unknown>) {
  return asString(asRecord(row.productFolder).pathName);
}

function scoreWhatsappProductMatch(product: MoySkladAiProduct, query: string) {
  const haystack = `${product.name} ${product.code} ${product.article} ${product.barcode} ${product.categoryName} ${product.categoryPath}`.toLocaleLowerCase("ru-RU");
  const terms = query.toLocaleLowerCase("ru-RU").split(/\s+/).filter((term) => term.length > 1);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function diversifyWhatsappProducts(products: MoySkladAiProduct[], limit = 6) {
  const result: MoySkladAiProduct[] = [];
  const usedKeys = new Set<string>();
  const usedCategories = new Set<string>();

  for (const product of products) {
    const categoryKey = cleanupWhatsappSearchText(product.categoryPath || product.categoryName || "");
    const productKey = `${product.name}|${product.code}|${product.article}|${product.barcode}`;
    if (usedKeys.has(productKey)) continue;
    if (categoryKey && usedCategories.has(categoryKey)) continue;
    result.push(product);
    usedKeys.add(productKey);
    if (categoryKey) usedCategories.add(categoryKey);
    if (result.length >= limit) return result;
  }

  for (const product of products) {
    const productKey = `${product.name}|${product.code}|${product.article}|${product.barcode}`;
    if (usedKeys.has(productKey)) continue;
    result.push(product);
    usedKeys.add(productKey);
    if (result.length >= limit) return result;
  }

  return result;
}

function cleanupWhatsappSearchText(value: string) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchTerms(value: string) {
  return cleanupWhatsappSearchText(value)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !WHATSAPP_PRODUCT_STOP_WORDS.has(term));
}

export function buildWhatsappProductSearchQuery(input: {
  latestMessage?: string;
  messages?: StoredWhatsappMessage[];
}) {
  const candidates = [
    String(input.latestMessage || "").trim(),
    ...((input.messages || [])
      .filter((message) => message.direction === "incoming")
      .slice(-4)
      .reverse()
      .map((message) => message.text)),
  ];

  for (const candidate of candidates) {
    const terms = extractSearchTerms(candidate);
    if (terms.length >= 2) return terms.slice(0, 6).join(" ");
    if (terms.length === 1 && terms[0].length >= 3) return terms[0];
  }

  return String(input.latestMessage || "").trim();
}

export async function findMoySkladProductsForWhatsapp(query: string) {
  const token = getMoySkladToken();
  const trimmed = String(query || "").trim();
  if (!token || trimmed.length < 2) return [];

  const searchTerms = extractSearchTerms(trimmed);
  const normalizedQuery = searchTerms.length ? searchTerms.slice(0, 6).join(" ") : trimmed;
  const relaxedQuery = searchTerms.length > 1 ? searchTerms.slice(0, 2).join(" ") : normalizedQuery;
  const queryVariants = [...new Set([normalizedQuery, relaxedQuery, trimmed].filter((value) => value.trim().length >= 2))];

  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const variant of queryVariants) {
    for (const search of getMoySkladProductSearchQueries(variant).slice(0, 3)) {
      const url = new URL(`${getMoySkladBaseUrl()}/entity/product`);
      url.searchParams.set("limit", "40");
      url.searchParams.set("search", search);
      url.searchParams.set("expand", "productFolder");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json;charset=utf-8",
        },
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok) continue;
      const payload = await response.json().catch(() => ({}));
      const pageRows = Array.isArray(asRecord(payload).rows) ? (asRecord(payload).rows as unknown[]) : [];
      for (const value of pageRows) {
        const row = asRecord(value);
        const href = asString(asRecord(row.meta).href);
        if (!href || seen.has(href) || row.archived === true) continue;
        seen.add(href);
        rows.push(row);
      }
    }
  }

  const sortedProducts = rows
    .map((row) => ({
      name: asString(row.name),
      code: asString(row.code),
      article: asString(row.article),
      barcode: getProductBarcode(row),
      price: getProductSalePrice(row),
      categoryName: getProductCategoryName(row),
      categoryPath: getProductCategoryPath(row),
    }))
    .sort((left, right) => scoreWhatsappProductMatch(right, normalizedQuery) - scoreWhatsappProductMatch(left, normalizedQuery))
    .slice(0, 20);

  return diversifyWhatsappProducts(sortedProducts, 6);
}

export function isWhatsappAiAutoreplyEnabled() {
  const configured = String(process.env.WHATSAPP_AI_AUTOREPLY_ENABLED || "true").toLowerCase();
  return !["0", "false", "off", "no"].includes(configured);
}

export async function sendWahaTextFromServer(input: {
  baseUrl: string;
  apiKey: string;
  session: string;
  phone?: string;
  chatId?: string;
  text: string;
}) {
  const baseUrl = String(input.baseUrl || getWahaBackendUrl()).trim().replace(/\/+$/, "");
  const apiKey = String(input.apiKey || getWahaBackendApiKey()).trim();
  const session = String(input.session || getWahaSessionName()).trim();
  if (!baseUrl || !apiKey) {
    throw new Error("Заполните WAHA URL и API key.");
  }

  const response = await fetch(`${baseUrl}/api/sendText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      phone: input.phone,
      chatId: input.chatId,
      text: input.text,
      session,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = asString(asRecord(payload).error || asRecord(payload).message) || "WAHA не отправил сообщение.";
    throw new Error(message);
  }
  return payload;
}

export function extractActualChatId(payload: unknown, fallbackChatId = "") {
  const root = asRecord(payload);
  const result = asRecord(root.result);
  const resultId = asRecord(result.id);
  const message = asRecord(result.message);
  const messageId = asRecord(message.id);
  const raw = asRecord(result._data);
  const rawId = asRecord(raw.id);

  const candidates = [
    asString(resultId.remote),
    asString(messageId.remote),
    asString(rawId.remote),
    asString(result.chatId),
    asString(result.to),
    fallbackChatId,
  ];

  return normalizeChatId(candidates.find((value) => value.includes("@")) || fallbackChatId);
}
