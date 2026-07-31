export type SalesReceiptItem = {
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
  isGift: boolean;
};

export type SalesReceiptData = {
  receiptKind?: "sale" | "return";
  documentNumber: string;
  sourceDocumentNumber?: string;
  dateTime: string;
  storeName: string;
  employeeName: string;
  customerName: string;
  items: SalesReceiptItem[];
  baseTotal: number;
  loyaltyRedemption?: number;
  finalTotal: number;
  paymentType: string;
  paidAmount: number;
  unpaidAmount?: number;
  accruedBonuses?: number;
  bonusBalance?: number | null;
};
