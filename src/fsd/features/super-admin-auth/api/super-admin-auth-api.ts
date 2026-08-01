import { apiClient } from "@/src/fsd/shared/api";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export type SuperAdminSession = {
  login: string;
  expiresAt: string;
};

function normalizeSession(value: unknown): SuperAdminSession | null {
  const row = asRecord(value);
  const login = asString(row.login);
  const expiresAt = asString(row.expiresAt);
  return login && expiresAt ? { login, expiresAt } : null;
}

export async function getSuperAdminSession() {
  const payload = asRecord(await apiClient<unknown>("/api/super-admin/session"));
  return {
    authenticated: payload.authenticated === true,
    session: normalizeSession(payload.session),
  };
}

export async function loginSuperAdmin(input: { login: string; password: string }) {
  const payload = asRecord(await apiClient<unknown>("/api/super-admin/login", {
    method: "POST",
    body: input,
  }));
  return {
    authenticated: payload.authenticated === true,
    session: normalizeSession(payload.session),
  };
}

export async function logoutSuperAdmin() {
  return apiClient<{ ok: boolean }>("/api/super-admin/logout", { method: "POST" });
}
