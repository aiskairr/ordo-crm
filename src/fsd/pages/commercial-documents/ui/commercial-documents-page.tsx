"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileText, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  createCommercialDemandFromOrder,
  createCommercialPdf,
  createCommercialProposalLink,
  createCommercialProposalPdf,
  getCommercialOrders,
  getCommercialRetailStores,
  getCommercialSession,
  makeCommercialItem,
  searchCommercialCustomers,
  searchCommercialProducts,
  type CommercialCustomer,
  type CommercialItem,
  type CommercialOrderRow,
  type CommercialPayload,
  type CommercialProduct,
  type CommercialPdfResult,
  type CommercialShipmentResult,
} from "../api/commercial-documents-api";
import styles from "./commercial-documents-page.module.css";

const wholesaleGroup = "оптовые клиенты";
const organizationsGroup = "организации";

type FormState = Omit<
  CommercialPayload,
  "documentType" | "storeHref" | "employeeName" | "branchName" | "items" | "customerHref" | "customerGroups" | "customerCorrAccount"
> & {
  customerHref: string;
  wholesale: boolean;
};

const initialForm: FormState = {
  description: "",
  customerMode: "new",
  customerName: "",
  customerInn: "",
  customerBank: "",
  customerBik: "",
  customerSettlementAccount: "",
  customerOkpo: "",
  customerPhone: "",
  customerEmail: "",
  customerAddress: "",
  customerHref: "",
  wholesale: false,
};

