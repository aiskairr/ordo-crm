import type { CrmRole } from "@/src/fsd/entities/user";
import type { AttendanceSelfie } from "@/src/fsd/features/attendance-selfie";
import { apiClient } from "@/src/fsd/shared/api";

export type AttendanceUser = {
  id: string;
  name: string;
  login?: string;
  role: CrmRole;
  branches: string[];
  permissions: string[];
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  checkInTime: string;
  checkOutTime: string;
  checkInDistanceMeters: number | null;
  checkOutDistanceMeters: number | null;
  totalWorkMinutes: number;
  currentWorkMinutes: number;
  lateMinutes: number;
  status: "open" | "closed";
  source?: "geo" | "wifi" | "admin";
  autoClosed?: boolean;
};

export type AttendanceStore = {
  id: string;
  name: string;
  branch: string;
  address: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
};

export type AttendanceEvent = {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  type: string;
  distanceMeters: number | null;
  success: boolean;
  reason: string;
  createdAt: string;
};

export type AttendanceStatus = {
  status: "working" | "not_working";
  openRecord: AttendanceRecord | null;
  dayStatus: {
    code: string;
    kind: string;
    label: string;
    workingDay: boolean;
    workEndsAt: string;
  };
  now: string;
};

export type AttendanceNetworkStatus = {
  configured: boolean;
  allowed: boolean;
  clientIp: string;
  branchKey: string;
  branchName: string;
  storeId: string;
  message: string;
};

export type AttendanceNetworkSettings = {
  ayu: string[];
  besh: string[];
  updatedAt: string;
  currentIp: string;
};

export type AttendanceBranchSchedule = {
  key: string;
  label: string;
  workStartsAt: string;
  workEndsAt: string;
  workDays: number[];
};

export type AttendanceCalendarKind = "present" | "late" | "absent" | "holiday" | "day_off" | "leave" | "short_day" | "delivery";

export type AttendanceCalendarEntry = {
  id: string;
  kind: AttendanceCalendarKind;
  dateFrom: string;
  dateTo: string;
  userId: string;
  storeId: string;
  title: string;
  workEndsAt: string;
  createdAt: string;
  createdBy: string;
};

export type EmployeePayment = {
  id: string;
  employeeId: string;
  employeeName: string;
  paymentType: "advance" | "salary";
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  comment: string;
  status: "paid" | "cancelled";
  createdBy: string;
  createdAt: string;
};

export type AttendanceReport = {
  rows: AttendanceRecord[];
  events: AttendanceEvent[];
  stores: AttendanceStore[];
  users: AttendanceUser[];
  managementUsers: AttendanceUser[];
  calendar: AttendanceCalendarEntry[];
  payments: EmployeePayment[];
  totals: {
    records: number;
    open: number;
    failedAttempts: number;
    totalWorkMinutes: number;
    lateMinutes: number;
  };
  schedule: {
    workStartsAt: string;
    workEndsAt: string;
    branches: AttendanceBranchSchedule[];
  };
};

export type AttendanceScanResult = {
  ok: boolean;
  action: "check_in" | "check_out";
  message: string;
  status: AttendanceStatus["status"];
  record: AttendanceRecord;
  store: AttendanceStore;
  distanceMeters: number;
};

export type AttendanceSchedulePayload = {
  workStartsAt: string;
  workEndsAt: string;
  branches?: AttendanceBranchSchedule[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asNullableNumber(value: unknown) {
  return value === null || value === undefined || value === "" ? null : asNumber(value);
}

function asRole(value: unknown): CrmRole {
  const roles: CrmRole[] = ["admin", "owner", "manager", "seller", "logistics", "accountant", "employee"];
  return roles.includes(value as CrmRole) ? (value as CrmRole) : "employee";
}

function normalizeUser(value: unknown): AttendanceUser {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    login: asString(record.login),
    role: asRole(record.role),
    branches: asArray(record.branches).map(String),
    permissions: asArray(record.permissions).map(String),
  };
}

function normalizeRecord(value: unknown): AttendanceRecord {
  const record = asRecord(value);
  const status = record.status === "open" ? "open" : "closed";
  const source = record.source === "admin" ? "admin" : record.source === "wifi" ? "wifi" : record.source === "geo" ? "geo" : undefined;

  return {
    id: asString(record.id),
    userId: asString(record.userId),
    userName: asString(record.userName),
    storeId: asString(record.storeId),
    storeName: asString(record.storeName),
    checkInTime: asString(record.checkInTime),
    checkOutTime: asString(record.checkOutTime),
    checkInDistanceMeters: asNullableNumber(record.checkInDistanceMeters),
    checkOutDistanceMeters: asNullableNumber(record.checkOutDistanceMeters),
    totalWorkMinutes: asNumber(record.totalWorkMinutes),
    currentWorkMinutes: asNumber(record.currentWorkMinutes ?? record.totalWorkMinutes),
    lateMinutes: asNumber(record.lateMinutes),
    status,
    source,
    autoClosed: asBoolean(record.autoClosed),
  };
}

function normalizeStore(value: unknown): AttendanceStore {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    branch: asString(record.branch),
    address: asString(record.address),
    latitude: asNumber(record.latitude),
    longitude: asNumber(record.longitude),
    allowedRadiusMeters: asNumber(record.allowedRadiusMeters, 10),
  };
}

