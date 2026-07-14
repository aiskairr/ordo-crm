import { apiClient } from "@/src/fsd/shared/api";
import type { CrmRole, CrmUser, CrmUserUpdate } from "@/src/fsd/entities/user";

type UnknownRecord = Record<string, unknown>;
type MoySkladRemovalStatus = NonNullable<CrmUser["moySkladRemoval"]>["status"];

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

export async function updateCrmUser(id: string, payload: CrmUserUpdate) {
  const response = await apiClient<unknown>(`/api/crm/users/${id}`, {
      method: "PUT",
      body: payload,
    });
  return normalizeUser(asRecord(response).user ?? response);
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
