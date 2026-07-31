import type { SalesReceiptData } from "../model/types";

const receiptOrganization = "ИП Матаев Женишбек Камилович";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value: unknown) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(finiteNumber(value));
}

function formatQuantity(value: unknown) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 3,
  }).format(finiteNumber(value));
}

function formatRussianDateTime(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}\s/.test(value) ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function field(label: string, value: string) {
  return `<div class="field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function totalRow(label: string, value: string, className = "") {
  return `<div class="total-row ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function buildSalesReceiptHtml(data: SalesReceiptData) {
  const isReturn = data.receiptKind === "return";
  const documentNumber = data.documentNumber.trim() || "-";
  const items = data.items.map((item, index) => {
    const calculation = item.isGift
      ? "ПОДАРОК"
      : `${formatMoney(item.price)} x ${formatQuantity(item.quantity)}`;
    const lineTotal = item.isGift ? "0,00" : formatMoney(item.lineTotal);
    return `
      <section class="receipt-item">
        <div class="item-name">${index + 1}. ${escapeHtml(item.name || "Товар")}</div>
        <div class="item-calculation"><span>${escapeHtml(calculation)}</span><strong>${escapeHtml(lineTotal)}</strong></div>
      </section>`;
  }).join("");

  const loyaltyRedemption = finiteNumber(data.loyaltyRedemption);
  const unpaidAmount = finiteNumber(data.unpaidAmount);
  const accruedBonuses = finiteNumber(data.accruedBonuses);
  const bonusBalance = data.bonusBalance == null ? 0 : finiteNumber(data.bonusBalance);

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${isReturn ? "Возвратный" : "Товарный"} чек ${documentNumber}`)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body {
        width: 72mm;
        min-width: 72mm;
        min-height: 0;
        height: auto;
        margin: 0;
        padding: 0;
        overflow: visible;
        background: #fff;
        color: #000;
        font-family: "Courier New", Courier, monospace;
        font-size: 11px;
        line-height: 1.3;
      }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .receipt { width: 72mm; max-width: 72mm; margin: 0; padding: 0; }
      .title { margin: 0 0 2mm; font-size: 18px; line-height: 1.1; font-weight: 900; text-align: center; }
      .organization { font-weight: 700; text-align: center; overflow-wrap: anywhere; }
      .separator { height: 0; margin: 2.2mm 0; border-top: 1px dashed #000; }
      .field, .total-row, .item-calculation {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 3mm;
      }
      .field { margin: 0 0 1mm; }
      .field span, .total-row span { flex: 0 0 auto; }
      .field strong, .total-row strong, .item-calculation strong { text-align: right; overflow-wrap: anywhere; }
      .receipt-item {
        margin: 0 0 2.2mm;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .receipt-item:last-child { margin-bottom: 0; }
      .item-name { margin-bottom: .8mm; font-weight: 700; overflow-wrap: anywhere; }
      .item-calculation span { min-width: 0; overflow-wrap: anywhere; }
      .total-row { margin: 0 0 1mm; }
      .grand-total { margin: 2mm 0; font-size: 15px; line-height: 1.2; font-weight: 900; }
      .grand-total span { white-space: nowrap; }
      .center { text-align: center; }
      .thanks { margin-top: 2mm; font-size: 13px; font-weight: 900; text-align: center; }
      .cut-space { height: 12mm; }
      .print-toolbar { width: 72mm; margin: 0 0 4mm; text-align: center; }
      .print-button { border: 1px solid #000; border-radius: 4px; padding: 8px 14px; background: #fff; color: #000; font: 700 13px Arial, sans-serif; cursor: pointer; }
      @media print {
        html, body, .receipt { width: 72mm; max-width: 72mm; }
        .print-toolbar { display: none !important; }
      }
      @page {
        size: 80mm auto;
        margin: 4mm;
      }
    </style>
  </head>
  <body>
    <div class="print-toolbar"><button class="print-button" type="button" onclick="window.print()">Распечатать</button></div>
    <main class="receipt">
      <h1 class="title">${isReturn ? "ВОЗВРАТНЫЙ ЧЕК" : "ТОВАРНЫЙ ЧЕК"}</h1>
      <div class="organization">${escapeHtml(receiptOrganization)}</div>
      <div class="separator"></div>
      ${field("Документ:", `№ ${documentNumber}`)}
      ${isReturn && data.sourceDocumentNumber ? field("Исходный документ:", `№ ${data.sourceDocumentNumber}`) : ""}
      ${field("Дата:", formatRussianDateTime(data.dateTime))}
      ${field("Склад:", data.storeName || "-")}
      ${field("Кассир:", data.employeeName || "-")}
      ${field("Покупатель:", data.customerName || "Розничный покупатель")}
      <div class="separator"></div>
      <div class="receipt-items">${items}</div>
      <div class="separator"></div>
      ${totalRow(isReturn ? "Сумма возврата:" : "Сумма товаров:", `${formatMoney(data.baseTotal)} сом`)}
      ${!isReturn && loyaltyRedemption > 0 ? totalRow("Бонусами:", `−${formatMoney(loyaltyRedemption)} сом`) : ""}
      ${totalRow(isReturn ? "К ВОЗВРАТУ —" : "К ОПЛАТЕ —", `${formatMoney(data.finalTotal)} сом`, "grand-total")}
      ${field("Тип оплаты:", data.paymentType || "-")}
      ${field(isReturn ? "Возвращено:" : "Оплачено:", `${formatMoney(data.paidAmount)} сом`)}
      ${!isReturn && unpaidAmount > 0 ? field("Не оплачено:", `${formatMoney(unpaidAmount)} сом`) : ""}
      ${!isReturn && accruedBonuses > 0 ? field("Бонусы начислено:", formatMoney(accruedBonuses)) : ""}
      ${!isReturn && bonusBalance > 0 ? field("Баланс бонусов:", formatMoney(bonusBalance)) : ""}
      <div class="separator"></div>
      <div class="center">Позиций: ${data.items.length}</div>
      <div class="thanks">${isReturn ? "ВОЗВРАТ ОФОРМЛЕН" : "Спасибо за покупку!"}</div>
      <div class="cut-space" aria-hidden="true"></div>
    </main>
    <script>
      window.addEventListener("load", function () {
        window.requestAnimationFrame(function () { window.print(); });
      });
    </script>
  </body>
</html>`;
}
