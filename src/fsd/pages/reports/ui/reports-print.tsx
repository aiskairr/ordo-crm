import { Fragment } from "react";
import type { ReportRow, ReportType } from "../api/reports-api";
import styles from "./reports-page.module.css";

type ReportTotals = {
  documents: number;
  amount: number;
  paid: number;
  unpaid: number;
  commission?: number;
  netProfit: number;
};

type PrintMode = "report" | "receipt" | "waybill" | null;

type PaymentSummaryRow = {
  name: string;
  amount: number;
};

type ReportsPrintProps = {
  mode: PrintMode;
  row: ReportRow | null;
  rows: ReportRow[];
  totals: ReportTotals;
  canViewProfit: boolean;
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  reportTitle: string;
};

const money = (value: number) =>
  `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
const qty = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value || 0);
const dateTime = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(date);
};
const dateOnly = (value: string) => {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${value}T00:00:00`));
};

function parsePaymentBreakdown(text: string, fallbackPaymentType: string, amount: number) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = lines
    .map((line) => {
      if (/^тип оплаты/i.test(line)) return null;
      const match = line.match(/^([^:]+):\s*(-?\d[\d\s.,]*)\s*сом/i);
      if (!match) return null;
      const lineAmount = Number(match[2].replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(lineAmount)) return null;
      return { name: match[1].trim(), amount: lineAmount };
    })
    .filter((item): item is PaymentSummaryRow => Boolean(item));

  if (parsed.length) return parsed;
  return fallbackPaymentType ? [{ name: fallbackPaymentType, amount }] : [];
}

function buildPaymentSummary(rows: ReportRow[]) {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const entries = parsePaymentBreakdown(row.comment, row.paymentType, row.amount);
    for (const entry of entries) {
      byName.set(entry.name, (byName.get(entry.name) ?? 0) + entry.amount);
    }
  }
  return [...byName.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((left, right) => right.amount - left.amount);
}

function displayProducts(row: ReportRow) {
  if (row.products.length) return row.products;
  return [{ index: 0, code: "", name: row.productText || "Товар", quantity: 1, price: row.amount, sum: row.amount, isGift: false }];
}

