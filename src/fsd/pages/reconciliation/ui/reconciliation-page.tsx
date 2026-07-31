"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Banknote, Printer, RefreshCw, Search } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { createReconciliationPayment, getReconciliationDebtors, getReconciliationDetails, type Debtor } from "../api/reconciliation-api";
import styles from "./reconciliation-page.module.css";

const money = (value: number) => `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
const dateTime = (value: string) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-";

export function ReconciliationPage() {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [appliedCustomerType, setAppliedCustomerType] = useState("");
  const [selected, setSelected] = useState<Debtor | null>(null);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState<"KGS" | "USD">("KGS");
  const [paymentDescription, setPaymentDescription] = useState("");

  const debtorsQuery = useInfiniteQuery({
    queryKey: ["reconciliation-debtors", appliedSearch, appliedCustomerType],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getReconciliationDebtors({ search: appliedSearch, customerType: appliedCustomerType, offset: Number(pageParam), limit: 60 }),
    getNextPageParam: (lastPage) => lastPage.page.hasMore ? lastPage.page.nextOffset : undefined,
    maxPages: 1,
  });

  const detailsQuery = useQuery({
    queryKey: ["reconciliation-details", selected?.id],
    queryFn: () => getReconciliationDetails(selected?.id || ""),
    enabled: Boolean(selected?.id),
  });
  const paymentMutation = useMutation({
    mutationFn: (input: { id: string; amount: number; currency: "KGS" | "USD"; description: string }) =>
      createReconciliationPayment(input.id, {
        amount: input.amount,
        currency: input.currency,
        description: input.description,
      }),
    onSuccess: async (result) => {
      showToast({
        tone: "success",
        title: `Входящий платёж №${result.payment.name || ""} создан`,
        description: `В МойСклад внесено ${money(result.payment.amount)}. Остаток долга: ${money(result.remainingDebt)}.`,
      });
      setPaymentFormOpen(false);
      setPaymentAmount("");
      setPaymentCurrency("KGS");
      setPaymentDescription("");
      setSelected((current) => current ? {
        ...current,
        debt: result.remainingDebt,
        paid: current.paid + result.payment.amount,
      } : current);
      await Promise.all([detailsQuery.refetch(), debtorsQuery.refetch()]);
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось внести платёж", description: getErrorText(error) }),
  });
  const {
    error: debtorsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = debtorsQuery;

  useEffect(() => {
    if (debtorsError) {
      showToast({ tone: "error", title: "Не удалось загрузить акт сверки", description: getErrorText(debtorsError) });
    }
  }, [debtorsError, showToast]);

  useEffect(() => {
    if (detailsQuery.error) {
      showToast({ tone: "error", title: "Не удалось загрузить детали должника", description: getErrorText(detailsQuery.error) });
    }
  }, [detailsQuery.error, showToast]);

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || debtorsError) return;
    const timer = window.setTimeout(() => void fetchNextPage(), 250);
    return () => window.clearTimeout(timer);
  }, [debtorsError, fetchNextPage, hasNextPage, isFetchingNextPage]);

  const pages = debtorsQuery.data?.pages ?? [];
  const currentPage = pages.at(-1);
  const debtors = currentPage?.debtors ?? [];
  const totals = currentPage?.totals ?? { debt: 0, paid: 0, documents: 0, debtors: 0 };
  const isInitialLoading = debtorsQuery.isLoading && !pages.length;
  const loadedChunks = currentPage?.page.scannedChunks ?? 0;
  const scannedDocuments = currentPage?.page.scannedDocuments ?? 0;
  const truncated = currentPage?.truncated === true;
  const hasMore = Boolean(debtorsQuery.hasNextPage);
  const details = detailsQuery.data;
  const usdRate = details?.usdRate || currentPage?.usdRate || 88;
  const parsedPaymentAmount = Number(paymentAmount.replace(/\s/g, "").replace(",", "."));
  const paymentAmountSom = Number.isFinite(parsedPaymentAmount)
    ? parsedPaymentAmount * (paymentCurrency === "USD" ? usdRate : 1)
    : 0;

  const applyFilters = () => {
    setAppliedSearch(search.trim());
    setAppliedCustomerType(customerType);
  };

  const refresh = () => {
    if (search.trim() !== appliedSearch || customerType !== appliedCustomerType) {
      applyFilters();
      return;
    }
    debtorsQuery.refetch();
  };

  const printAct = () => {
    if (!details) return;
    window.print();
  };

  const resetPaymentForm = () => {
    setPaymentFormOpen(false);
    setPaymentAmount("");
    setPaymentCurrency("KGS");
    setPaymentDescription("");
  };

  const openDebtor = (debtor: Debtor) => {
    resetPaymentForm();
    setSelected(debtor);
  };

  const closeDebtor = () => {
    resetPaymentForm();
    setSelected(null);
  };

  const submitIncomingPayment = () => {
    if (!selected || !details) return;
    if (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount <= 0) {
      showToast({ tone: "error", title: "Некорректная сумма", description: "Введите сумму платежа больше нуля." });
      return;
    }
    if (paymentAmountSom > details.totals.debt) {
      showToast({ tone: "error", title: "Сумма больше долга", description: `Текущий долг: ${money(details.totals.debt)}.` });
      return;
    }
    const sourceLabel = paymentCurrency === "USD"
      ? `${parsedPaymentAmount} USD × ${usdRate} = ${money(paymentAmountSom)}`
      : money(paymentAmountSom);
    if (!window.confirm(`Создать входящий платёж ${sourceLabel} для «${selected.name}»?`)) return;
    paymentMutation.mutate({
      id: selected.id,
      amount: parsedPaymentAmount,
      currency: paymentCurrency,
      description: paymentDescription.trim(),
    });
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Взаиморасчеты</p>
          <h1>Акт сверки</h1>
          <span>Долги клиентов, документы, оплаты и печатный акт сверки.</span>
        </div>
        <button type="button" onClick={refresh}>
          <RefreshCw size={17} /> Обновить
        </button>
      </header>

      <section className={styles.filters}>
        <label>
          <span>Поиск</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, телефон, ИНН" />
        </label>
        <label>
          <span>Тип клиента</span>
          <select value={customerType} onChange={(event) => setCustomerType(event.target.value)}>
            <option value="">Все</option>
            <option value="individual">Физлица</option>
            <option value="entrepreneur">ИП</option>
            <option value="legal">Юрлица</option>
          </select>
        </label>
        <button type="button" onClick={applyFilters}>
          <Search size={16} /> Показать
        </button>
        <button type="button" onClick={refresh}>
          <RefreshCw size={16} /> Обновить
        </button>
      </section>

      {truncated ? (
        <div className={styles.warning}>
          <AlertTriangle size={16} />
          <span>Показана только часть данных. Для полного списка догружай должников по частям.</span>
        </div>
      ) : null}

      <section className={styles.summary}>
        <article className={styles.total}>
          <span>Общий долг</span>
          <strong>{money(totals.debt)}</strong>
          <small>По загруженным частям</small>
        </article>
        <article>
          <span>Должников</span>
          <strong>{totals.debtors}</strong>
        </article>
        <article>
          <span>Документов</span>
          <strong>{totals.documents}</strong>
        </article>
        <article>
          <span>Оплачено частично</span>
          <strong>{money(totals.paid)}</strong>
        </article>
      </section>

      <section className={styles.loadState}>
        <span>Загружено частей: {loadedChunks} · просмотрено документов: {scannedDocuments}</span>
        {hasMore ? (
          <button type="button" onClick={() => debtorsQuery.fetchNextPage()} disabled={debtorsQuery.isFetchingNextPage}>
            {debtorsQuery.isFetchingNextPage ? "Загружаю..." : "Загрузить еще"}
          </button>
        ) : (
          <strong>{pages.length ? "Все доступные части загружены" : ""}</strong>
        )}
      </section>

      <section className={styles.tablePanel}>
        <table>
          <thead>
            <tr>
              <th>Должник</th>
              <th>Тип клиента</th>
              <th>Телефон / ИНН</th>
              <th>Последний документ</th>
              <th>Док.</th>
              <th>Оплачено</th>
              <th>Долг</th>
            </tr>
          </thead>
          <tbody>
            {debtors.map((item) => (
              <tr key={item.id} onClick={() => openDebtor(item)}>
                <td>
                  <strong>{item.name}</strong>
                  <small>{item.actualAddress || "Адрес не указан"}</small>
                </td>
                <td>{item.customerTypeLabel || "Клиент"}</td>
                <td>{[item.phone, item.inn].filter(Boolean).join(" / ") || "-"}</td>
                <td>
                  <strong>{item.lastDocumentName || "-"}</strong>
                  <small>{dateTime(item.lastMoment)}</small>
                </td>
                <td>{item.documentCount}</td>
                <td>{money(item.paid)}</td>
                <td><b>{money(item.debt)}</b></td>
              </tr>
            ))}
            {!debtors.length ? (
              <tr>
                <td colSpan={7}>{isInitialLoading ? "Загрузка первой части..." : "Долгов нет по выбранным фильтрам."}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {selected ? (
        <div className={styles.modal} onClick={closeDebtor}>
          <section className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.customerTypeLabel} · {selected.phone || "Телефон не указан"} · остаток долга {money(details?.totals.debt ?? selected.debt)}</p>
              </div>
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setPaymentFormOpen((open) => !open)}><Banknote size={16} /> Внести платёж</button>
                <button type="button" onClick={printAct}><Printer size={16} /> Печать</button>
                <button type="button" onClick={closeDebtor}>Закрыть</button>
              </div>
            </header>

            {paymentFormOpen ? (
              <div className={styles.paymentForm}>
                <div>
                  <strong>Входящий платёж в МойСклад</strong>
                  <span>Контрагент: {selected.name}</span>
                </div>
                <label>
                  <span>Сумма</span>
                  <input value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} inputMode="decimal" placeholder="0,00" />
                </label>
                <label>
                  <span>Валюта</span>
                  <select value={paymentCurrency} onChange={(event) => setPaymentCurrency(event.target.value === "USD" ? "USD" : "KGS")}>
                    <option value="KGS">Сом (KGS)</option>
                    <option value="USD">Доллар (USD)</option>
                  </select>
                </label>
                <label className={styles.paymentComment}>
                  <span>Комментарий</span>
                  <input value={paymentDescription} onChange={(event) => setPaymentDescription(event.target.value)} placeholder="Необязательно" maxLength={1000} />
                </label>
                <div className={styles.paymentPreview}>
                  <span>{paymentCurrency === "USD" ? `Курс: ${usdRate} сом` : "Платёж в сомах"}</span>
                  <strong>К внесению: {money(paymentAmountSom)}</strong>
                </div>
                <button type="button" onClick={submitIncomingPayment} disabled={paymentMutation.isPending || !details}>
                  {paymentMutation.isPending ? "Создаю..." : "Создать входящий платёж"}
                </button>
              </div>
            ) : null}

            {detailsQuery.isLoading ? <p>Загружаю документы и оплаты...</p> : null}

            {details ? (
              <>
                <div className={styles.summary}>
                  <article className={styles.total}><span>Остаток долга</span><strong>{money(details.totals.debt)}</strong><small>Дебет − кредит</small></article>
                  <article><span>Дебет</span><strong>{money(details.totals.amount)}</strong></article>
                  <article><span>Кредит</span><strong>{money(details.totals.paid)}</strong></article>
                  <article><span>Документов</span><strong>{details.totals.documents}</strong></article>
                </div>

                <div className={styles.detailsGrid}>
                  <section className={styles.infoCard}>
                    <h3>Документы с долгом</h3>
                    <div className={styles.list}>
                      {details.documents.map((doc) => (
                        <article key={doc.id}>
                          <div>
                            <a href={doc.webUrl} target="_blank" rel="noreferrer">{doc.typeLabel} №{doc.name}</a>
                            <small>{dateTime(doc.moment)} · {doc.storeName || "-"} · {doc.paymentType || "Без типа оплаты"}</small>
                            {doc.exchangeRate > 1 ? <small>{doc.sourceAmount.toLocaleString("ru-RU")} {doc.currencyIsoCode} × {doc.exchangeRate} = {money(doc.amount)}</small> : null}
                            {doc.comment ? <small>{doc.comment}</small> : null}
                          </div>
                          <div className={styles.amounts}>
                            <strong>{money(doc.debt)}</strong>
                            <small>было {money(doc.originalDebt)}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className={styles.infoCard}>
                    <h3>Входящие оплаты</h3>
                    <div className={styles.list}>
                      {details.payments.length ? details.payments.map((payment) => (
                        <article key={payment.id}>
                          <div>
                            <a href={payment.webUrl} target="_blank" rel="noreferrer">Оплата №{payment.name}</a>
                            <small>{dateTime(payment.moment)} · {payment.organizationName || "-"}</small>
                            {payment.exchangeRate > 1 ? <small>{payment.sourceAmount.toLocaleString("ru-RU")} {payment.currencyIsoCode} × {payment.exchangeRate} = {money(payment.amount)}</small> : null}
                            {payment.description ? <small>{payment.description}</small> : null}
                          </div>
                          <strong>{money(payment.amount)}</strong>
                        </article>
                      )) : <article><div><small>Оплаты не найдены.</small></div></article>}
                    </div>
                  </section>
                </div>

                <div ref={printRef} className={styles.printArea}>
                  <div className={styles.actSheet}>
                    <div className={styles.actHeader}>
                      <h3>АКТ СВЕРКИ</h3>
                      <p>взаимных расчетов по состоянию на {details.act.date} между Ordo CRM и {details.act.customerName}</p>
                    </div>
                    <table className={styles.actTable}>
                      <thead>
                        <tr>
                          <th>№</th>
                          <th>Операция</th>
                          <th>По данным Ordo CRM: дебет</th>
                          <th>По данным контрагента: кредит</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.act.rows.map((row, index) => (
                          <tr key={row.id}>
                            <td>{index + 1}</td>
                            <td>{row.operation}</td>
                            <td>{row.debit ? money(row.debit) : "-"}</td>
                            <td>{row.credit ? money(row.credit) : "-"}</td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={2}><strong>Обороты за период</strong></td>
                          <td><strong>{money(details.act.totals.debit)}</strong></td>
                          <td><strong>{money(details.act.totals.credit)}</strong></td>
                        </tr>
                        <tr>
                          <td colSpan={2}><strong>Остаток долга (дебет − кредит)</strong></td>
                          <td colSpan={2}><strong>{money(Math.max(0, details.act.totals.debit - details.act.totals.credit))}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                    <div className={styles.signatures}>
                      <div>
                        <span>От Ordo CRM</span>
                        <strong>__________________</strong>
                      </div>
                      <div>
                        <span>От контрагента</span>
                        <strong>__________________</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
