import { apiClient } from "@/src/fsd/shared/api";
import type { CrmRole, CrmUser, CrmUserCreate, CrmUserUpdate } from "@/src/fsd/entities/user";
import { normalizePayrollConfig, type PayrollConfig } from "@/src/fsd/entities/payroll";

type UnknownRecord = Record<string, unknown>;
type MoySkladRemovalStatus = NonNullable<CrmUser["moySkladRemoval"]>["status"];

export type EmployeeDeletionImpact = {
  counts: {
    demand: number;
    retaildemand: number;
  };
  total: number;
  unconfigured: string[];
};

export type EmployeeReassignmentResult = {
  completed: boolean;
  processed: number;
  remaining: number;
  impact: EmployeeDeletionImpact;
  finalizationFailed: boolean;
  moySkladRemoval?: {
    status: MoySkladRemovalStatus;
    reason?: string;
  };
};

export type ArchivedCrmEmployee = {
  id: string;
  href: string;
  name: string;
  description: string;
  branchIds: string[];
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asBoolean(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function asRole(value: unknown): CrmRole {
  const roles: CrmRole[] = ["admin", "owner", "manager", "seller", "logistics", "accountant", "employee"];
  return roles.includes(value as CrmRole) ? (value as CrmRole) : "employee";
}

function normalizeUser(value: unknown): CrmUser {
  const record = asRecord(value);

  return {
    id: asString(record.id),
    name: asString(record.name),
    login: asString(record.login),
    position: asString(record.position ?? record.jobTitle),
    salary: asNumber(record.salary),
    role: asRole(record.role),
    branches: asStringArray(record.branches ?? record.branchIds),
    permissions: asStringArray(record.permissions ?? record.sections),
    active: asBoolean(record.active ?? record.isActive),
    passwordSet: asBoolean(record.passwordSet, false),
    moySkladEmployeeHref: asString(record.moySkladEmployeeHref ?? record.moysklad_employee_href),
    moySkladRemoval: record.moySkladRemoval && typeof record.moySkladRemoval === "object"
      ? {
          status: asString(asRecord(record.moySkladRemoval).status) as MoySkladRemovalStatus,
          reason: asString(asRecord(record.moySkladRemoval).reason),
        }
      : undefined,
  };
}

function normalizeUsers(payload: unknown) {
  const record = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(record.users) ? record.users : [];

  return list.map(normalizeUser).filter((user) => user.id);
}

export async function getCrmUsers() {
  return normalizeUsers(await apiClient<unknown>("/api/crm/users"));
}

export async function getEmployeePayrollSettings() {
  const response = asRecord(await apiClient<unknown>("/api/payroll/employees"));
  const rows = Array.isArray(response.rows) ? response.rows : [];
  return rows.map((value) => {
    const row = asRecord(value);
    return {
      employeeHref: asString(row.href),
      payroll: normalizePayrollConfig(row.payroll),
    };
  }).filter((item) => item.employeeHref);
}

export async function saveEmployeePayrollSettings(employeeHref: string, payroll: PayrollConfig) {
  const response = asRecord(await apiClient<unknown>("/api/payroll/employees/config", {
    method: "POST",
    body: { employees: [{ employeeHref, payroll }] },
  }));
  const result = Array.isArray(response.results) ? asRecord(response.results[0]) : {};
  if (!asBoolean(result.ok, false)) {
    throw new Error(asString(result.error, "Не удалось сохранить настройки зарплаты."));
  }
  return response;
}

export async function updateCrmUser(id: string, payload: CrmUserUpdate) {
  const response = await apiClient<unknown>(`/api/crm/users/${id}`, {
      method: "PUT",
      body: payload,
    });
  return normalizeUser(asRecord(response).user ?? response);
}

export async function createCrmUser(payload: CrmUserCreate) {
  const response = await apiClient<unknown>("/api/crm/users", {
    method: "POST",
    body: payload,
  });
  return normalizeUser(asRecord(response).user ?? response);
}

export async function syncCrmUsersFromMoySklad() {
  const response = asRecord(await apiClient<unknown>("/api/crm/users/sync-moysklad", {
    method: "POST",
  }));
  return {
    createdIds: asStringArray(response.createdIds),
    linkedIds: asStringArray(response.linkedIds),
    deactivatedIds: asStringArray(response.deactivatedIds),
    activeEmployees: asNumber(response.activeEmployees),
    skippedDeleted: asNumber(response.skippedDeleted),
  };
}

export async function deleteCrmUser(id: string) {
  const response = await apiClient<unknown>(`/api/crm/users/${id}`, {
    method: "DELETE",
  });
  const record = asRecord(response);
  return {
    ok: true,
    user: record.user ? normalizeUser(record.user) : null,
    moySkladRemoval: record.moySkladRemoval && typeof record.moySkladRemoval === "object"
      ? {
          status: asString(asRecord(record.moySkladRemoval).status) as NonNullable<CrmUser["moySkladRemoval"]>["status"],
          reason: asString(asRecord(record.moySkladRemoval).reason),
        }
      : undefined,
  };
}

function normalizeDeletionImpact(value: unknown): EmployeeDeletionImpact {
  const record = asRecord(value);
  const counts = asRecord(record.counts);
  return {
    counts: {
      demand: asNumber(counts.demand),
      retaildemand: asNumber(counts.retaildemand),
    },
    total: asNumber(record.total),
    unconfigured: asStringArray(record.unconfigured),
  };
}

export async function getCrmUserDeletionImpact(id: string) {
  return normalizeDeletionImpact(await apiClient<unknown>(`/api/crm/users/${id}/deletion-impact`));
}

export async function reassignAndDeleteCrmUser(id: string, targetUserId: string, batchSize = 5): Promise<EmployeeReassignmentResult> {
  const response = asRecord(await apiClient<unknown>(`/api/crm/users/${id}/reassign-and-delete`, {
    method: "POST",
    body: { targetUserId, batchSize },
    timeoutMs: 60_000,
  }));
  const removal = asRecord(response.moySkladRemoval);
  return {
    completed: asBoolean(response.completed, false),
    processed: asNumber(response.processed),
    remaining: asNumber(response.remaining),
    impact: normalizeDeletionImpact(response.impact),
    finalizationFailed: asBoolean(response.finalizationFailed, false),
    moySkladRemoval: response.moySkladRemoval && typeof response.moySkladRemoval === "object"
      ? {
          status: asString(removal.status) as MoySkladRemovalStatus,
          reason: asString(removal.reason),
        }
      : undefined,
  };
}

function normalizeArchivedEmployee(value: unknown): ArchivedCrmEmployee {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    href: asString(record.href),
    name: asString(record.name),
    description: asString(record.description),
    branchIds: asStringArray(record.branchIds),
  };
}

export async function getArchivedCrmEmployees() {
  const response = asRecord(await apiClient<unknown>("/api/crm/users/archived-moysklad"));
  const employees = Array.isArray(response.employees) ? response.employees : [];
  return employees.map(normalizeArchivedEmployee).filter((employee) => employee.href);
}

export async function restoreArchivedCrmEmployee(employeeHref: string) {
  return apiClient<unknown>("/api/crm/users/archived-moysklad", {
    method: "POST",
    body: { employeeHref },
    timeoutMs: 60_000,
  });
}
