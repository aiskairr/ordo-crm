import type { CrmRole } from "@/src/fsd/entities/user";
import { apiClient } from "@/src/fsd/shared/api";

export type LoginUser = {
  id: string;
  name: string;
  login?: string;
  role: CrmRole;
  position: string;
  passwordSet: boolean;
};

export type SessionUser = LoginUser & {
  branches: string[];
  permissions: string[];
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRole(value: unknown): CrmRole {
  const roles: CrmRole[] = ["admin", "owner", "manager", "seller", "logistics", "accountant", "employee"];
  return roles.includes(value as CrmRole) ? (value as CrmRole) : "employee";
}

function normalizeLoginUser(value: unknown): LoginUser {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    login: asString(record.login),
    role: asRole(record.role),
    position: asString(record.position),
    passwordSet: record.passwordSet === true,
  };
}

function normalizeSessionUser(value: unknown): SessionUser {
  const record = asRecord(value);
  return {
    ...normalizeLoginUser(value),
    branches: asArray(record.branches).map(String),
    permissions: asArray(record.permissions).map(String),
  };
}

export async function getLoginUsers() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/login-users"));
  return asArray(payload.users).map(normalizeLoginUser).filter((user) => user.id);
}

export async function getSession() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/session"));
  return {
    user: payload.user ? normalizeSessionUser(payload.user) : null,
  };
}

export async function loginCrm(input: { login: string; password: string }) {
  const payload = asRecord(
    await apiClient<unknown>("/api/crm/login", {
      method: "POST",
      body: input,
    }),
  );
  return normalizeSessionUser(payload.user);
}

export async function logoutCrm() {
  return apiClient<{ ok?: boolean }>("/api/crm/logout", {
    method: "POST",
  });
}
