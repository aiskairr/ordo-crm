import type { PaymentType, SaleDraft, SaleItem } from "@/src/fsd/entities/sale";

const DRAFT_KEY = "ordo-crm:sale-draft";

export const emptyDraft: SaleDraft = {
  branchId: "",
  employeeId: "",
  retailStoreId: "",
  paymentType: "cash",
  cashAmount: 0,
  bankAmount: 0,
  customerMode: "retail",
  customerId: "",
  customerName: "",
  customerPhone: "",
  delivery: false,
  deliveryAddress: "",
  items: [],
};

export function createSaleItem(input: Omit<SaleItem, "localId">): SaleItem {
  return {
    ...input,
    localId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  };
}

export function calculateItemsTotal(items: SaleItem[]) {
  return items.reduce((sum, item) => {
    if (item.isGift) {
      return sum;
    }

    return sum + item.quantity * item.price;
  }, 0);
}

export function paymentLabel(paymentType: PaymentType) {
  const labels: Record<PaymentType, string> = {
    cash: "Наличные",
    bank: "Банк",
    mixed: "Смешанная",
  };

  return labels[paymentType];
}

export function loadDraft(): SaleDraft {
  if (typeof window === "undefined") {
    return emptyDraft;
  }

  try {
    const value = window.localStorage.getItem(DRAFT_KEY);
    return value ? { ...emptyDraft, ...JSON.parse(value) } : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(draft: SaleDraft) {
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function clearDraft() {
  window.localStorage.removeItem(DRAFT_KEY);
}
