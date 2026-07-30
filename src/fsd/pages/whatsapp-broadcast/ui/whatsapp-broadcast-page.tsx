"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  Bot,
  CheckCheck,
  MessageCircle,
  Phone,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings,
  Star,
  Users,
  X,
} from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  getWahaSession,
  getWhatsappWebhookHealth,
  getWhatsappInbox,
  getWhatsappCustomers,
  registerWhatsappWebhook,
  reconnectWahaSession,
  sendWahaBatch,
  sendWhatsappAiReply,
  startWahaSession,
  type WahaRecipient,
  type WhatsappCustomer,
} from "../api/whatsapp-broadcast-api";
import styles from "./whatsapp-broadcast-page.module.css";

const digits = (value: string) => value.replace(/\D/g, "");
const settingsKey = "ordoWahaBackendSettings";
type StoredWahaSettings = { url?: string; apiKey?: string; session?: string };

const getStoredWahaSettings = (): StoredWahaSettings => {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey) || "{}") as StoredWahaSettings;
    const url =
      parsed.url === "http://127.0.0.1:3300" || parsed.url === "http://localhost:3300"
        ? "http://127.0.0.1:3001"
        : parsed.url;
    const apiKey = parsed.apiKey === "change-me" ? "" : parsed.apiKey;
    return { ...parsed, url, apiKey };
  } catch {
    return {};
  }
};

const recipientFromCustomer = (customer: WhatsappCustomer): WahaRecipient | null => {
  const phone = digits(customer.whatsappPhone || customer.phone);
  if (!phone) return null;
  return { phone, name: customer.name };
};

const parseManualRecipients = (value: string): WahaRecipient[] =>
  value
    .split(/\n|,|;/)
    .map((line) => {
      const phone = digits(line);
      return phone ? { phone } : null;
    })
    .filter((item): item is WahaRecipient => Boolean(item));

const initials = (name: string) => (name || "?").trim().slice(0, 1).toUpperCase();
const avatarTone = (index: number) => ["teal", "violet", "amber", "blue", "rose", "green"][index % 6];
const formatMessageTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
    : "";