function initialItems() {
  const item = makeCommercialItem();
  return { item, items: [item] };
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("996")) return `+${digits.slice(0, 12)}`;
  if (digits.startsWith("0")) return `+996${digits.slice(1, 10)}`;
  return `+996${digits.slice(0, 9)}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function printPdf(blob: Blob, fileName: string) {
  const pdfUrl = URL.createObjectURL(blob);
  const win = window.open("", "_blank", "noopener");
  if (!win) {
    downloadBlob(blob, fileName);
    return;
  }
  win.document.write(`<!doctype html><title>${fileName}</title><iframe src="${pdfUrl}" style="width:100%;height:100%;border:0"></iframe>`);
  win.document.close();
  window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
}

export function CommercialDocumentsPage() {
  const { showToast } = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  const [storeHref, setStoreHref] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const initial = useMemo(() => initialItems(), []);
  const [activeItemId, setActiveItemId] = useState(initial.item.id);
  const [items, setItems] = useState<CommercialItem[]>(initial.items);
  const [result, setResult] = useState<CommercialPdfResult | null>(null);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [createdStoreHref, setCreatedStoreHref] = useState("");
  const [shipmentResult, setShipmentResult] = useState<CommercialShipmentResult | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CommercialOrderRow | null>(null);

  const storesQuery = useQuery({ queryKey: ["commercial-retail-stores"], queryFn: getCommercialRetailStores });
  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getCommercialSession });
  const customerQuery = useQuery({
    queryKey: ["commercial-customers", customerSearch],
    queryFn: () => searchCommercialCustomers(customerSearch),
    enabled: form.customerMode === "existing" && customerSearch.trim().length >= 2,
  });
  const productQuery = useQuery({
    queryKey: ["commercial-products", productSearch, storeHref],
    queryFn: () => searchCommercialProducts(productSearch, storeHref),
    enabled: productSearch.trim().length >= 2,
  });
  const currentCustomerHref = form.customerHref || result?.customerHref || "";
  const ordersQuery = useQuery({
    queryKey: ["commercial-orders", currentCustomerHref],
    queryFn: () => getCommercialOrders(currentCustomerHref),
    enabled: Boolean(currentCustomerHref),
  });

  useEffect(() => {
    if (storesQuery.error) showToast({ tone: "error", title: "Не удалось загрузить точки продаж", description: getErrorText(storesQuery.error) });
  }, [showToast, storesQuery.error]);

  const submitMutation = useMutation({
    mutationFn: createCommercialPdf,
    onSuccess: (data) => {
      setResult(data);
      setShipmentResult(null);
      setCreatedStoreHref(storeHref);
      setOrderModalOpen(true);
      setSelectedOrder(null);
      void ordersQuery.refetch();
      downloadBlob(data.blob, data.fileName);
      showToast({
        tone: "success",
        title: data.documentType === "customerorder" ? "PDF и заказ созданы" : "PDF-счет сформирован",
        description: data.documentName || data.fileName,
      });
      setForm(initialForm);
      const next = initialItems();
      setItems(next.items);
      setActiveItemId(next.item.id);
      setCustomerSearch("");
      setProductSearch("");
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось создать счет", description: getErrorText(error) }),
  });
  const shipmentMutation = useMutation({
    mutationFn: () => createCommercialDemandFromOrder(selectedOrder?.id || "", createdStoreHref || storeHref),
    onSuccess: (data) => {
      setShipmentResult(data);
      showToast({ tone: "success", title: "Отгрузка создана", description: data.documentName || "Документ создан в МойСклад" });
      void ordersQuery.refetch();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось создать отгрузку", description: getErrorText(error) }),
  });
  const proposalMutation = useMutation({
    mutationFn: createCommercialProposalPdf,
    onSuccess: (data) => {
      downloadBlob(data.blob, data.fileName);
      showToast({ tone: "success", title: "Коммерческое предложение готово", description: data.fileName });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось создать коммерческое предложение", description: getErrorText(error) }),
  });
  const proposalLinkMutation = useMutation({
    mutationFn: createCommercialProposalLink,
    onSuccess: async (data) => {
      const fullUrl = new URL(data.url, window.location.origin).toString();
      try {
        await navigator.clipboard.writeText(fullUrl);
      } catch {}
      window.open(fullUrl, "_blank", "noopener,noreferrer");
      showToast({
        tone: "success",
        title: "Веб-КП создано",
        description: `Ссылка действует до ${new Intl.DateTimeFormat("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(data.expiresAt))}`,
      });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось создать веб-КП", description: getErrorText(error) }),
  });

  const total = items.reduce((sum, item) => sum + Number(item.productPrice || 0) * Number(item.quantity || 0), 0);
  const activeItem = items.find((item) => item.id === activeItemId) ?? items[0];
  const stores = storesQuery.data ?? [];

  const customerGroups = useMemo(() => {
    const groups = form.customerMode === "new" ? [organizationsGroup] : [];
    if (form.wholesale) groups.push(wholesaleGroup);
    return groups;
  }, [form.customerMode, form.wholesale]);

  const patchItem = (id: string, patch: Partial<CommercialItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    const item = makeCommercialItem();
    setItems((current) => [...current, item]);
    setActiveItemId(item.id);
    setProductSearch("");
  };

  const removeItem = (id: string) => {
    if (items.length === 1) {
      const next = initialItems();
      setItems(next.items);
      setActiveItemId(next.item.id);
      return;
    }

    const next = items.filter((item) => item.id !== id);
    setItems(next);
    if (activeItemId === id) {
      setActiveItemId(next[0]?.id || "");
    }
  };

  const chooseProduct = (product: CommercialProduct) => {
    const target = activeItem ?? makeCommercialItem();
    const price = form.wholesale && product.wholesalePrice ? product.wholesalePrice : product.minPrice || product.price || 0;
    patchItem(target.id, {
      productName: product.name,
      code: product.code || "",
      assortmentHref: product.href || "",
      assortmentType: product.type || "product",
      productPrice: price,
      minPrice: product.minPrice || product.price || 0,
      wholesalePrice: product.wholesalePrice || 0,
    });
    setProductSearch("");
  };

  const chooseCustomer = (customer: CommercialCustomer) => {
    setForm({
      ...form,
      customerHref: customer.href || "",
      customerName: customer.name,
      customerInn: customer.inn || "",
      customerBank: customer.bank || "",
      customerBik: customer.bik || "",
      customerSettlementAccount: customer.settlementAccount || "",
      customerOkpo: customer.okpo || "",
      customerPhone: customer.phone || "",
      customerEmail: customer.email || "",
      customerAddress: customer.actualAddress || "",
      wholesale: Boolean(customer.groups?.includes(wholesaleGroup)),
    });
    setCustomerSearch(customer.name);
    setSelectedOrder(null);
    setShipmentResult(null);
  };

  const submit = () => {
    const payloadItems = items.filter((item) => item.assortmentHref && item.quantity > 0);
    if (!payloadItems.length) return showToast({ tone: "error", title: "Добавьте хотя бы один товар" });
    if (form.customerMode === "existing" && !form.customerHref) return showToast({ tone: "error", title: "Выберите существующего контрагента" });
    if (form.customerMode === "new" && !form.customerName.trim()) return showToast({ tone: "error", title: "Укажите название контрагента" });

    submitMutation.mutate({
      ...form,
      customerCorrAccount: "",
      documentType: "customerorder",
      storeHref,
      employeeName: sessionQuery.data?.user?.name || "",
      branchName: "",
      customerGroups,
      items: payloadItems,
    });
  };

  const printProposal = () => {
    const payloadItems = items.filter((item) => item.assortmentHref && item.quantity > 0);
    if (!payloadItems.length) return showToast({ tone: "error", title: "Добавьте хотя бы один товар для предложения" });

    proposalMutation.mutate({
      ...form,
      customerCorrAccount: "",
      documentType: "customerorder",
      storeHref,
      employeeName: sessionQuery.data?.user?.name || "",
      branchName: "",
      customerGroups,
      items: payloadItems,
    });
  };

  const createProposalLink = () => {
    const payloadItems = items.filter((item) => item.assortmentHref && item.quantity > 0);
    if (!payloadItems.length) return showToast({ tone: "error", title: "Добавьте хотя бы один товар для предложения" });

    proposalLinkMutation.mutate({
      ...form,
      customerCorrAccount: "",
      documentType: "customerorder",
      storeHref,
      employeeName: sessionQuery.data?.user?.name || "",
      branchName: "",
      customerGroups,
      items: payloadItems,
    });
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Юридические лица</p>
          <h1>Счета юрлицам</h1>
          <span>Создание PDF-счета и заказа покупателя в МойСклад для существующего или нового контрагента.</span>
        </div>
        <div className={styles.headerActions}>
          {currentCustomerHref ? <button type="button" onClick={() => setOrderModalOpen(true)}><FileText size={17} /> Заказы / отгрузки</button> : null}
          {result ? <button type="button" onClick={() => printPdf(result.blob, result.fileName)}><Printer size={17} /> Печать</button> : null}
          {result ? <button type="button" onClick={() => downloadBlob(result.blob, result.fileName)}><Download size={17} /> PDF</button> : null}
          {result?.documentWebUrl ? <a href={result.documentWebUrl} target="_blank" rel="noreferrer">МойСклад</a> : null}
        </div>
      </header>

      <section className={styles.layout}>
        <div className={styles.main}>
          <section className={styles.panel}>
            <div className={styles.sectionHead}>
              <div><p>Контрагент</p><h2>Реквизиты клиента</h2></div>
              <div className={styles.segmented}>
                <button type="button" className={form.customerMode === "new" ? styles.active : ""} onClick={() => setForm({ ...form, customerMode: "new", customerHref: "" })}>Новый</button>
                <button type="button" className={form.customerMode === "existing" ? styles.active : ""} onClick={() => setForm({ ...form, customerMode: "existing" })}>Существующий</button>
              </div>
            </div>

            {form.customerMode === "existing" ? (
              <div className={styles.searchBox}>
                <Search size={17} />
                <input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Поиск контрагента по названию, ИНН или телефону" />
                <div className={styles.results}>
                  {(customerQuery.data ?? []).map((customer) => (
                    <button key={customer.href || customer.id} type="button" onClick={() => chooseCustomer(customer)}>
                      <strong>{customer.name}</strong><span>{customer.phone || "Телефон не указан"} · {customer.inn || "ИНН не указан"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.formGrid}>
              <label><span>Название</span><input value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
              <label><span>ИНН</span><input value={form.customerInn} onChange={(event) => setForm({ ...form, customerInn: event.target.value })} /></label>
              <label><span>Телефон</span><input value={form.customerPhone} onBlur={() => setForm({ ...form, customerPhone: normalizePhone(form.customerPhone) })} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label>
              <label><span>Email</span><input value={form.customerEmail} onChange={(event) => setForm({ ...form, customerEmail: event.target.value })} /></label>
              <label><span>Банк</span><input value={form.customerBank} onChange={(event) => setForm({ ...form, customerBank: event.target.value })} /></label>
              <label><span>БИК</span><input value={form.customerBik} onChange={(event) => setForm({ ...form, customerBik: event.target.value })} /></label>
              <label><span>Расчетный счет</span><input value={form.customerSettlementAccount} onChange={(event) => setForm({ ...form, customerSettlementAccount: event.target.value })} /></label>
              <label><span>ОКПО</span><input value={form.customerOkpo} onChange={(event) => setForm({ ...form, customerOkpo: event.target.value })} /></label>
              <label><span>Группа</span><label className={styles.check}><input type="checkbox" checked={form.wholesale} onChange={(event) => setForm({ ...form, wholesale: event.target.checked })} /> Оптовый клиент</label></label>
              <label className={styles.wide}><span>Адрес</span><input value={form.customerAddress} onChange={(event) => setForm({ ...form, customerAddress: event.target.value })} /></label>
              <label className={styles.wide}><span>Описание документа</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Например: Счет на оплату техники" /></label>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHead}>
              <div><p>Товары</p><h2>Позиции счета</h2></div>
              <button type="button" onClick={addItem}><Plus size={17} /> Строка</button>
            </div>
            <div className={styles.items}>
              {items.map((item, index) => (
                <article key={item.id} className={item.id === activeItemId ? styles.selectedItem : ""} onClick={() => setActiveItemId(item.id)}>
                  <label className={styles.productCell}>
                    <span>Товар {index + 1}</span>
                    <div className={styles.inlineSearch}>
                      <Search size={16} />
                      <input
                        value={item.id === activeItemId ? productSearch : item.productName}
                        onFocus={() => {
                          setActiveItemId(item.id);
                          setProductSearch(item.productName || "");
                        }}
                        onChange={(event) => {
                          setActiveItemId(item.id);
                          patchItem(item.id, { productName: event.target.value, assortmentHref: "" });
                          setProductSearch(event.target.value);
                        }}
                        placeholder="Название, код или артикул товара"
                      />
                    </div>
                    {item.id === activeItemId && productSearch.trim().length >= 2 ? (
                      <div className={styles.inlineResults}>
                        {(productQuery.data ?? []).map((product) => (
                          <button key={product.href || product.id} type="button" onClick={() => chooseProduct(product)}>
                            <strong>{product.name}</strong>
                            <span>{product.code || "Без кода"} · Мин: {money(product.minPrice || product.price || 0)} · Опт: {money(product.wholesalePrice || 0)}</span>
                          </button>
                        ))}
                        {!productQuery.isLoading && !(productQuery.data ?? []).length ? <p>Ничего не найдено.</p> : null}
                      </div>
                    ) : null}
                  </label>
                  <label><span>Кол-во</span><input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => patchItem(item.id, { quantity: Number(event.target.value) })} /></label>
                  <label><span>Цена</span><input type="number" min="0" step="0.01" value={item.productPrice} onChange={(event) => patchItem(item.id, { productPrice: Number(event.target.value) })} /></label>
                  <label><span>Код</span><input value={item.code} onChange={(event) => patchItem(item.id, { code: event.target.value })} /></label>
                  <strong>{money(item.productPrice * item.quantity)}</strong>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeItem(item.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className={styles.summary}>
          <div>
            <p>Итог счета</p>
            <strong>{money(total)}</strong>
            <span>{items.filter((item) => item.assortmentHref).length} позиций готово</span>
          </div>
          <label><span>Точка продаж</span><select value={storeHref} onChange={(event) => setStoreHref(event.target.value)}><option value="">Без точки продаж</option>{stores.map((store) => <option key={store.id} value={store.storeHref}>{store.name}</option>)}</select></label>
          <button type="button" onClick={submit} disabled={submitMutation.isPending}>
            <FileText size={18} />
            {submitMutation.isPending ? "Создаю..." : "Создать PDF и заказ"}
          </button>
          <button type="button" onClick={printProposal} disabled={proposalMutation.isPending}>
            <Printer size={18} />
            {proposalMutation.isPending ? "Собираю КП..." : "Коммерческое предложение"}
          </button>
          <button type="button" onClick={createProposalLink} disabled={proposalLinkMutation.isPending}>
            <FileText size={18} />
            {proposalLinkMutation.isPending ? "Создаю веб-КП..." : "Веб-КП на 12 часов"}
          </button>
          {currentCustomerHref ? (
            <div className={styles.orderBox}>
              <p>Заказы покупателя</p>
              <strong>{ordersQuery.data?.length || 0}</strong>
              <span>Показываю все заказы выбранного контрагента из МойСклад.</span>
              {result?.documentName ? <span>Последний созданный: {result.documentName}</span> : null}
              <button type="button" onClick={() => setOrderModalOpen(true)}>
                <FileText size={18} />
                Открыть список
              </button>
            </div>
          ) : null}
        </aside>
      </section>

      {orderModalOpen && currentCustomerHref ? (
        <div className={styles.modalBackdrop} onClick={() => setOrderModalOpen(false)} role="presentation">
          <div className={styles.modalCard} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className={styles.modalHead}>
              <div>
                <p>Заказы покупателя</p>
                <h2>{form.customerName || result?.documentName || "Контрагент"}</h2>
                <span>Выбери оплаченный заказ и создай отгрузку прямо из него.</span>
              </div>
              <button type="button" className={styles.modalClose} onClick={() => setOrderModalOpen(false)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>

            <div className={styles.ordersTable}>
              <div className={styles.ordersHead}>
                <span>Заказ</span>
                <span>Дата</span>
                <span>Сумма</span>
                <span>Оплата</span>
                <span>Статус</span>
                <span>Действия</span>
              </div>
              {(ordersQuery.data ?? []).map((order) => {
                const canCreateDemand = order.unpaid <= 0;
                const isActive = selectedOrder?.id === order.id;
                return (
                  <div key={order.id} className={`${styles.ordersRow} ${isActive ? styles.ordersRowActive : ""}`}>
                    <div>
                      <strong>{order.name || "Заказ"}</strong>
                      <span>{order.organizationName || "Без организации"}</span>
                    </div>
                    <span>{order.moment ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(order.moment)) : "-"}</span>
                    <span>{money(order.sum)}</span>
                    <span>{order.unpaid <= 0 ? `Оплачен: ${money(order.paid)}` : `Остаток: ${money(order.unpaid)}`}</span>
                    <span>{order.stateName || (order.unpaid <= 0 ? "Оплачен" : "Ждет оплаты")}</span>
                    <div className={styles.orderRowActions}>
                      {order.webUrl ? <a href={order.webUrl} target="_blank" rel="noreferrer">Открыть</a> : null}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOrder(order);
                          setShipmentResult(null);
                        }}
                        disabled={!canCreateDemand}
                      >
                        {canCreateDemand ? "Выбрать" : "Не оплачен"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {ordersQuery.isLoading ? <p className={styles.ordersEmpty}>Загружаю заказы...</p> : null}
              {!ordersQuery.isLoading && !(ordersQuery.data ?? []).length ? <p className={styles.ordersEmpty}>По этому контрагенту заказов пока нет.</p> : null}
            </div>

            <div className={styles.modalActions}>
              {result ? <button type="button" onClick={() => printPdf(result.blob, result.fileName)}><Printer size={17} /> Печать PDF</button> : null}
              {result ? <button type="button" onClick={() => downloadBlob(result.blob, result.fileName)}><Download size={17} /> Скачать PDF</button> : null}
              {selectedOrder?.webUrl ? <a href={selectedOrder.webUrl} target="_blank" rel="noreferrer">Открыть заказ</a> : null}
              <button type="button" onClick={() => shipmentMutation.mutate()} disabled={shipmentMutation.isPending || Boolean(shipmentResult) || !selectedOrder || selectedOrder.unpaid > 0}>
                <FileText size={17} />
                {shipmentMutation.isPending ? "Создаю отгрузку..." : shipmentResult ? "Отгрузка создана" : "Создать отгрузку из заказа"}
              </button>
            </div>

            {shipmentResult ? (
              <div className={styles.modalSuccess}>
                <strong>{shipmentResult.documentName || "Отгрузка готова"}</strong>
                <span>Отгрузка создана из заказа покупателя.</span>
                {shipmentResult.documentWebUrl ? <a href={shipmentResult.documentWebUrl} target="_blank" rel="noreferrer">Открыть отгрузку</a> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
