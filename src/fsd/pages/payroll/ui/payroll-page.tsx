"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Eye, LoaderCircle, PlusCircle, Printer, RefreshCw } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  addPayrollExpense,
  getPayrollEmployeesReport,
  getPayrollReport,
  type PayrollReport,
  type PayrollRow,
} from "../api/payroll-api";
import styles from "./payroll-page.module.css";

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { dateFrom: localDate(start), dateTo: localDate(end) };
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value || 0);
}

function formatDate(value: string) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T00:00:00`)) : "-";
}

function formatDateTime(value: string) {
  return value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "-";
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
}

function displayPosition(row: PayrollRow) {
  return row.payroll.customPosition?.trim() || "Не указана";
}

function prorateSalary(monthlySalary: number, from: string, to: string) {
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let result = 0;
  while (current <= end) {
    const days = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
    result += Number(monthlySalary || 0) / days;
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return Math.round((result + Number.EPSILON) * 100) / 100;
}

function recalculateRows(rows: PayrollRow[], dateFrom: string, dateTo: string) {
  return rows.map((row) => {
    const config = row.payroll;
    const fixedSalary =
      config.enabled && ["salary", "salary_percent", "salary_category_bonus"].includes(config.scheme)
        ? prorateSalary(config.monthlySalary, dateFrom, dateTo)
        : 0;
    const source = config.percentBase === "profit" ? Math.max(0, row.profit) : Math.max(0, row.revenue);
    const commission =
      config.enabled && ["category_bonus", "salary_category_bonus"].includes(config.scheme)
        ? row.categoryBonus
        : config.enabled && ["percent", "salary_percent"].includes(config.scheme)
          ? Math.round((source * config.percent / 100 + Number.EPSILON) * 100) / 100
          : 0;

    return {
      ...row,
      fixedSalary,
      commission,
      totalSalary: Math.round((fixedSalary + commission + Number.EPSILON) * 100) / 100,
    };
  });
}

function calculateTotals(rows: PayrollRow[]) {
  return rows.reduce(
    (sum, row) => ({
      employees: sum.employees + (row.payroll.enabled ? 1 : 0),
      documents: sum.documents + row.documents,
      revenue: sum.revenue + row.revenue,
      profit: sum.profit + row.profit,
      fixedSalary: sum.fixedSalary + row.fixedSalary,
      commission: sum.commission + row.commission,
      totalSalary: sum.totalSalary + row.totalSalary,
      unassignedDocuments: sum.unassignedDocuments,
      unassignedRevenue: sum.unassignedRevenue,
    }),
    { employees: 0, documents: 0, revenue: 0, profit: 0, fixedSalary: 0, commission: 0, totalSalary: 0, unassignedDocuments: 0, unassignedRevenue: 0 },
  );
}

function mergeFullPayroll(currentReport: PayrollReport | null, fullReport: PayrollReport, dateFrom: string, dateTo: string) {
  const currentById = new Map((currentReport?.rows ?? []).map((row) => [row.id, row]));
  const fullRows = fullReport.rows.map((fullRow) => {
    const current = currentById.get(fullRow.id);
    if (current?.dirty) {
      return {
        ...fullRow,
        payroll: current.payroll,
        dirty: true,
        loadingSales: false,
      };
    }
    return { ...fullRow, loadingSales: false };
  });
  const recalculatedRows = recalculateRows(fullRows, dateFrom, dateTo);
  return {
    ...fullReport,
    rows: recalculatedRows,
    totals: {
      ...fullReport.totals,
      ...calculateTotals(recalculatedRows),
      unassignedDocuments: fullReport.totals.unassignedDocuments,
      unassignedRevenue: fullReport.totals.unassignedRevenue,
    },
  };
}

function buildSkeletonRows(count = 6): PayrollRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `skeleton-${index}`,
    href: "",
    name: "Загрузка...",
    payroll: {
      enabled: false,
      position: "other",
      customPosition: "",
      scheme: "salary_percent",
      monthlySalary: 0,
      percent: 0,
      percentBase: "revenue",
    },
    loadingSales: true,
    dirty: false,
    documents: 0,
    revenue: 0,
    profit: 0,
    categoryBonus: 0,
    sales: [],
    fixedSalary: 0,
    commission: 0,
    totalSalary: 0,
  }));
}

export function PayrollPage() {
  const { showToast } = useToast();
  const initialRange = useMemo(() => monthRange(0), []);
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [report, setReport] = useState<PayrollReport | null>(null);
  const [statusText, setStatusText] = useState("Подготовка к загрузке...");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFullLoading, setIsFullLoading] = useState(false);
  const [fullLoadError, setFullLoadError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const isCalculating = isInitialLoading || isFullLoading;

  const rows = useMemo(() => recalculateRows(report?.rows ?? [], dateFrom, dateTo), [report?.rows, dateFrom, dateTo]);
  const totals = useMemo(() => {
    const calculated = calculateTotals(rows);
    return {
      ...calculated,
      unassignedDocuments: report?.totals.unassignedDocuments ?? 0,
      unassignedRevenue: report?.totals.unassignedRevenue ?? 0,
    };
  }, [report?.totals.unassignedDocuments, report?.totals.unassignedRevenue, rows]);

  const expenseMutation = useMutation({
    mutationFn: () =>
      addPayrollExpense({
        expenseDate: dateTo,
        amount: totals.totalSalary,
        description: `Зарплата за период ${formatDate(dateFrom)} - ${formatDate(dateTo)}. Сотрудников в расчете: ${totals.employees}.`,
      }),
    onSuccess: () => showToast({ tone: "success", title: "Зарплата добавлена в расходы" }),
    onError: (error) => showToast({ tone: "error", title: "Не удалось добавить расход", description: getErrorText(error) }),
  });

  const loadPayroll = async () => {
    const generation = ++loadGeneration.current;
    setIsInitialLoading(true);
    setIsFullLoading(false);
    setFullLoadError(null);
    setStatusText("Загружаю сотрудников...");
    setReport({
      dateFrom,
      dateTo,
      partial: true,
      rows: buildSkeletonRows(),
      totals: { employees: 0, documents: 0, revenue: 0, profit: 0, fixedSalary: 0, commission: 0, totalSalary: 0, unassignedDocuments: 0, unassignedRevenue: 0 },
    });

    try {
      const partial = await getPayrollEmployeesReport({ dateFrom, dateTo });
      if (generation !== loadGeneration.current) return;

      const partialRows = recalculateRows(partial.rows, dateFrom, dateTo);
      setReport({
        ...partial,
        rows: partialRows,
        totals: {
          ...partial.totals,
          ...calculateTotals(partialRows),
        },
      });
      setIsInitialLoading(false);
      setIsFullLoading(true);
      setStatusText("Сотрудники загружены. Догружаю продажи из МойСклад...");

      try {
        const full = await getPayrollReport({ dateFrom, dateTo });
        if (generation !== loadGeneration.current) return;
        setReport((current) => mergeFullPayroll(current, full, dateFrom, dateTo));
        setIsFullLoading(false);
        setStatusText("Расчет зарплат готов.");
      } catch (error) {
        if (generation !== loadGeneration.current) return;
        setIsFullLoading(false);
        setFullLoadError(getErrorText(error));
        setStatusText("Сотрудники загружены, но продажи догрузить не удалось.");
      }
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      setIsInitialLoading(false);
      setIsFullLoading(false);
      setReport(null);
      showToast({ tone: "error", title: "Не удалось загрузить зарплаты", description: getErrorText(error) });
      setStatusText("Ошибка загрузки.");
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPayroll();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const query = normalize(search);
  const visibleRows = query
    ? rows.filter((row) => normalize(`${row.name} ${displayPosition(row)}`).includes(query))
    : rows;
  const selectedEmployee = rows.find((row) => row.id === selectedEmployeeId) ?? null;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Финансы персонала</p>
          <h1>Зарплаты</h1>
          <span>Сначала показываем сотрудников, потом в фоне догружаем продажи и пересчитываем выплаты.</span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => window.print()}>
            <Printer size={17} /> Печать ведомости
          </button>
        </div>
      </header>

      <section className={styles.filters}>
        <label><span>С даты</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>По дату</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Поиск</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Сотрудник или должность" /></label>
        <button type="button" onClick={() => { const range = monthRange(0); setDateFrom(range.dateFrom); setDateTo(range.dateTo); }}>Этот месяц</button>
        <button type="button" onClick={() => { const range = monthRange(-1); setDateFrom(range.dateFrom); setDateTo(range.dateTo); }}>Прошлый месяц</button>
        <button type="button" onClick={loadPayroll} disabled={isCalculating}>
          {isCalculating ? <LoaderCircle size={16} className={styles.spin} /> : <RefreshCw size={16} />}
          {isCalculating ? "Рассчитываю..." : "Рассчитать"}
        </button>
      </section>

      <section className={styles.summary}>
        <article className={styles.total}><span>К выплате</span><strong>{money(totals.totalSalary)}</strong><small>{number(totals.employees)} сотрудников</small></article>
        <article><span>Выручка</span><strong>{money(totals.revenue)}</strong></article>
        <article><span>Оклад за период</span><strong>{money(totals.fixedSalary)}</strong></article>
        <article><span>Бонусы и проценты</span><strong>{money(totals.commission)}</strong></article>
        <article><span>Продажи</span><strong>{number(totals.documents)}</strong></article>
      </section>

      <div className={styles.warning}>
        {isInitialLoading ? "Загружаю сотрудников..." : isFullLoading ? statusText : fullLoadError ? `${statusText} ${fullLoadError}` : statusText}
      </div>

      {totals.unassignedDocuments ? (
        <div className={styles.warning}>
          Без сотрудника: {number(totals.unassignedDocuments)} продаж на {money(totals.unassignedRevenue)}.
        </div>
      ) : null}

      <section className={styles.tablePanel}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Сотрудники</h2>
            <p>{formatDate(dateFrom)} - {formatDate(dateTo)} · {visibleRows.length} строк</p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (totals.totalSalary <= 0) return showToast({ tone: "error", title: "Сумма зарплаты равна нулю" });
              if (window.confirm(`Добавить ${money(totals.totalSalary)} в расходы?`)) expenseMutation.mutate();
            }}
            disabled={expenseMutation.isPending}
          >
            <PlusCircle size={17} /> Добавить в расходы
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th><th>Должность</th><th>Продажи</th><th>Выручка</th><th>Прибыль</th><th>Оклад</th><th>Бонус/процент</th><th>К выплате</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.id} className={!row.payroll.enabled ? styles.disabledRow : ""}>
                  <td>
                    <div className={styles.employeeCell}>
                      <span>
                        <strong>{row.name}</strong>
                        <small>{row.loadingSales ? "Догружаю продажи..." : row.payroll.enabled ? "Участвует" : "Выключен"}</small>
                      </span>
                    </div>
                  </td>
                  <td>{displayPosition(row)}</td>
                  <td>
                    <button className={styles.detailButton} type="button" disabled={row.loadingSales || row.id.startsWith("skeleton-")} onClick={() => setSelectedEmployeeId(row.id)}>
                      {row.loadingSales ? <LoaderCircle size={15} className={styles.spin} /> : <Eye size={15} />} {number(row.documents)}
                    </button>
                  </td>
                  <td>{row.loadingSales ? "..." : money(row.revenue)}</td>
                  <td>{row.loadingSales ? "..." : money(row.profit)}</td>
                  <td>{money(row.fixedSalary)}</td>
                  <td>{row.loadingSales ? "..." : money(row.commission)}</td>
                  <td><strong>{row.loadingSales ? "..." : money(row.totalSalary)}</strong></td>
                </tr>
              ))}
              {!visibleRows.length ? <tr><td colSpan={8}>{isInitialLoading ? "Загрузка..." : "Сотрудники не найдены."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedEmployee ? (
        <div className={styles.modal} onClick={() => setSelectedEmployeeId("")}>
          <section className={styles.salesModal} onClick={(event) => event.stopPropagation()}>
            <header>
              <div><h2>{selectedEmployee.name}</h2><p>{formatDate(dateFrom)} - {formatDate(dateTo)} · {selectedEmployee.sales.length} документов · {money(selectedEmployee.revenue)}</p></div>
              <button type="button" onClick={() => setSelectedEmployeeId("")}>Закрыть</button>
            </header>
            <div className={styles.salesList}>
              {selectedEmployee.sales.length ? selectedEmployee.sales.map((sale) => (
                <article key={sale.id}>
                  <div className={styles.saleHead}>
                    <div><span>{sale.typeLabel || "Документ"} № {sale.name}</span><strong>{formatDateTime(sale.moment)}</strong></div>
                    <div><span>{sale.customerName || "Розничный покупатель"} · {money(sale.amount)}</span><strong className={sale.netProfit < 0 ? styles.negative : ""}>Прибыль: {money(sale.netProfit)}</strong></div>
                    {sale.webUrl ? <a href={sale.webUrl} target="_blank" rel="noreferrer">МойСклад</a> : null}
                  </div>
                  <div className={styles.products}>
                    {sale.products.map((product, index) => <span key={`${sale.id}-${index}`}><b>{product.code || "-"}</b>{product.name} · {number(product.quantity)} шт · {money(product.sum)}</span>)}
                  </div>
                </article>
              )) : <p>У сотрудника нет продаж за выбранный период.</p>}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
