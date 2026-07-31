"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronLeft, ChevronRight, PencilLine, Printer, Receipt, RefreshCcw, RotateCcw, ScrollText } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { printSalesReceipt, type SalesReceiptData } from "@/src/fsd/features/print-sales-receipt";
import {
  createReportReturn,
  getReportStores,
  getSalesReport,
  REPORT_TYPE_LABELS,
  updateReportSalePrice,
  type CustomerType,
  type ReportProduct,
  type ReportRow,
  type ReportType,
  type ReturnResponse,
} from "../api/reports-api";
import { ReportsPrint } from "./reports-print";
import styles from "./reports-page.module.css";

type Period = "yesterday" | "today" | "week" | "month" | "custom";
type CustomerFilter = "all" | Exclude<CustomerType, "">;
type PrintMode = "report" | "waybill" | null;
type ProductSummaryRow = {
  key: string;
  code: string;
  name: string;
  quantity: number;
  amount: number;
  documents: number;
};

const reportTypes = Object.entries(REPORT_TYPE_LABELS) as Array<[ReportType, string]>;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function toDateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getPeriodRange(period: Period, offset = 0) {
  const today = startOfDay(new Date());
  let start = new Date(today);
  let end = new Date(today);

  if (period === "yesterday") {
    start.setDate(today.getDate() - 1 + offset);
    end = new Date(start);
  }
  if (period === "today") {
    start.setDate(today.getDate() + offset);
    end = new Date(start);
  }
  if (period === "week") {
    start = startOfWeek(today);
    start.setDate(start.getDate() + offset * 7);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  }
  if (period === "month") {
    start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  }

  return { dateFrom: toDateInput(start), dateTo: toDateInput(end) };
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${value}T00:00:00`));
}

function formatSom(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value || 0);
}

function normalizeSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function calculateTotals(rows: ReportRow[]) {
  return rows.reduce(
    (acc, row) => ({
      documents: acc.documents + 1,
      amount: acc.amount + row.amount,
      paid: acc.paid + row.paid,
      unpaid: acc.unpaid + row.unpaid,
      commission: (acc.commission ?? 0) + Number(row.commission || 0),
      netProfit: acc.netProfit + Number(row.netProfit || 0),
    }),
    { documents: 0, amount: 0, paid: 0, unpaid: 0, commission: 0, netProfit: 0 },
  );
}

function displayProducts(row: ReportRow): ReportProduct[] {
  if (row.products.length) return row.products;
  return [{ index: 0, code: "", name: row.productText || "Товар", quantity: 1, price: row.amount, sum: row.amount, isGift: false }];
}

function getLoyaltyRedemption(comment: string) {
  const match = String(comment || "").match(/бонус(?:ами|ы\s+списано)?\s*:\s*[−-]?\s*(\d[\d\s.,]*)/iu);
  if (!match) return 0;
  const value = Number(match[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function receiptDataFromReport(row: ReportRow): SalesReceiptData {
  const products = displayProducts(row);
  const isReturn = row.type === "retailsalesreturn" || row.type === "salesreturn";
  const loyaltyRedemption = isReturn ? 0 : getLoyaltyRedemption(row.comment);
  const sourceDocumentNumber = isReturn
    ? row.comment.match(/из документа\s+([^\n.]+)/iu)?.[1]?.trim()
    : undefined;
  const productTotal = products.reduce((sum, product) => sum + (product.isGift ? 0 : Number(product.sum) || 0), 0);

  return {
    receiptKind: isReturn ? "return" : "sale",
    documentNumber: row.name,
    sourceDocumentNumber,
    dateTime: row.moment,
    storeName: row.storeName,
    employeeName: row.employeeName,
    customerName: row.customerName,
    items: products.map((product) => ({
      name: product.name,
      price: product.price,
      quantity: product.quantity,
      lineTotal: product.sum,
      isGift: product.isGift,
    })),
    baseTotal: Math.max(productTotal + loyaltyRedemption, row.amount + loyaltyRedemption),
    loyaltyRedemption,
    finalTotal: row.amount,
    paymentType: row.paymentType || (isReturn ? "Возврат" : "-"),
    paidAmount: isReturn ? row.amount : row.paid,
    unpaidAmount: isReturn ? 0 : row.unpaid,
  };
}

function buildProductSummary(rows: ReportRow[]) {
  const summary = new Map<string, ProductSummaryRow>();
  for (const row of rows) {
    const products = displayProducts(row);
    const documentProductKeys = new Set<string>();

    for (const product of products) {
      const key = normalizeSearch(`${product.code || ""} ${product.name || ""}`) || product.name || product.code || row.id;
      const current = summary.get(key) ?? { key, code: product.code, name: product.name || "Товар", quantity: 0, amount: 0, documents: 0 };
      current.quantity += Number(product.quantity) || 0;
      current.amount += Number(product.sum) || 0;
      if (!documentProductKeys.has(key)) {
        current.documents += 1;
        documentProductKeys.add(key);
      }
      summary.set(key, current);
    }
  }
  return [...summary.values()].sort((left, right) => right.amount - left.amount);
}

function matchesCustomerFilter(row: ReportRow, customerFilter: CustomerFilter) {
  return customerFilter === "all" || row.customerType === customerFilter;
}

function buildChartData(rows: ReportRow[]) {
  const totalsByDate = new Map<string, number>();
  for (const row of rows) {
    const key = row.moment ? row.moment.slice(0, 10) : "Без даты";
    totalsByDate.set(key, (totalsByDate.get(key) ?? 0) + row.amount);
  }

  return Array.from(totalsByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => ({
      date,
      label: date === "Без даты" ? date : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(`${date}T00:00:00`)),
      amount,
    }));
}

function sanitizeFileName(value: string) {
  return String(value || "Отчет")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function printWithTitle(title: string) {
  const oldTitle = document.title;
  document.title = sanitizeFileName(title);
  window.print();
  window.setTimeout(() => {
    document.title = oldTitle;
  }, 1000);
}

function canCreateReturn(row: ReportRow) {
  return row.type === "retaildemand" || row.type === "demand";
}

export function ReportsPage() {
  const { showToast } = useToast();
  const initialRange = useMemo(() => getPeriodRange("today"), []);
  const [period, setPeriod] = useState<Period>("today");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [reportType, setReportType] = useState<ReportType>("retaildemand");
  const [customerFilter, setCustomerFilter] = useState<CustomerFilter>("all");
  const [clientSearch, setClientSearch] = useState("");
  const [appliedClientSearch, setAppliedClientSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [retailStoreHref, setRetailStoreHref] = useState("");
  const [printMode, setPrintMode] = useState<PrintMode>(null);
  const [printRow, setPrintRow] = useState<ReportRow | null>(null);
  const [createdReturn, setCreatedReturn] = useState<ReturnResponse | null>(null);

  const storesQuery = useQuery({ queryKey: ["report-stores"], queryFn: getReportStores });
  const selectedStore = storesQuery.data?.find((store) => store.href === retailStoreHref);
  const reportQuery = useQuery({
    queryKey: ["sales-report", dateFrom, dateTo, reportType, customerFilter, appliedClientSearch, retailStoreHref, selectedStore?.storeHref ?? ""],
    queryFn: () =>
      getSalesReport({
        dateFrom,
        dateTo,
        documentType: reportType,
        customerType: customerFilter === "all" ? "" : customerFilter,
        search: appliedClientSearch,
        retailStoreHref,
        storeHref: selectedStore?.storeHref,
      }),
  });

  const returnMutation = useMutation({
    mutationFn: createReportReturn,
    onSuccess: (result) => {
      setCreatedReturn(result);
      showToast({
        tone: "success",
        title: `Возврат ${result.document.name || ""} создан`,
        description: result.telegramReturn?.sent
          ? "Документ создан в МойСклад, уведомление отправлено в Telegram."
          : "Документ возврата создан в МойСклад.",
      });
      if (result.telegramReturn?.sent === false) {
        showToast({
          tone: "error",
          title: "Возврат не отправлен в Telegram",
          description: result.telegramReturn.error || "Telegram отклонил уведомление.",
        });
      }
      reportQuery.refetch();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось создать возврат", description: getErrorText(error) }),
  });

  const priceMutation = useMutation({
    mutationFn: updateReportSalePrice,
    onSuccess: async (result) => {
      showToast({
        tone: result.warning ? "error" : "success",
        title: `Цена в документе ${result.document.name || ""} изменена`,
        description: result.warning || `Новая сумма: ${formatSom(result.document.amount)}. Прибыль: ${formatSom(result.document.netProfit)}.`,
      });
      await reportQuery.refetch();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось изменить цену", description: getErrorText(error) }),
  });

  const rows = reportQuery.data?.rows ?? [];
  const visibleRows = rows.filter((row) => row.type === reportType && matchesCustomerFilter(row, customerFilter));
  const totals = reportQuery.data?.totals ? {
    documents: visibleRows.length,
    amount: visibleRows.reduce((sum, row) => sum + row.amount, 0),
    paid: visibleRows.reduce((sum, row) => sum + row.paid, 0),
    unpaid: visibleRows.reduce((sum, row) => sum + row.unpaid, 0),
    commission: visibleRows.reduce((sum, row) => sum + Number(row.commission || 0), 0),
    netProfit: visibleRows.reduce((sum, row) => sum + Number(row.netProfit || 0), 0),
  } : calculateTotals(visibleRows);
  const productSummary = buildProductSummary(visibleRows);
  const filteredProductSummary = productSummary.filter((product) => {
    const query = normalizeSearch(productSearch);
    if (!query) return true;
    return normalizeSearch(`${product.code} ${product.name}`).includes(query);
  });
  const productSummaryQuantity = filteredProductSummary.reduce((sum, product) => sum + product.quantity, 0);
  const productSummaryAmount = filteredProductSummary.reduce((sum, product) => sum + product.amount, 0);
  const chartData = buildChartData(visibleRows);
  const canViewProfit = reportQuery.data?.canViewProfit === true;
  const canEditSales = reportQuery.data?.canEditSales === true;
  const currentReportTitle = REPORT_TYPE_LABELS[reportType];

  const selectPeriod = (nextPeriod: Period, nextOffset = 0) => {
    const range = getPeriodRange(nextPeriod, nextOffset);
    setPeriod(nextPeriod);
    setPeriodOffset(nextOffset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  };

  const shiftPeriod = (direction: number) => {
    const basePeriod = period === "custom" ? "today" : period;
    selectPeriod(basePeriod, periodOffset + direction);
  };

  const selectLegalWholesale = () => {
    setReportType("demand");
    setCustomerFilter("legal");
  };

  const clearClientSearch = () => {
    setClientSearch("");
    setAppliedClientSearch("");
  };

  const clearAllFilters = () => {
    setRetailStoreHref("");
    setCustomerFilter("all");
    setClientSearch("");
    setAppliedClientSearch("");
    setProductSearch("");
    selectPeriod("today", 0);
  };

  const handleCreateReturn = (row: ReportRow, product: ReportProduct) => {
    const fallbackQuantity = Number(product.quantity || 1);
    const input = window.prompt(`Количество для возврата по товару «${product.name}»`, String(fallbackQuantity));
    if (!input) return;
    const quantity = Number(String(input).replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast({ tone: "error", title: "Некорректное количество", description: "Введите число больше нуля." });
      return;
    }
    const productIndex = typeof product.index === "number" ? product.index : displayProducts(row).findIndex((item) => item === product);
    returnMutation.mutate({
      documentId: row.id,
      documentType: row.type as "retaildemand" | "demand",
      productIndex,
      quantity,
    });
  };

  const handleUpdatePrice = (row: ReportRow, product: ReportProduct, index: number) => {
    if (!canCreateReturn(row)) return;
    const input = window.prompt(`Новая цена за единицу товара «${product.name}»`, String(product.price));
    if (input === null) return;
    const price = Number(input.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      showToast({ tone: "error", title: "Некорректная цена", description: "Введите число не меньше нуля." });
      return;
    }
    if (price === product.price) return;
    if (!window.confirm(`Изменить цену «${product.name}» с ${formatSom(product.price)} на ${formatSom(price)} в документе ${row.name}?`)) return;
    priceMutation.mutate({
      documentId: row.id,
      documentType: row.type as "retaildemand" | "demand",
      productIndex: product.index ?? index,
      positionId: product.positionId,
      price,
    });
  };

  const handlePrintReport = () => {
    setPrintMode("report");
    setPrintRow(null);
    window.setTimeout(() => printWithTitle(`${currentReportTitle} ${dateFrom} - ${dateTo}`), 0);
  };

  const handlePrintReceipt = (row: ReportRow) => {
    try {
      printSalesReceipt(receiptDataFromReport(row));
    } catch (error) {
      showToast({ tone: "error", title: "Не удалось открыть печать", description: getErrorText(error) });
    }
  };

  const handlePrintReturnReceipt = () => {
    if (!createdReturn?.receipt) {
      showToast({ tone: "error", title: "Чек недоступен", description: "Сервер не вернул данные созданного возврата." });
      return;
    }
    try {
      printSalesReceipt(createdReturn.receipt);
    } catch (error) {
      showToast({ tone: "error", title: "Не удалось открыть печать", description: getErrorText(error) });
    }
  };

  const handlePrintWaybill = (row: ReportRow) => {
    setPrintMode("waybill");
    setPrintRow(row);
    window.setTimeout(() => printWithTitle(`Товарная накладная ${row.name}`), 0);
  };

  useEffect(() => {
    if (storesQuery.error) {
      showToast({ tone: "error", title: "Точки продаж недоступны", description: getErrorText(storesQuery.error) });
    }
  }, [showToast, storesQuery.error]);

  useEffect(() => {
    if (reportQuery.error) {
      showToast({ tone: "error", title: "Не удалось загрузить отчет", description: getErrorText(reportQuery.error) });
    }
  }, [reportQuery.error, showToast]);

  useEffect(() => {
    const handler = () => {
      setPrintMode(null);
      setPrintRow(null);
    };
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, []);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Продажи и отгрузки</p>
          <h1>Отчетность</h1>
          <span>Документы из МойСклад, оплаты, остаток и прибыль по доступу пользователя.</span>
        </div>
        <button type="button" onClick={handlePrintReport}>
          <Printer size={17} />
          Печать
        </button>
      </header>

      <nav className={styles.tabs} aria-label="Тип документов">
        {reportTypes.map(([type, label]) => (
          <button key={type} type="button" className={reportType === type ? styles.activeTab : ""} onClick={() => setReportType(type)}>
            <span>{label}</span>
            <strong>{rows.filter((row) => row.type === type && matchesCustomerFilter(row, customerFilter)).length}</strong>
          </button>
        ))}
      </nav>

      <form
        className={`${styles.filters} ${styles.reportPanel}`}
        onSubmit={(event) => {
          event.preventDefault();
          setPeriod("custom");
          setAppliedClientSearch(clientSearch.trim());
          reportQuery.refetch();
        }}
      >
        <div className={styles.period}>
          <div>
            <span>Период</span>
            {(["yesterday", "today", "week", "month"] as Period[]).map((item) => (
              <button key={item} type="button" className={period === item ? styles.activePeriod : ""} onClick={() => selectPeriod(item)}>
                {item === "yesterday" ? "вч" : item === "today" ? "сег" : item === "week" ? "нед" : "мес"}
              </button>
            ))}
          </div>
          <section>
            <button type="button" aria-label="Предыдущий период" onClick={() => shiftPeriod(-1)}>
              <ChevronLeft size={16} />
            </button>
            <strong>{formatDate(dateFrom)} - {formatDate(dateTo)}</strong>
            <button type="button" aria-label="Следующий период" onClick={() => shiftPeriod(1)}>
              <ChevronRight size={16} />
            </button>
          </section>
        </div>

        <label>
          <span>С даты</span>
          <input type="date" value={dateFrom} onChange={(event) => { setPeriod("custom"); setDateFrom(event.target.value); }} />
        </label>
        <label>
          <span>По дату</span>
          <input type="date" value={dateTo} onChange={(event) => { setPeriod("custom"); setDateTo(event.target.value); }} />
        </label>
        <label>
          <span>Точка продаж</span>
          <select value={retailStoreHref} onChange={(event) => setRetailStoreHref(event.target.value)}>
            <option value="">Все филиалы</option>
            {(storesQuery.data ?? []).map((store) => <option key={store.id} value={store.href}>{store.name}</option>)}
          </select>
        </label>
        <label>
          <span>Клиент</span>
          <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value as CustomerFilter)}>
            <option value="all">Все клиенты</option>
            <option value="legal">Юрлица</option>
            <option value="entrepreneur">ИП</option>
            <option value="individual">Физлица</option>
          </select>
        </label>
        <label className={styles.searchField}>
          <span>Поиск клиента</span>
          <input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Имя, телефон, ИНН, документ или товар" />
        </label>
        <button type="button" className={styles.quickFilter} onClick={selectLegalWholesale}>
          Юрлица / опт
        </button>
        <button type="button" className={styles.secondaryButton} onClick={clearAllFilters}>
          <RefreshCcw size={16} />
          Сбросить
        </button>
        {appliedClientSearch ? (
          <button type="button" className={styles.clearFilter} onClick={clearClientSearch}>
            Сбросить поиск
          </button>
        ) : null}
        <button type="submit" disabled={reportQuery.isFetching}>
          {reportQuery.isFetching ? "Загружаю..." : "Показать"}
        </button>
      </form>

      <section className={styles.totals}>
        <article><span>Документов</span><strong>{totals.documents}</strong></article>
        <article><span>Сумма</span><strong>{formatSom(totals.amount)}</strong></article>
        <article><span>Оплачено</span><strong>{formatSom(totals.paid)}</strong></article>
        <article><span>Не оплачено</span><strong>{formatSom(totals.unpaid)}</strong></article>
        {canViewProfit ? <article><span>Чистая прибыль</span><strong>{formatSom(totals.netProfit)}</strong></article> : null}
      </section>

      {!canViewProfit ? (
        <section className={styles.accessNotice}>
          <strong>Прибыль скрыта</strong>
          <span>Для текущего сотрудника backend не отдает показатели чистой прибыли. Остальные данные отчета доступны.</span>
        </section>
      ) : null}

      {appliedClientSearch ? (
        <section className={styles.clientProducts}>
          <div className={styles.documentsHead}>
            <div>
              <h2>Что купил клиент</h2>
              <p>Поиск: {appliedClientSearch} · документов: {visibleRows.length} · товаров: {filteredProductSummary.length} · штук: {formatQuantity(productSummaryQuantity)} · сумма: {formatSom(productSummaryAmount)}</p>
            </div>
            <BarChart3 size={22} />
          </div>
          <div className={styles.productFilter}>
            <label>
              <span>Фильтр по товару</span>
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Название или код товара" />
            </label>
            {productSearch ? <button type="button" onClick={() => setProductSearch("")}>Сбросить товар</button> : null}
          </div>
          {filteredProductSummary.length ? (
            <div className={styles.products}>
              <table>
                <thead>
                  <tr><th>Код</th><th>Товар</th><th>Кол-во</th><th>Сумма</th><th>Док.</th></tr>
                </thead>
                <tbody>
                  {filteredProductSummary.map((product) => (
                    <tr key={product.key}>
                      <td>{product.code || "-"}</td>
                      <td>{product.name}</td>
                      <td>{formatQuantity(product.quantity)}</td>
                      <td>{formatSom(product.amount)}</td>
                      <td>{product.documents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className={styles.empty}>По выбранному товару позиций нет.</div>}
        </section>
      ) : null}

      <section className={styles.chartPanel}>
        <div>
          <h2>Динамика оборота</h2>
          <p>{REPORT_TYPE_LABELS[reportType]} по выбранному периоду</p>
        </div>
        <div className={styles.chart}>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                <Tooltip
                  cursor={{ fill: "rgba(79,140,255,0.12)" }}
                  formatter={(value) => [formatSom(Number(value)), "Сумма"]}
                  labelFormatter={(label) => `Дата: ${label}`}
                  contentStyle={{ background: "var(--panel-strong)", border: "1px solid var(--border-strong)", borderRadius: 14, color: "var(--text)" }}
                />
                <Bar dataKey="amount" radius={[10, 10, 4, 4]}>
                  {chartData.map((item, index) => (
                    <Cell key={item.date} fill={index % 3 === 0 ? "var(--primary)" : index % 3 === 1 ? "var(--cyan)" : "var(--orange)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className={styles.empty}>График появится после загрузки документов.</div>}
        </div>
      </section>

      <section className={`${styles.documents} ${styles.reportPanel}`}>
        <div className={styles.documentsHead}>
          <div>
            <h2>{REPORT_TYPE_LABELS[reportType]}</h2>
            <p>{reportQuery.isFetching ? "Загружаю данные из МойСклад..." : `Период: ${formatDate(dateFrom)} - ${formatDate(dateTo)}${customerFilter === "all" ? "" : " · фильтр по типу клиента"}${appliedClientSearch ? ` · поиск: ${appliedClientSearch}` : ""}`}</p>
          </div>
          <BarChart3 size={22} />
        </div>

        {reportQuery.isLoading ? <div className={styles.empty}>Загружаю отчет...</div> : null}
        {!reportQuery.isLoading && !visibleRows.length ? <div className={styles.empty}>По выбранным фильтрам документов нет.</div> : null}

        <div className={styles.documentList}>
          {visibleRows.map((row) => {
            const products = displayProducts(row);
            return (
              <article key={row.id} className={styles.documentCard}>
                <header>
                  <div><span>Номер</span><strong>{row.name || "-"}</strong></div>
                  <div><span>Время</span><strong>{formatDateTime(row.moment)}</strong></div>
                  <div>
                    <span>Сумма</span>
                    <strong>{formatSom(row.amount)}</strong>
                    {Number(row.exchangeRate) > 1 ? <small>{formatQuantity(Number(row.sourceAmount))} {row.currencyIsoCode || "USD"} × {row.exchangeRate}</small> : null}
                  </div>
                  <div><span>Склад</span><strong>{row.storeName || "-"}</strong></div>
                  <div><span>Клиент</span><strong>{row.customerName || "-"}</strong>{row.customerTypeLabel ? <small>{row.customerTypeLabel}</small> : null}</div>
                  <div><span>Сотрудник</span><strong>{row.employeeName || "-"}</strong></div>
                  {canViewProfit ? <div><span>Прибыль</span><strong>{formatSom(row.netProfit)}</strong></div> : null}
                  <div><span>Оплата</span><strong>{row.paymentType || "-"}</strong></div>
                </header>

                <div className={styles.meta}>
                  <span>Организация: {row.organizationName || "-"}</span>
                  <span>Телефон: {row.customerPhone || "-"}</span>
                  <span>ИНН: {row.customerInn || "-"}</span>
                  <span>Адрес: {row.customerAddress || "-"}</span>
                  <span>Комментарий: {row.comment || "-"}</span>
                  <span>Оплачено: {formatSom(row.paid)}</span>
                  <span>Не оплачено: {formatSom(row.unpaid)}</span>
                </div>

                <div className={styles.products}>
                  <table>
                    <thead>
                      <tr><th>Код</th><th>Товар</th><th>Цена</th><th>Кол-во</th><th>Сумма</th><th>Действие</th></tr>
                    </thead>
                    <tbody>
                      {products.map((product, index) => (
                        <tr key={`${product.code}-${product.name}-${index}`}>
                          <td>{product.code || "-"}</td>
                          <td>{product.name}</td>
                          <td>
                            {product.isGift ? "Подарок" : formatSom(product.price)}
                            {!product.isGift && Number(product.exchangeRate) > 1 ? (
                              <small className={styles.currencyHint}>{formatQuantity(Number(product.sourcePrice))} {product.currencyIsoCode || "USD"} × {product.exchangeRate}</small>
                            ) : null}
                          </td>
                          <td>{formatQuantity(product.quantity)}</td>
                          <td>
                            {product.isGift ? formatSom(0) : formatSom(product.sum)}
                            {!product.isGift && Number(product.exchangeRate) > 1 ? (
                              <small className={styles.currencyHint}>{formatQuantity(Number(product.sourceSum))} {product.currencyIsoCode || "USD"} × {product.exchangeRate}</small>
                            ) : null}
                          </td>
                          <td>
                            {canCreateReturn(row) ? (
                              <div className={styles.tableActions}>
                                {canEditSales ? (
                                  <button type="button" className={styles.tableAction} onClick={() => handleUpdatePrice(row, product, index)} disabled={priceMutation.isPending}>
                                    <PencilLine size={14} />
                                    Исправить цену
                                  </button>
                                ) : null}
                                <button type="button" className={styles.tableAction} onClick={() => handleCreateReturn(row, product)} disabled={returnMutation.isPending}>
                                  <RotateCcw size={14} />
                                  Возврат
                                </button>
                              </div>
                            ) : <span className={styles.mutedCell}>-</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <footer>
                  <div className={styles.documentActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => handlePrintReceipt(row)}>
                      <Receipt size={16} />
                      {row.type === "retailsalesreturn" || row.type === "salesreturn" ? "Возвратный чек" : "Товарный чек"}
                    </button>
                    {(row.type === "retaildemand" || row.type === "demand") ? (
                      <>
                        <button type="button" className={styles.secondaryButton} onClick={() => handlePrintWaybill(row)}>
                          <ScrollText size={16} />
                          Накладная
                        </button>
                      </>
                    ) : null}
                    {row.webUrl ? <a href={row.webUrl} target="_blank" rel="noreferrer">Перейти к документу</a> : null}
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      {createdReturn ? (
        <div className={styles.returnOverlay} role="presentation" onMouseDown={() => setCreatedReturn(null)}>
          <section
            className={styles.returnModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="return-created-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="return-created-title">Возврат создан</strong>
                <span>Возвратный документ №{createdReturn.document.name || "-"}</span>
              </div>
              <button type="button" aria-label="Закрыть окно" onClick={() => setCreatedReturn(null)}>×</button>
            </header>
            <div className={styles.returnModalSummary}>
              <span>Сумма возврата</span>
              <strong>{formatSom(createdReturn.receipt?.finalTotal || 0)}</strong>
            </div>
            <div className={styles.returnModalActions}>
              <button type="button" onClick={handlePrintReturnReceipt} disabled={!createdReturn.receipt}>
                <Printer size={17} />
                Распечатать возвратный чек
              </button>
              {createdReturn.document.webUrl ? (
                <button type="button" className={styles.returnDocumentButton} onClick={() => window.open(createdReturn.document.webUrl, "_blank", "noopener,noreferrer")}>
                  Перейти к документу
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <ReportsPrint
        mode={printMode}
        row={printRow}
        rows={visibleRows}
        totals={totals}
        canViewProfit={canViewProfit}
        reportType={reportType}
        dateFrom={dateFrom}
        dateTo={dateTo}
        reportTitle={currentReportTitle}
      />
    </section>
  );
}
