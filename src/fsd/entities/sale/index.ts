export type PaymentType = "cash" | "bank" | "mixed";

export type SaleItem = {
  localId: string;
  productId?: number;
  name: string;
  quantity: number;
  price: number;
  isGift: boolean;
};

export type SaleDraft = {
  branchId: string;
  employeeId: string;
  retailStoreId: string;
  paymentType: PaymentType;
  cashAmount: number;
  bankAmount: number;
  customerMode: "retail" | "new" | "existing";
  customerId: string;
  customerName: string;
  customerFirstName: string;
  customerLastName: string;
  customerType: "individual" | "entrepreneur" | "legal";
  customerPhone: string;
  delivery: boolean;
  deliveryAddress: string;
  items: SaleItem[];
};