function normalizeEvent(value: unknown): AttendanceEvent {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    userId: asString(record.userId),
    userName: asString(record.userName),
    storeId: asString(record.storeId),
    storeName: asString(record.storeName),
    type: asString(record.type),
    distanceMeters: asNullableNumber(record.distanceMeters),
    success: asBoolean(record.success),
    reason: asString(record.reason),
    createdAt: asString(record.createdAt),
  };
}

function normalizeCalendarEntry(value: unknown): AttendanceCalendarEntry {
  const record = asRecord(value);
  const kinds: AttendanceCalendarKind[] = ["present", "late", "absent", "holiday", "day_off", "leave", "short_day", "delivery"];
  const kind = kinds.includes(record.kind as AttendanceCalendarKind) ? record.kind as AttendanceCalendarKind : "day_off";
  return {
    id: asString(record.id),
    kind,
    dateFrom: asString(record.dateFrom),
    dateTo: asString(record.dateTo),
    userId: asString(record.userId),
    storeId: asString(record.storeId),
    title: asString(record.title),
    workEndsAt: asString(record.workEndsAt),
    createdAt: asString(record.createdAt),
    createdBy: asString(record.createdBy),
  };
}

function normalizeEmployeePayment(value: unknown): EmployeePayment {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    employeeId: asString(record.employeeId),
    employeeName: asString(record.employeeName),
    paymentType: record.paymentType === "salary" ? "salary" : "advance",
    amount: asNumber(record.amount),
    paymentDate: asString(record.paymentDate),
    paymentMethod: asString(record.paymentMethod),
    comment: asString(record.comment),
    status: record.status === "cancelled" ? "cancelled" : "paid",
    createdBy: asString(record.createdBy),
    createdAt: asString(record.createdAt),
  };
}

export async function getCrmSession() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/session"));
  const user = payload.user ? normalizeUser(payload.user) : null;
  return { user };
}

export async function getAttendanceStatus(): Promise<AttendanceStatus> {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/status"));
  const dayStatus = asRecord(payload.dayStatus);
  return {
    status: payload.status === "working" ? "working" : "not_working",
    openRecord: payload.openRecord ? normalizeRecord(payload.openRecord) : null,
    dayStatus: {
      code: asString(dayStatus.code),
      kind: asString(dayStatus.kind, "workday"),
      label: asString(dayStatus.label, "Рабочий день"),
      workingDay: asBoolean(dayStatus.workingDay, true),
      workEndsAt: asString(dayStatus.workEndsAt),
    },
    now: asString(payload.now),
  };
}

export async function getAttendanceNetworkStatus(): Promise<AttendanceNetworkStatus> {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/network-status"));
  return {
    configured: asBoolean(payload.configured),
    allowed: asBoolean(payload.allowed),
    clientIp: asString(payload.clientIp),
    branchKey: asString(payload.branchKey),
    branchName: asString(payload.branchName),
    storeId: asString(payload.storeId),
    message: asString(payload.message),
  };
}

export async function getAttendanceNetworkSettings(): Promise<AttendanceNetworkSettings> {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/network-settings"));
  const settings = asRecord(payload.settings);
  return {
    ayu: asArray(settings.ayu).map(String),
    besh: asArray(settings.besh).map(String),
    updatedAt: asString(settings.updatedAt),
    currentIp: asString(payload.currentIp),
  };
}

export async function saveAttendanceNetworkSettings(input: { ayu: string[]; besh: string[] }) {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/network-settings", {
    method: "PUT",
    body: input,
  }));
  const settings = asRecord(payload.settings);
  return {
    ayu: asArray(settings.ayu).map(String),
    besh: asArray(settings.besh).map(String),
    updatedAt: asString(settings.updatedAt),
    currentIp: "",
  } satisfies AttendanceNetworkSettings;
}