function ReceiptPrint({ row }: { row: ReportRow }) {
  const products = displayProducts(row);
  return (
    <div className={styles.receiptSheet}>
      <h1>ТОВАРНЫЙ ЧЕК</h1>
      <div className={styles.receiptCenter}>{row.organizationName || "Организация"}</div>
      <div className={styles.receiptLine} />
      <div className={styles.receiptRow}><span>Документ:</span><b>№ {row.name || "-"}</b></div>
      <div className={styles.receiptRow}><span>Дата:</span><b>{dateTime(row.moment)}</b></div>
      <div className={styles.receiptRow}><span>Склад:</span><b>{row.storeName || "-"}</b></div>
      <div className={styles.receiptRow}><span>Кассир:</span><b>{row.employeeName || "-"}</b></div>
      <div className={styles.receiptRow}><span>Покупатель:</span><b>{row.customerName || "-"}</b></div>
      <div className={styles.receiptLine} />
      <div className={styles.receiptItems}>
        {products.map((product, index) => (
          <div className={styles.receiptItem} key={`${product.code}-${product.name}-${index}`}>
            <div className={styles.receiptItemName}>{index + 1}. {product.name}</div>
            <div className={styles.receiptItemCalc}>
              <span>{product.isGift ? "ПОДАРОК" : `${money(product.price)} x ${qty(product.quantity)}`}</span>
              <b>{product.isGift ? money(0) : money(product.sum)}</b>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.receiptLine} />
      <div className={styles.receiptTotal}><span>ИТОГО</span><b>{money(row.amount)}</b></div>
      <div className={styles.receiptRow}><span>Тип оплаты:</span><b>{row.paymentType || "-"}</b></div>
      <div className={styles.receiptRow}><span>Оплачено:</span><b>{money(row.paid)}</b></div>
      {row.unpaid > 0 ? <div className={styles.receiptRow}><span>Не оплачено:</span><b>{money(row.unpaid)}</b></div> : null}
      {row.comment ? <div className={styles.receiptComment}>{row.comment}</div> : null}
      <div className={styles.receiptLine} />
      <div className={styles.receiptCount}>Позиций: {products.length}</div>
      <div className={styles.receiptThanks}>Спасибо за покупку!</div>
      <div className={styles.receiptCut} />
    </div>
  );
}

function WaybillPrint({ row }: { row: ReportRow }) {
  const products = displayProducts(row);
  return (
    <div className={styles.waybillSheet}>
      <h1>Расходная накладная № {row.name || "-"} от {dateOnly(row.moment.slice(0, 10))}</h1>
      <p><strong>Поставщик:</strong> {row.organizationName || "________________"}</p>
      <p><strong>Имя покупателя:</strong> {row.customerName || "________________"}</p>
      <p><strong>Номер телефона:</strong> {row.customerPhone || "________________"}</p>
      <p><strong>Адрес покупателя:</strong> {row.customerAddress || "________________"}</p>
      <p><strong>Склад:</strong> {row.storeName || "________________"}</p>
      <p><strong>Сотрудник:</strong> {row.employeeName || "________________"}</p>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Код</th>
            <th>Наименование</th>
            <th>Цена</th>
            <th>Кол-во</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => (
            <tr key={`${product.code}-${product.name}-${index}`}>
              <td>{index + 1}</td>
              <td>{product.code || "-"}</td>
              <td>{product.name}</td>
              <td>{product.isGift ? "Подарок" : money(product.price)}</td>
              <td>{qty(product.quantity)}</td>
              <td>{product.isGift ? money(0) : money(product.sum)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Итого</td>
            <td>{money(row.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <div className={styles.waybillSummary}>
        <p>Всего наименований {products.length}, на сумму {money(row.amount)}</p>
        <p>Тип оплаты: {row.paymentType || "-"}</p>
        <p>Оплачено: {money(row.paid)}{row.unpaid > 0 ? `, не оплачено: ${money(row.unpaid)}` : ""}</p>
      </div>
      <div className={styles.waybillSignatures}>
        <div><span>Отпустил</span><b>{row.employeeName || "________________"}</b></div>
        <div><span>Получил</span><b>________________</b></div>
      </div>
    </div>
  );
}

function ReportPrint({ rows, totals, canViewProfit, reportTitle, dateFrom, dateTo }: Omit<ReportsPrintProps, "mode" | "row" | "reportType">) {
  const paymentSummary = buildPaymentSummary(rows);
  const productNameColSpan = canViewProfit ? 3 : 4;
  const totalColSpan = canViewProfit ? 8 : 9;

  return (
    <div className={styles.printSheet}>
      <h1>{reportTitle}</h1>
      <p>Период: {dateOnly(dateFrom)} - {dateOnly(dateTo)}</p>

      {paymentSummary.length ? (
        <section className={styles.printPaymentSummary}>
          <h2>Оплата по банкам и способам</h2>
          <div className={styles.printPaymentList}>
            {paymentSummary.map((item) => (
              <p key={item.name}><span>{item.name}</span><strong>{money(item.amount)}</strong></p>
            ))}
          </div>
        </section>
      ) : null}

      <table>
        <thead>
          <tr className={styles.printHeadMain}>
            <th>Номер</th>
            <th>Время</th>
            <th>Сумма</th>
            <th>Склад</th>
            <th colSpan={2}>Организация</th>
            <th colSpan={2}>Контрагент</th>
            <th>Сотрудник</th>
            {canViewProfit ? <th>Прибыль</th> : null}
            <th colSpan={2}>Комментарий</th>
          </tr>
          <tr className={styles.printHeadSub}>
            <th>Код</th>
            <th colSpan={productNameColSpan}>Наименование товара</th>
            <th>Цена</th>
            <th>Кол-во</th>
            <th>Сумма</th>
            <th>Тип оплаты</th>
            <th>Оплачено</th>
            <th>Не оплачено</th>
            <th>Документ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const products = displayProducts(row);
            return (
              <Fragment key={row.id}>
                <tr className={styles.reportDocumentRow}>
                  <td>{row.name || "-"}</td>
                  <td>{dateTime(row.moment)}</td>
                  <td>{money(row.amount)}</td>
                  <td>{row.storeName || "-"}</td>
                  <td colSpan={2}>{row.organizationName || "-"}</td>
                  <td colSpan={2}>{row.customerName || "-"}</td>
                  <td>{row.employeeName || "-"}</td>
                  {canViewProfit ? <td>{money(row.netProfit)}</td> : null}
                  <td colSpan={2}>{row.comment || row.paymentType || "-"}</td>
                </tr>
                {products.map((product, index) => (
                  <tr className={styles.reportProductRow} key={`${row.id}-${product.code}-${index}`}>
                    <td>{product.code || "-"}</td>
                    <td colSpan={productNameColSpan}>{product.name}</td>
                    <td>{product.isGift ? "Подарок" : money(product.price)}</td>
                    <td>{qty(product.quantity)}</td>
                    <td>{product.isGift ? money(0) : money(product.sum)}</td>
                    <td>{row.paymentType || "-"}</td>
                    <td>{money(row.paid)}</td>
                    <td>{money(row.unpaid)}</td>
                    <td>{row.typeLabel}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Итого</td>
            <td>{money(totals.amount)}</td>
            <td colSpan={totalColSpan}></td>
            {canViewProfit ? <td>{money(totals.netProfit)}</td> : null}
            <td>{money(totals.unpaid)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function ReportsPrint({ mode, row, rows, totals, canViewProfit, reportTitle, dateFrom, dateTo }: ReportsPrintProps) {
  const printClassName = mode === "receipt" ? `${styles.printReport} ${styles.receiptPrintReport}` : styles.printReport;
  return (
    <section className={printClassName} aria-hidden={mode ? "false" : "true"}>
      {mode === "report" ? (
        <ReportPrint rows={rows} totals={totals} canViewProfit={canViewProfit} reportTitle={reportTitle} dateFrom={dateFrom} dateTo={dateTo} />
      ) : null}
      {mode === "receipt" && row ? <ReceiptPrint row={row} /> : null}
      {mode === "waybill" && row ? <WaybillPrint row={row} /> : null}
    </section>
  );
}