export function WhatsappBroadcastPage() {
  const { showToast } = useToast();
  const chatCanvasRef = useRef<HTMLElement | null>(null);
  const storedSettings = getStoredWahaSettings();
  const [search, setSearch] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [baseUrl, setBaseUrl] = useState(storedSettings.url || "http://127.0.0.1:3001");
  const [apiKey, setApiKey] = useState(storedSettings.apiKey || "change-me");
  const [session, setSession] = useState(storedSettings.session || "default");
  const [selected, setSelected] = useState<WhatsappCustomer | null>(null);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [message, setMessage] = useState("");
  const [campaignName, setCampaignName] = useState("Рассылка клиентам");
  const [bulkPhones, setBulkPhones] = useState("");
  const [bulkMessage, setBulkMessage] = useState("Здравствуйте, {name}! ");
  const [videoLinks, setVideoLinks] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);

  useEffect(() => {
    localStorage.setItem(settingsKey, JSON.stringify({ url: baseUrl, apiKey, session }));
  }, [apiKey, baseUrl, session]);

  const customersQuery = useQuery({
    queryKey: ["whatsapp-customers", search, customerType],
    queryFn: () => getWhatsappCustomers({ search, customerType }),
  });
  const inboxQuery = useQuery({
    queryKey: ["whatsapp-inbox"],
    queryFn: getWhatsappInbox,
    refetchInterval: 5000,
  });
  const sessionQuery = useQuery({
    queryKey: ["waha-session", baseUrl, apiKey, session],
    queryFn: () => getWahaSession(baseUrl, apiKey, session),
    retry: false,
  });
  const webhookHealthQuery = useQuery({
    queryKey: ["whatsapp-webhook-health"],
    queryFn: getWhatsappWebhookHealth,
    retry: false,
  });

  const visibleRecipients = useMemo(() => {
    const byPhone = new Map<string, WahaRecipient>();
    for (const customer of customersQuery.data ?? []) {
      const recipient = recipientFromCustomer(customer);
      if (recipient) byPhone.set(recipient.phone, recipient);
    }
    return [...byPhone.values()];
  }, [customersQuery.data]);

  const bulkRecipients = useMemo(() => {
    const byPhone = new Map<string, WahaRecipient>();
    for (const recipient of parseManualRecipients(bulkPhones)) byPhone.set(recipient.phone, recipient);
    return [...byPhone.values()];
  }, [bulkPhones]);

  const startMutation = useMutation({
    mutationFn: () => startWahaSession(baseUrl, apiKey, session),
    onSuccess: () => {
      showToast({ tone: "success", title: "Сессия WAHA запущена" });
      sessionQuery.refetch();
      setQrVersion((value) => value + 1);
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось запустить WAHA", description: getErrorText(error) }),
  });

  const reconnectMutation = useMutation({
    mutationFn: () => reconnectWahaSession(baseUrl, apiKey, session),
    onSuccess: () => {
      showToast({
        tone: "success",
        title: "Сессия переподключается",
        description: "Если WhatsApp запросит повторную авторизацию, пересканируй QR.",
      });
      sessionQuery.refetch();
      inboxQuery.refetch();
      setQrVersion((value) => value + 1);
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось переподключить WAHA", description: getErrorText(error) }),
  });
  const registerWebhookMutation = useMutation({
    mutationFn: registerWhatsappWebhook,
    onSuccess: (data) => {
      showToast({
        tone: "success",
        title: "Webhook обновлен",
        description: data.message || "WAHA теперь должен слать входящие сообщения в CRM.",
      });
      webhookHealthQuery.refetch();
      sessionQuery.refetch();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось обновить webhook", description: getErrorText(error) }),
  });

  const selectedConversation = useMemo(
    () => inboxQuery.data?.find((conversation) => conversation.chatId === selectedChatId) ?? null,
    [inboxQuery.data, selectedChatId],
  );

  useEffect(() => {
    const node = chatCanvasRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [selectedConversation?.chatId, selectedConversation?.messages.length]);

  const filteredInbox = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (inboxQuery.data ?? []).filter((conversation) => {
      if (customerType) {
        const typeLabel = conversation.customerTypeLabel.toLowerCase();
        if (customerType === "legal" && !typeLabel.includes("юр")) return false;
        if (customerType === "person" && !typeLabel.includes("физ")) return false;
      }
      if (!query) return true;
      return `${conversation.customerName} ${conversation.phone} ${conversation.messages.at(-1)?.text || ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [customerType, inboxQuery.data, search]);

  const sendMutation = useMutation({
    mutationFn: () =>
      sendWhatsappAiReply({
        baseUrl,
        apiKey,
        session,
        chatId: selectedConversation?.chatId,
        phone: digits(selectedConversation?.phone || selected?.whatsappPhone || selected?.phone || manualPhone),
        text: message,
        customerName: selectedConversation?.customerName || selected?.name || manualName || manualPhone,
        customerTypeLabel: selectedConversation?.customerTypeLabel || selected?.customerTypeLabel || "",
      }),
    onSuccess: async (data) => {
      showToast({ tone: "success", title: "Сообщение отправлено" });
      setMessage("");
      setSelectedChatId(data.chatId);
      await inboxQuery.refetch();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось отправить", description: getErrorText(error) }),
  });

  const batchMutation = useMutation({
    mutationFn: () =>
      sendWahaBatch(baseUrl, apiKey, {
        recipients: bulkRecipients,
        textTemplate: bulkMessage,
        videoLinks: videoLinks.split(/\n|,|;/).map((link) => link.trim()).filter(Boolean),
        session,
        dryRun,
      }),
    onSuccess: (data) => {
      const job = data.job;
      showToast({
        tone: "success",
        title: dryRun ? "Проверка рассылки готова" : "Рассылка запущена",
        description: job?.id || data.jobId || `${job?.total || data.total || bulkRecipients.length} номеров`,
      });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось запустить рассылку", description: getErrorText(error) }),
  });

  const selectedPhone = selectedConversation?.phone || selected?.phone || selected?.whatsappPhone || manualPhone;
  const selectedName = selectedConversation?.customerName || selected?.name || manualName || "Чат не выбран";
  const sessionRecord = (sessionQuery.data && typeof sessionQuery.data === "object") ? (sessionQuery.data as { status?: string }) : null;
  const sessionState = String(sessionRecord?.status || "").trim().toUpperCase();
  const sessionStatus = sessionQuery.isError
    ? "Не подключен"
    : sessionQuery.isLoading
      ? "Проверяю..."
      : sessionState
        ? `WAHA: ${sessionState}`
        : "WAHA доступен";
  const qrUrl = useMemo(() => {
    const query = new URLSearchParams({
      baseUrl,
      session,
      format: "qr",
      v: String(qrVersion),
    });
    return `/api/whatsapp/session?${query.toString()}`;
  }, [baseUrl, qrVersion, session]);
  const lastWebhookAt = webhookHealthQuery.data?.lastWebhook?.receivedAt
    ? formatMessageTime(String(webhookHealthQuery.data.lastWebhook.receivedAt))
    : "";
  const hasSelectedChat = Boolean(selectedConversation || selected || manualPhone);
  const previewRecipients = visibleRecipients.slice(0, 120);
  return (
    <>
      <section className={styles.whatsapp}>
        <aside className={styles.rail}>
          <button className={styles.railActive} type="button" aria-label="Чаты">
            <MessageCircle size={24} />
            <b>{filteredInbox.length}</b>
          </button>
          <button type="button" aria-label="Звонки">
            <Phone size={22} />
          </button>
          <button type="button" aria-label="Контакты">
            <Users size={22} />
          </button>
          <i />
          <button type="button" aria-label="Архив">
            <Archive size={22} />
          </button>
          <button type="button" aria-label="Избранное">
            <Star size={22} />
          </button>
          <span />
          <button type="button" aria-label="WAHA">
            <Bot size={22} />
          </button>
          <button type="button" aria-label="Настройки рассылки" onClick={() => setSettingsOpen(true)}>
            <Settings size={22} />
          </button>
        </aside>

        <aside className={`${styles.chatList} ${hasSelectedChat ? styles.chatListMobileHidden : ""}`}>
          <header>
            <div>
              <h1>Чаты</h1>
              <p>{filteredInbox.length ? `${filteredInbox.length} диалогов` : sessionStatus}</p>
            </div>
            <div className={styles.listActions}>
              <button onClick={() => inboxQuery.refetch()} type="button" aria-label="Обновить">
                <RefreshCw size={18} />
              </button>
              <button onClick={() => setSettingsOpen(true)} type="button" aria-label="Настройки">
                <Settings size={18} />
              </button>
            </div>
          </header>

          <div className={styles.search}>
            <Search size={18} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по клиенту" />
          </div>

          <select className={styles.typeFilter} value={customerType} onChange={(event) => setCustomerType(event.target.value)}>
            <option value="">Все клиенты</option>
            <option value="legal">Юрлица</option>
            <option value="person">Физлица</option>
          </select>

          <div className={styles.contacts}>
            {filteredInbox.map((conversation, index) => (
              <button
                key={`${conversation.chatId}:${index}`}
                className={selectedConversation?.chatId === conversation.chatId ? styles.contactActive : ""}
                onClick={() => {
                  setSelected(null);
                  setManualPhone("");
                  setManualName("");
                  setSelectedChatId(conversation.chatId);
                  if (conversation.draft) setMessage(conversation.draft);
                }}
                type="button"
              >
                <span className={`${styles.avatar} ${styles[avatarTone(index)]}`}>{initials(conversation.customerName)}</span>
                <span className={styles.contactBody}>
                  <span>
                    <b>{conversation.customerName}</b>
                    <time>{formatMessageTime(conversation.lastMessageAt)}</time>
                  </span>
                  <small>
                    <CheckCheck size={15} /> {conversation.messages.at(-1)?.text || conversation.phone}
                  </small>
                </span>
                {conversation.unreadCount > 0 ? <em>{conversation.unreadCount}</em> : null}
              </button>
            ))}
            {!filteredInbox.length ? (
              <p className={styles.emptyList}>{inboxQuery.isLoading ? "Загрузка..." : "Входящих диалогов пока нет. Подключи WAHA webhook."}</p>
            ) : null}
          </div>
        </aside>

        <main className={`${styles.chat} ${hasSelectedChat ? styles.chatMobileVisible : ""}`}>
          <header className={styles.chatHeader}>
            <button className={styles.backButton} type="button" onClick={() => { setSelected(null); setManualPhone(""); setManualName(""); setSelectedChatId(""); }} aria-label="Назад к чатам">
              <ArrowLeft size={18} />
            </button>
            <div className={`${styles.avatar} ${styles.teal}`}>{initials(selectedName)}</div>
            <div className={styles.chatMeta}>
              <h2>{selectedName}</h2>
              <p>{selectedPhone || "Номер не выбран"}</p>
            </div>
            <button className={styles.headerAction} onClick={() => setSettingsOpen(true)} type="button">
              <Settings size={18} />
            </button>
          </header>

          <section ref={chatCanvasRef} className={styles.chatCanvas}>
            {selectedConversation ? (
              selectedConversation.messages.map((entry) => (
                <article key={entry.id} className={entry.direction === "incoming" ? styles.bubbleIn : styles.bubbleOut}>
                  <p>{entry.text}</p>
                  <time>{formatMessageTime(entry.createdAt)}</time>
                </article>
              ))
            ) : selectedPhone ? (
              <>
                <article className={styles.bubbleIn}>Здравствуйте! Можно узнать актуальную информацию?</article>
                <article className={styles.bubbleOut}>Да, здесь можно быстро отправить сообщение клиенту или добавить его в рассылку.</article>
              </>
            ) : (
              <div className={styles.blank}>
                <MessageCircle size={76} />
                <h2>WhatsApp CRM</h2>
                <p>Выберите чат слева или введите номер вручную.</p>
              </div>
            )}
          </section>

          <section className={styles.composer}>
            <div className={styles.manual}>
              <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Имя" />
              <input value={manualPhone} onChange={(event) => setManualPhone(event.target.value)} placeholder="+996..." />
              <button
                onClick={() =>
                  setSelected({
                    id: `manual:${manualPhone}`,
                    name: manualName || manualPhone,
                    phone: manualPhone,
                    whatsappPhone: digits(manualPhone),
                    inn: "",
                    customerTypeLabel: "Номер",
                  })
                }
                type="button"
              >
                Выбрать
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendMutation.mutate();
              }}
            >
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Напишите сообщение клиенту" />
              <button disabled={sendMutation.isPending || !message.trim() || !(selectedConversation || selected || manualPhone)} type="submit" aria-label="Отправить">
                <Send size={19} />
              </button>
            </form>
          </section>
        </main>
      </section>

      {settingsOpen ? (
        <div className={styles.settingsBackdrop} role="presentation" onClick={() => setSettingsOpen(false)}>
          <aside className={styles.settingsPanel} role="dialog" aria-modal="true" aria-labelledby="waha-settings-title" onClick={(event) => event.stopPropagation()}>
            <header className={styles.settingsHeader}>
              <div>
                <h2 id="waha-settings-title">Настройки рассылки</h2>
                <p>{bulkRecipients.length} получателей · {sessionStatus}</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </header>

            <div className={styles.settingsContent}>
              <section className={styles.settingsBlock}>
                <label>
                  <span>Название кампании</span>
                  <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} />
                </label>
                <label>
                  <span>Получатели</span>
                  <textarea value={bulkPhones} onChange={(event) => setBulkPhones(event.target.value)} placeholder="Номера через запятую или с новой строки" />
                </label>
                <button
                  type="button"
                  className={styles.fillButton}
                  onClick={() => setBulkPhones(previewRecipients.map((item) => item.phone).join("\n"))}
                  disabled={!previewRecipients.length}
                >
                  Заполнить из списка чатов
                </button>
              </section>

              <section className={styles.settingsBlock}>
                <label>
                  <span>Текст рассылки</span>
                  <textarea value={bulkMessage} onChange={(event) => setBulkMessage(event.target.value)} placeholder="Здравствуйте, {name}! ..." />
                </label>
                <label>
                  <span>Видео-ссылки</span>
                  <textarea value={videoLinks} onChange={(event) => setVideoLinks(event.target.value)} placeholder="Ссылки с новой строки" />
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                  <span>Только проверка без отправки</span>
                </label>
                <button
                  className={styles.launchButton}
                  onClick={() => batchMutation.mutate()}
                  disabled={!bulkMessage.trim() || !bulkRecipients.length || batchMutation.isPending}
                  type="button"
                >
                  <Play size={18} /> {dryRun ? "Проверить" : "Запустить"}
                </button>
              </section>

              <section className={styles.settingsBlock}>
                <h3>WAHA backend</h3>
                <div className={styles.connection}>
                  <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="URL backend" />
                  <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="API key" />
                  <input value={session} onChange={(event) => setSession(event.target.value)} placeholder="Session" />
                  <div className={styles.connectionActions}>
                    <button onClick={() => { sessionQuery.refetch(); setQrVersion((value) => value + 1); }} type="button">
                      Проверить
                    </button>
                    <button onClick={() => startMutation.mutate()} type="button">
                      Подключить
                    </button>
                    <button onClick={() => reconnectMutation.mutate()} type="button" disabled={reconnectMutation.isPending}>
                      Переподключить
                    </button>
                  </div>
                </div>
                <div className={styles.qrCard}>
                  <div className={styles.qrHead}>
                    <div>
                      <strong>QR для сканирования</strong>
                      <p>{sessionState === "SCAN_QR_CODE" ? "Открой WhatsApp на телефоне и сканируй код." : sessionStatus}</p>
                    </div>
                    <button onClick={() => setQrVersion((value) => value + 1)} type="button">
                      <RefreshCw size={16} />
                      Обновить QR
                    </button>
                  </div>
                  {sessionState === "SCAN_QR_CODE" ? (
                    <div className={styles.qrFrame}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrUrl} alt="QR код WhatsApp" />
                    </div>
                  ) : (
                    <div className={styles.qrPlaceholder}>
                      <Bot size={34} />
                      <span>QR появится, когда сессия перейдет в режим подключения.</span>
                    </div>
                  )}
                </div>
                <div className={styles.webhookCard}>
                  <div className={styles.webhookHead}>
                    <div>
                      <strong>Webhook WAHA</strong>
                      <p>
                        {webhookHealthQuery.data?.session?.webhookConfigured
                          ? "Webhook привязан к CRM."
                          : webhookHealthQuery.isLoading
                            ? "Проверяю webhook..."
                            : "Webhook не привязан или смотрит не туда."}
                      </p>
                    </div>
                    <div className={styles.connectionActions}>
                      <button onClick={() => webhookHealthQuery.refetch()} type="button">
                        Проверить webhook
                      </button>
                      <button onClick={() => registerWebhookMutation.mutate()} type="button" disabled={registerWebhookMutation.isPending}>
                        Перерегистрировать
                      </button>
                    </div>
                  </div>
                  <div className={styles.webhookMeta}>
                    <span><b>URL:</b> {webhookHealthQuery.data?.expectedWebhookUrl || "—"}</span>
                    <span><b>События:</b> {(webhookHealthQuery.data?.expectedEvents || []).join(", ") || "—"}</span>
                    <span><b>Автоответ:</b> {webhookHealthQuery.data?.autoReplyEnabled ? "включен" : "выключен"}</span>
                    <span><b>Последний webhook:</b> {lastWebhookAt || "не было"}</span>
                    <span><b>Причина skip:</b> {String(webhookHealthQuery.data?.lastWebhook?.skipReason || "—")}</span>
                  </div>
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