export async function openAttendanceShift(selfie: AttendanceSelfie): Promise<AttendanceScanResult> {
  const payload = asRecord(
    await apiClient<unknown>("/api/attendance/open", {
      method: "POST",
      body: { selfie },
    }),
  );

  return {
    ok: asBoolean(payload.ok),
    action: payload.action === "check_out" ? "check_out" : "check_in",
    message: asString(payload.message),
    status: payload.status === "working" ? "working" : "not_working",
    record: normalizeRecord(payload.record),
    store: normalizeStore(payload.store),
    distanceMeters: asNumber(payload.distanceMeters),
  };
}

export async function closeAttendanceShift(selfie: AttendanceSelfie): Promise<AttendanceScanResult> {
  const payload = asRecord(
    await apiClient<unknown>("/api/attendance/close", {
      method: "POST",
      body: { selfie },
    }),
  );

  return {
    ok: asBoolean(payload.ok),
    action: "check_out",
    message: asString(payload.message),
    status: payload.status === "working" ? "working" : "not_working",
    record: normalizeRecord(payload.record),
    store: normalizeStore(payload.store),
    distanceMeters: asNumber(payload.distanceMeters),
  };
}

export async function getAttendanceReport(params: {
  dateFrom: string;
  dateTo: string;
  userId?: string;
  storeId?: string;
}): Promise<AttendanceReport> {
  const searchParams = new URLSearchParams({
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
  if (params.userId) searchParams.set("user_id", params.userId);
  if (params.storeId) searchParams.set("store_id", params.storeId);

  const payload = asRecord(await apiClient<unknown>(`/api/attendance/reports?${searchParams.toString()}`));
  const totals = asRecord(payload.totals);

  return {
    rows: asArray(payload.rows).map(normalizeRecord),
    events: asArray(payload.events).map(normalizeEvent),
    stores: asArray(payload.stores).map(normalizeStore),
    users: asArray(payload.users).map(normalizeUser),
    managementUsers: asArray(payload.managementUsers).map(normalizeUser),
    calendar: asArray(payload.calendar).map(normalizeCalendarEntry),
    payments: asArray(payload.payments).map(normalizeEmployeePayment),
    totals: {
      records: asNumber(totals.records),
      open: asNumber(totals.open),
      failedAttempts: asNumber(totals.failedAttempts),
      totalWorkMinutes: asNumber(totals.totalWorkMinutes),
      lateMinutes: asNumber(totals.lateMinutes),
    },
    schedule: {
      workStartsAt: asString(payload.workStartsAt ?? asRecord(payload.schedule).workStartsAt, "09:00"),
      workEndsAt: asString(payload.workEndsAt ?? asRecord(payload.schedule).workEndsAt, "18:00"),
      branches: asArray(asRecord(payload.schedule).branches).map((branch) => {
        const record = asRecord(branch);
        return {
          key: asString(record.key),
          label: asString(record.label),
          workStartsAt: asString(record.workStartsAt, "09:00"),
          workEndsAt: asString(record.workEndsAt, "18:00"),
          workDays: asArray(record.workDays).map(Number).filter((day) => day >= 1 && day <= 7),
        };
      }),
    },
  };
}

export async function createAttendanceAdvance(input: {
  employeeId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  comment: string;
}) {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/payments", {
    method: "POST",
    body: input,
  }));
  return normalizeEmployeePayment(payload.payment);
}

export async function saveAttendanceSchedule(payload: AttendanceSchedulePayload) {
  const response = asRecord(
    await apiClient<unknown>("/api/attendance/schedule", {
      method: "PUT",
      body: payload,
    }),
  );
  const schedule = asRecord(response.schedule);
  return {
    workStartsAt: asString(schedule.workStartsAt ?? response.workStartsAt, payload.workStartsAt),
    workEndsAt: asString(schedule.workEndsAt ?? response.workEndsAt, payload.workEndsAt),
    branches: asArray(schedule.branches).map((branch) => {
      const record = asRecord(branch);
      return {
        key: asString(record.key),
        label: asString(record.label),
        workStartsAt: asString(record.workStartsAt, payload.workStartsAt),
        workEndsAt: asString(record.workEndsAt, payload.workEndsAt),
        workDays: asArray(record.workDays).map(Number).filter((day) => day >= 1 && day <= 7),
      };
    }),
  };
}

export async function createAttendanceCalendarEntry(input: {
  kind: AttendanceCalendarKind;
  dateFrom: string;
  dateTo: string;
  userId: string;
  storeId: string;
  title: string;
  workEndsAt: string;
  scope?: "employee" | "all";
}) {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/calendar", { method: "POST", body: input }));
  return normalizeCalendarEntry(payload.entry);
}

export async function deleteAttendanceCalendarEntry(id: string) {
  return apiClient<{ ok: boolean }>(`/api/attendance/calendar/${encodeURIComponent(id)}`, { method: "DELETE" });
}
