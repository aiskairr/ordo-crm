"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Landmark } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { getBankCommissions } from "../api/bank-commissions-api";
import styles from "./bank-commissions-page.module.css";

type Period = "today" | "yesterday" | "week" | "2weeks" | "month" | "year" | "all" | "custom";

function toInputDate(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getPeriodRange(period: Period) {
  const now = new Date();
  const today = toInputDate(now);
  if (period === "today") return { dateFrom: today, dateTo: today };
  if (period === "yesterday") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { dateFrom: toInputDate(date), dateTo: toInputDate(date) };
  }
  if (period === "week" || period === "2weeks") {
    const date = new Date(now);
    date.setDate(date.getDate() - (period === "week" ? 6 : 13));
    return { dateFrom: toInputDate(date), dateTo: today };
  }
  if (period === "year") return { dateFrom: `${now.getFullYear()}-01-01`, dateTo: today };
  if (period === "all") return { dateFrom: "2020-01-01", dateTo: today };
  return { dateFrom: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: today };
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function percent(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}%`;
}

function formatDateTime(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function BankCommissionsPage() {
  const { showToast } = useToast();
  const initial = useMemo(() => getPeriodRange("month"), []);
  const [period, setPeriod] = useState<Period>("month");
  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo] = useState(initial.dateTo);
  const [bank, setBank] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [selectedPaymentType, setSelectedPaymentType] = useState("");

  const reportQuery = useQuery({
    queryKey: ["bank-commissions", dateFrom, dateTo, bank, paymentType],
    queryFn: () => getBankCommissions({ dateFrom, dateTo, bank, paymentType }),
  });

  const report = reportQuery.data;
  const rows = useMemo(() => report?.rows ?? [], [report?.rows]);
  const selectedRow = rows.find((row) => row.paymentType === selectedPaymentType) ?? rows[0] ?? null;
  const exportParams = new URLSearchParams({ dateFrom, dateTo });
  if (bank) exportParams.set("bank", bank);
  if (paymentType) exportParams.set("paymentType", paymentType);

  useEffect(() => {
    if (reportQuery.error) {
      showToast({ tone: "error", title: "Не удалось загрузить комиссии", description: getErrorText(reportQuery.error) });
    }
  }, [reportQuery.error, showToast]);

  const setFastPeriod = (next: Period) => {
    const range = getPeriodRange(next);
    setPeriod(next);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  };

  const kpis = [
    ["Общая комиссия", money(report?.totals.commission ?? 0)],
    ["Оборот через банки", money(report?.totals.turnover ?? 0)],
    ["Чистая сумма", money(report?.totals.netAmount ?? 0)],
    ["Топ банк", report?.totals.topCommissionBank?.paymentType || "-"],
    ["Платежей", new Intl.NumberFormat("ru-RU").format(report?.totals.paymentCount ?? 0)],
    ["Средний %", percent(report?.totals.averageRate ?? 0)],
  ];

  const selectChartRow = (data: unknown) => {
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const payload = record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : {};
    if (typeof payload.paymentType === "string") setSelectedPaymentType(payload.paymentType);
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Эквайринг и удержания</p>
          <h1>Банковские комиссии</h1>
          <span>Аналитика комиссий по банкам, обороту и чистой сумме после удержаний.</span>
        </div>
        <Landmark size={34} />
      </header>

      <form className={styles.filters} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.periods}>
          {(["today", "yesterday", "week", "2weeks", "month", "year", "all"] as Period[]).map((item) => (
            <button key={item} type="button" className={period === item ? styles.activePeriod : ""} onClick={() => setFastPeriod(item)}>
              {item === "today" ? "Сегодня" : item === "yesterday" ? "Вчера" : item === "week" ? "Неделя" : item === "2weeks" ? "2 недели" : item === "month" ? "Месяц" : item === "year" ? "Год" : "Все"}
            </button>
          ))}
        </div>
        <label>
          <span>Дата от</span>
          <input type="date" value={dateFrom} onChange={(event) => { setPeriod("custom"); setDateFrom(event.target.value); }} />
        </label>
        <label>
          <span>Дата до</span>
          <input type="date" value={dateTo} onChange={(event) => { setPeriod("custom"); setDateTo(event.target.value); }} />
        </label>
        <label>
          <span>Банк</span>
          <select value={bank} onChange={(event) => setBank(event.target.value)}>
            <option value="">Все банки</option>
            {(report?.bankOptions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Тип оплаты</span>
          <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
            <option value="">Все типы</option>
            {(report?.paymentTypeOptions ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div className={styles.exports}>
          <a href={`/api/reports/bank-commissions/export.xls?${exportParams.toString()}`}><Download size={16} /> Excel</a>
          <a href={`/api/reports/bank-commissions/export.pdf?${exportParams.toString()}`}><Download size={16} /> PDF</a>
        </div>
      </form>

      <section className={styles.kpis}>
        {kpis.map(([label, value], index) => (
          <article key={label} className={index === 0 ? styles.accent : ""}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className={styles.layout}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Комиссия по банкам</h2>
            <p>{reportQuery.isLoading ? "Загрузка..." : `${rows.length} типов оплат`}</p>
          </div>
          <div className={styles.chart}>
            {rows.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(36,50,74,0.08)" />
                  <XAxis dataKey="paymentType" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#697386" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#697386" }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={(value) => [money(Number(value)), "Комиссия"]} contentStyle={{ borderRadius: 14, border: "1px solid rgba(36,50,74,.12)" }} />
                  <Bar dataKey="commission" radius={[10, 10, 4, 4]} fill="#2563eb" onClick={selectChartRow} />
                </BarChart>
              </ResponsiveContainer>
            ) : <div className={styles.empty}>Нет данных для графика.</div>}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Детализация</h2>
            <p>{selectedRow ? selectedRow.paymentType : "Нет данных"}</p>
          </div>
          {selectedRow ? (
            <div className={styles.details}>
              <div className={styles.detailStats}>
                <article><span>Комиссия</span><strong>{money(selectedRow.commission)}</strong></article>
                <article><span>Оборот</span><strong>{money(selectedRow.turnover)}</strong></article>
                <article><span>Чистая</span><strong>{money(selectedRow.netAmount)}</strong></article>
                <article><span>Платежей</span><strong>{selectedRow.paymentCount}</strong></article>
              </div>
              <div className={styles.payments}>
                {selectedRow.payments.slice(0, 8).map((payment, index) => (
                  <article key={`${payment.saleId}-${index}`}>
                    <div><strong>{payment.saleName || payment.saleId || "Документ"}</strong><span>{payment.customerName || "Клиент не указан"} · {formatDateTime(payment.moment)}</span></div>
                    <b>{money(payment.commission)}</b>
                  </article>
                ))}
              </div>
            </div>
          ) : <div className={styles.empty}>Выберите банк.</div>}
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Сводка по банкам</h2>
          <p>{reportQuery.isFetching ? "Обновляю..." : "Сортировка по комиссии"}</p>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Банк</th><th>Сумма продаж</th><th>Комиссия</th><th>Чистая сумма</th><th>Платежей</th><th>Средний %</th><th>Доля</th></tr></thead>
            <tbody>
              {rows.length ? rows.slice().sort((a, b) => b.commission - a.commission).map((row) => (
                <tr key={row.paymentType} className={row.paymentType === selectedRow?.paymentType ? styles.activeRow : ""} onClick={() => setSelectedPaymentType(row.paymentType)}>
                  <td>{row.paymentType}</td><td>{money(row.turnover)}</td><td>{money(row.commission)}</td><td>{money(row.netAmount)}</td><td>{row.paymentCount}</td><td>{percent(row.averageRate)}</td><td>{percent(row.shareOfTotalCommission)}</td>
                </tr>
              )) : <tr><td colSpan={7}>Нет данных за период.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
