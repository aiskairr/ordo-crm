"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  createExpense,
  deleteExpense,
  EXPENSE_CATEGORIES,
  getExpenses,
  updateExpense,
  type Expense,
  type ExpenseCategory,
  type ExpensePayload,
} from "../api/expenses-api";
import styles from "./expenses-page.module.css";

const categoryEntries = Object.entries(EXPENSE_CATEGORIES) as Array<[ExpenseCategory, (typeof EXPENSE_CATEGORIES)[ExpenseCategory]]>;

function today() {
  return new Date().toLocaleDateString("en-CA");
}

function currentMonthRange() {
  const date = new Date();
  return { dateFrom: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`, dateTo: today() };
}

function money(value: number) {
  return `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function emptyForm(): ExpensePayload {
  return {
    expenseDate: today(),
    category: "operational",
    subcategory: "",
    amount: "",
    branchName: "",
    paymentMethod: "",
    description: "",
  };
}

export function ExpensesPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const initialRange = useMemo(() => currentMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "">("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<ExpensePayload>(() => emptyForm());

  const expensesQuery = useQuery({
    queryKey: ["expenses", dateFrom, dateTo, categoryFilter],
    queryFn: () => getExpenses({ dateFrom, dateTo, category: categoryFilter }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }: { id?: string; payload: ExpensePayload }) => (id ? updateExpense(id, payload) : createExpense(payload)),
    onSuccess: async (_, variables) => {
      showToast({ tone: "success", title: variables.id ? "Расход обновлен" : "Расход сохранен" });
      setEditingId("");
      setForm(emptyForm());
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExpense,
    onSuccess: async () => {
      showToast({ tone: "success", title: "Расход удален" });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });

  useEffect(() => {
    if (expensesQuery.error) showToast({ tone: "error", title: "Не удалось загрузить расходы", description: getErrorText(expensesQuery.error) });
  }, [expensesQuery.error, showToast]);

  useEffect(() => {
    if (saveMutation.error) showToast({ tone: "error", title: "Не удалось сохранить расход", description: getErrorText(saveMutation.error) });
  }, [saveMutation.error, showToast]);

  useEffect(() => {
    if (deleteMutation.error) showToast({ tone: "error", title: "Не удалось удалить расход", description: getErrorText(deleteMutation.error) });
  }, [deleteMutation.error, showToast]);

  const expenses = expensesQuery.data ?? [];
  const query = normalize(search);
  const rows = query
    ? expenses.filter((item) => normalize(`${item.subcategory} ${item.description} ${item.branchName} ${item.paymentMethod}`).includes(query))
    : expenses;
  const total = rows.reduce((sum, item) => sum + item.amount, 0);

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setForm({
      expenseDate: expense.expenseDate,
      category: expense.category,
      subcategory: expense.subcategory,
      amount: String(expense.amount),
      branchName: expense.branchName,
      paymentMethod: expense.paymentMethod,
      description: expense.description,
    });
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Финансовый контроль</p>
          <h1>Расходы</h1>
          <span>Фиксируйте затраты отдельно от продаж, чтобы видеть реальный расход бизнеса.</span>
        </div>
        <button type="button" onClick={() => { setEditingId(""); setForm(emptyForm()); }}>
          <Plus size={17} /> Новый расход
        </button>
      </header>

      <section className={styles.editor}>
        <div className={styles.sectionHead}>
          <div><p>{editingId ? "Редактирование" : "Новая запись"}</p><h2>{editingId ? "Редактировать расход" : "Добавить расход"}</h2></div>
          {editingId ? <button type="button" onClick={() => { setEditingId(""); setForm(emptyForm()); }}>Отменить</button> : null}
        </div>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate({ id: editingId || undefined, payload: form });
          }}
        >
          <label><span>Дата</span><input type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} required /></label>
          <label><span>Вид расхода</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseCategory })}>{categoryEntries.map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
          <label><span>Статья</span><input value={form.subcategory} onChange={(event) => setForm({ ...form, subcategory: event.target.value })} list="expense-subcategories" required /></label>
          <datalist id="expense-subcategories">{EXPENSE_CATEGORIES[form.category].examples.map((item) => <option key={item} value={item} />)}</datalist>
          <label><span>Сумма, сом</span><input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label>
          <label><span>Филиал</span><select value={form.branchName} onChange={(event) => setForm({ ...form, branchName: event.target.value })}><option value="">Общий расход</option><option>Аю-Гранд</option><option>Беш-Сары</option></select></label>
          <label><span>Способ оплаты</span><select value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}><option value="">Не указан</option><option>Наличными</option><option>QR / перевод</option><option>Расчетный счет</option><option>Корпоративная карта</option></select></label>
          <label className={styles.description}><span>Описание</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Кому и за что заплатили" /></label>
          <button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Сохраняю..." : editingId ? "Сохранить изменения" : "Сохранить расход"}</button>
        </form>
        <p className={styles.hint}>{EXPENSE_CATEGORIES[form.category].hint}</p>
      </section>

      <section className={styles.filters}>
        <label><span>С даты</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>По дату</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <label><span>Вид</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as ExpenseCategory | "")}><option value="">Все виды</option>{categoryEntries.map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        <label><span>Поиск</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Статья, описание или филиал" /></label>
        <button type="button" onClick={() => { const range = currentMonthRange(); setDateFrom(range.dateFrom); setDateTo(range.dateTo); }}>Этот месяц</button>
        <button type="button" onClick={() => window.print()}><Printer size={16} /> Печать</button>
      </section>

      <section className={styles.summary}>
        <article className={styles.total}><span>Всего расходов</span><strong>{money(total)}</strong><small>{rows.length} записей</small></article>
        {categoryEntries.map(([key, item]) => (
          <article key={key}><span>{item.label}</span><strong>{money(rows.filter((row) => row.category === key).reduce((sum, row) => sum + row.amount, 0))}</strong></article>
        ))}
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.sectionHead}>
          <div><h2>Журнал расходов</h2><p>{expensesQuery.isLoading ? "Загрузка..." : `${dateFrom} - ${dateTo} · ${rows.length} записей`}</p></div>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Дата</th><th>Вид</th><th>Статья</th><th>Филиал</th><th>Оплата</th><th>Описание</th><th>Автор</th><th>Сумма</th><th></th></tr></thead>
            <tbody>
              {rows.length ? rows.map((item) => (
                <tr key={item.id}>
                  <td>{item.expenseDate}</td><td><span className={styles.badge}>{EXPENSE_CATEGORIES[item.category].label}</span></td><td><strong>{item.subcategory}</strong></td><td>{item.branchName || "Общий"}</td><td>{item.paymentMethod || "-"}</td><td>{item.description || "-"}</td><td>{item.createdBy || "-"}</td><td><strong>{money(item.amount)}</strong></td>
                  <td><div className={styles.actions}><button type="button" onClick={() => startEdit(item)}><Pencil size={15} /></button><button type="button" onClick={() => window.confirm(`Удалить расход "${item.subcategory}"?`) && deleteMutation.mutate(item.id)}><Trash2 size={15} /></button></div></td>
                </tr>
              )) : <tr><td colSpan={9}>За выбранный период расходов нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
