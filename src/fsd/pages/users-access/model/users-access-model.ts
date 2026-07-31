import type { CrmRole, CrmUser } from "@/src/fsd/entities/user";

export const BRANCHES = {
  ayu: "Аю-Гранд",
  besh: "Беш-Сары",
} as const;

export const PERMISSIONS = {
  sales: "Продажи",
  debtSale: "Продажа в долг",
  deliveries: "Доставки",
  attendance: "Посещаемость",
  reports: "Отчетность",
  bankCommissions: "Банковские комиссии",
  reportProfit: "Показывать прибыль в отчетности",
  editDocumentPrices: "Возможность менять цены документа",
  expenses: "Расходы",
  payroll: "Зарплаты",
  commercialDocuments: "Счета юрлицам",
  reconciliation: "Акт сверки",
  whatsappBroadcast: "WhatsApp рассылка",
  priceFormula: "Расчет цен",
  customsCalculator: "Калькулятор таможни",
  audit: "Журнал действий",
  users: "Сотрудники и доступ",
  about: "О системе",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type BranchKey = keyof typeof BRANCHES;

export const ROLE_DEFAULT_PERMISSIONS: Record<CrmRole, PermissionKey[]> = {
  admin: Object.keys(PERMISSIONS) as PermissionKey[],
  owner: Object.keys(PERMISSIONS) as PermissionKey[],
  manager: ["sales", "debtSale", "deliveries", "attendance", "reports", "reportProfit", "editDocumentPrices", "expenses", "payroll", "commercialDocuments", "reconciliation", "whatsappBroadcast", "customsCalculator", "bankCommissions", "about"],
  seller: ["sales", "debtSale", "deliveries", "attendance", "reports", "commercialDocuments", "about"],
  logistics: ["sales", "debtSale", "deliveries", "attendance", "commercialDocuments", "about"],
  accountant: ["attendance", "reports", "expenses", "payroll", "reconciliation", "priceFormula", "customsCalculator", "bankCommissions", "about"],
  employee: ["attendance", "about"],
};

const ADMIN_ROLES: CrmRole[] = ["admin", "owner"];
const REPORT_PROFIT_ROLES: CrmRole[] = ["admin", "owner", "manager", "accountant"];
const DOCUMENT_PRICE_EDIT_ROLES: CrmRole[] = ["admin", "owner", "manager"];
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export type UsersAccessDraft = CrmUser & {
  password: string;
  passwordVisible: boolean;
};

export function normalizeLogin(login: string) {
  return String(login || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60);
}

export function normalizePermissions(role: CrmRole, permissions: string[]) {
  if (ADMIN_ROLES.includes(role)) {
    return [...ROLE_DEFAULT_PERMISSIONS[role]];
  }
  const allowed = new Set(Object.keys(PERMISSIONS));
  const normalized = [...new Set((permissions || []).map(String).filter((permission) => allowed.has(permission)))];
  if (!REPORT_PROFIT_ROLES.includes(role)) {
    return normalized.filter((permission) => permission !== "reportProfit" && permission !== "editDocumentPrices");
  }
  return DOCUMENT_PRICE_EDIT_ROLES.includes(role)
    ? normalized
    : normalized.filter((permission) => permission !== "editDocumentPrices");
}

export function toUserDraft(user: CrmUser): UsersAccessDraft {
  return {
    ...user,
    branches: user.branches.length ? user.branches : ["ayu"],
    permissions: normalizePermissions(user.role, user.permissions),
    password: "",
    passwordVisible: false,
  };
}

export function filterUsers(users: CrmUser[], search: string, role: "all" | CrmRole) {
  const normalizedSearch = search.trim().toLowerCase();
  return users.filter((user) => {
    const matchesRole = role === "all" || user.role === role;
    const matchesSearch = !normalizedSearch || [user.name, user.login, user.position].some((field) => field.toLowerCase().includes(normalizedSearch));
    return matchesRole && matchesSearch;
  });
}

export function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "U").slice(0, 2);
}

export function isReportProfitAllowed(role: CrmRole) {
  return REPORT_PROFIT_ROLES.includes(role);
}

export function isDocumentPriceEditAllowed(role: CrmRole) {
  return DOCUMENT_PRICE_EDIT_ROLES.includes(role);
}

export function arePermissionsLocked(role: CrmRole) {
  return ADMIN_ROLES.includes(role);
}

export function canEditUser(actor: Pick<CrmUser, "id" | "role"> | null, user: CrmUser) {
  if (!actor) return false;
  if (actor.role !== "admin" && user.role === "admin") return false;
  return true;
}

export function canDeleteUser(actor: Pick<CrmUser, "id" | "role"> | null, user: CrmUser) {
  if (!actor) return false;
  if (actor.id === user.id) return false;
  if (user.role === "admin" || user.role === "owner") return false;
  if (user.role === "manager" && actor.role !== "admin") return false;
  return true;
}

export function canGrantReportProfit(actor: Pick<CrmUser, "role"> | null, role: CrmRole, currentPermissions: string[]) {
  if (!isReportProfitAllowed(role)) return false;
  if (actor?.role === "admin") return true;
  return currentPermissions.includes("reportProfit");
}

export function getNextPermissionsForRole(
  actor: Pick<CrmUser, "role"> | null,
  role: CrmRole,
  currentPermissions: string[],
  hadCustomPermissions: boolean,
) {
  if (ADMIN_ROLES.includes(role)) return [...ROLE_DEFAULT_PERMISSIONS[role]];
  const base = hadCustomPermissions ? normalizePermissions(role, currentPermissions) : [...ROLE_DEFAULT_PERMISSIONS[role]];
  if (!canGrantReportProfit(actor, role, currentPermissions)) {
    return base.filter((permission) => permission !== "reportProfit");
  }
  return base;
}

export function generatePassword() {
  const values = new Uint32Array(10);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]).join("");
}

export async function copyPassword(password: string) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(password);
    return true;
  } catch {
    return false;
  }
}

export function formatMoySkladRemoval(result?: CrmUser["moySkladRemoval"]) {
  if (!result) return "неизвестно";
  if (result.status === "deleted") return "удален";
  if (result.status === "archived") return "архивирован";
  if (result.status === "not_found") return "не найден";
  return result.reason ? `пропущен: ${result.reason}` : "пропущен";
}
