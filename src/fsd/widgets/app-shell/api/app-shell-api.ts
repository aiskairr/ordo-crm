import type { CrmRole } from "@/src/fsd/entities/user";
import { apiClient } from "@/src/fsd/shared/api";
import { normalizeUiSettings, type UiSettings } from "../model/ui-settings";

export type ShellSessionUser = {
  id: string;
  name: string;
  login: string;
  role: CrmRole;
  position: string;
  branches: string[];
  permissions: string[];
  moySkladEmployeeHref?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function asRole(value: unknown): CrmRole {
  const roles: CrmRole[] = ["admin", "owner", "manager", "seller", "logistics", "accountant", "employee"];
  return roles.includes(value as CrmRole) ? (value as CrmRole) : "employee";
}

function normalizeSessionUser(value: unknown): ShellSessionUser {
  const record = asRecord(value);
  return {
    id: asString(record.id),
    name: asString(record.name),
    login: asString(record.login),
    role: asRole(record.role),
    position: asString(record.position),
    branches: asStringArray(record.branches),
    permissions: asStringArray(record.permissions),
    moySkladEmployeeHref: asString(record.moySkladEmployeeHref ?? record.moysklad_employee_href) || undefined,
  };
}

export async function getShellSession() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/session"));
  return {
    user: payload.user ? normalizeSessionUser(payload.user) : null,
  };
}

export async function logoutCrm() {
  return apiClient<{ ok?: boolean }>("/api/crm/logout", {
    method: "POST",
  });
}

export async function getUiSettings() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/ui-settings"));
  return normalizeUiSettings(payload.settings);
}

export async function saveUiSettings(settings: UiSettings) {
  const payload = asRecord(
    await apiClient<unknown>("/api/crm/ui-settings", {
      method: "PUT",
      body: settings,
    }),
  );
  return normalizeUiSettings({ ...asRecord(payload.settings), ...settings });
}
