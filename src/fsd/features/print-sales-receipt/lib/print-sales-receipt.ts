import type { SalesReceiptData } from "../model/types";
import { buildSalesReceiptHtml } from "./receipt-html";

export function printSalesReceipt(data: SalesReceiptData) {
  const popup = window.open("", "_blank", "width=420,height=760");
  if (!popup) throw new Error("Браузер заблокировал окно печати.");

  popup.document.open();
  popup.document.write(buildSalesReceiptHtml(data));
  popup.document.close();
}
