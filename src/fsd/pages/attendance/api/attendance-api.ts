import type { CrmRole } from "@/src/fsd/entities/user";
import { apiClient } from "@/src/fsd/shared/api";

export type AttendanceUser = {
  id: string;
  name: string;
  login?: string;
  role: CrmRole;
  branches: string[];
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
  source?: "geo" | "admin";
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
  now: string;
};

export type AttendanceBranchSchedule = {
  key: string;
  label: string;
  workStartsAt: string;
  workEndsAt: string;
};

export type AttendanceReport = {
  rows: AttendanceRecord[];
  events: AttendanceEvent[];
  stores: AttendanceStore[];
  users: AttendanceUser[];
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

export type AttendanceStorePayload = {
  name: string;
  branch: string;
  address: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
};

export type AttendanceShiftPayload = {
  storeId: string;
  latitude: number;
  longitude: number;
  deviceInfo: string;
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
  };
}

function normalizeRecord(value: unknown): AttendanceRecord {
  const record = asRecord(value);
  const status = record.status === "open" ? "open" : "closed";
  const source = record.source === "admin" ? "admin" : record.source === "geo" ? "geo" : undefined;

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

export async function getCrmSession() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/session"));
  const user = payload.user ? normalizeUser(payload.user) : null;
  return { user };
}

export async function getAttendanceStatus(): Promise<AttendanceStatus> {
  const payload = asRecord(await apiClient<unknown>("/api/attendance/status"));
  return {
    status: payload.status === "working" ? "working" : "not_working",
    openRecord: payload.openRecord ? normalizeRecord(payload.openRecord) : null,
    now: asString(payload.now),
  };
}

export async function openAttendanceShift(input: AttendanceShiftPayload): Promise<AttendanceScanResult> {
  const payload = asRecord(
    await apiClient<unknown>("/api/attendance/open", {
      method: "POST",
      body: input,
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

export async function closeAttendanceShift(input: AttendanceShiftPayload): Promise<AttendanceScanResult> {
  const payload = asRecord(
    await apiClient<unknown>("/api/attendance/close", {
      method: "POST",
      body: input,
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
        };
      }),
    },
  };
}

export async function saveAttendanceStore(payload: AttendanceStorePayload & { id?: string }) {
  const response = asRecord(
    await apiClient<unknown>(payload.id ? `/api/attendance/stores/${payload.id}` : "/api/attendance/stores", {
      method: payload.id ? "PUT" : "POST",
      body: payload,
    }),
  );
  return normalizeStore(response.store);
}

export async function deleteAttendanceStore(storeId: string) {
  await apiClient<unknown>(`/api/attendance/stores/${storeId}`, {
    method: "DELETE",
  });
  return storeId;
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
      };
    }),
  };
}

export async function adminOpenAttendanceShift(input: { userId: string; storeId: string }) {
  const response = asRecord(
    await apiClient<unknown>("/api/attendance/admin-open", {
      method: "POST",
      body: input,
    }),
  );
  return normalizeRecord(response.record);
}

export async function manualAttendanceMark(input: { userId: string; storeId: string; action: "check_in" | "check_out"; timestamp: string }) {
  const response = asRecord(
    await apiClient<unknown>("/api/attendance/manual", {
      method: "POST",
      body: input,
    }),
  );
  return normalizeRecord(response.record);
}
