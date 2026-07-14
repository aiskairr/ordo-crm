import { apiClient } from "@/src/fsd/shared/api";

export type DeliveryStatus = "new" | "assigned" | "in_transit" | "delivered" | "cancelled";

export type DeliveryItem = {
  name: string;
  quantity: number;
};

export type Delivery = {
  id: string;
  status: DeliveryStatus;
  scheduledAt: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  branchName: string;
  employeeName: string;
  notes: string;
  documentUrl: string;
  documentName: string;
  items: DeliveryItem[];
};

export type DeliveryFilters = {
  dateFrom: string;
  dateTo: string;
  status?: DeliveryStatus | "";
};

const statuses: DeliveryStatus[] = ["new", "assigned", "in_transit", "delivered", "cancelled"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeStatus(value: unknown): DeliveryStatus {
  return statuses.includes(value as DeliveryStatus) ? (value as DeliveryStatus) : "new";
}

function normalizeDeliveryItem(value: unknown): DeliveryItem {
  const record = asRecord(value);
  return {
    name: asString(record.name),
    quantity: asNumber(record.quantity),
  };
}

function normalizeDelivery(value: unknown): Delivery {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    status: normalizeStatus(record.status),
    scheduledAt: asString(record.scheduled_at ?? record.scheduledAt),
    customerName: asString(record.customer_name ?? record.customerName),
    customerPhone: asString(record.customer_phone ?? record.customerPhone),
    deliveryAddress: asString(record.delivery_address ?? record.deliveryAddress),
    branchName: asString(record.branch_name ?? record.branchName),
    employeeName: asString(record.employee_name ?? record.employeeName),
    notes: asString(record.notes),
    documentUrl: asString(record.document_url ?? record.documentUrl),
    documentName: asString(record.document_name ?? record.documentName),
    items: asArray(record.items).map(normalizeDeliveryItem),
  };
}

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  new: "Новая",
  assigned: "Назначена",
  in_transit: "В пути",
  delivered: "Доставлена",
  cancelled: "Отменена",
};

export async function getDeliveries(filters: DeliveryFilters) {
  const params = new URLSearchParams({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  });
  if (filters.status) params.set("status", filters.status);

  const payload = asRecord(await apiClient<unknown>(`/api/deliveries?${params.toString()}`));
  return asArray(payload.deliveries).map(normalizeDelivery).filter((delivery) => delivery.id);
}

export async function updateDeliveryStatus(input: { id: string; status: DeliveryStatus }) {
  const payload = asRecord(
    await apiClient<unknown>(`/api/deliveries/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      body: { status: input.status },
    }),
  );
  return normalizeDelivery(payload.delivery);
}
