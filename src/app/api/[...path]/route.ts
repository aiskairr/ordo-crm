import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;
type CrmRole = "admin" | "owner" | "manager" | "seller" | "logistics" | "accountant" | "employee";

type CrmUser = {
  id: string;
  name: string;
  login: string;
  position: string;
  salary: number;
  role: CrmRole;
  branches: string[];
  permissions: string[];
  active: boolean;
  passwordHash: string;
};

type UiSettings = {
  theme?: string;
  mode?: string;
  sidebarColor?: string;
  accentColor?: string;
  density?: string;
  confirmBeforeSubmit?: boolean;
  focusProductSearch?: boolean;
  stickySummary?: boolean;
};

type Expense = {
  id: string;
  expenseDate: string;
  category: string;
  subcategory: string;
  amount: number;
  branchName: string;
  paymentMethod: string;
  description: string;
  createdBy: string;
};

type Delivery = {
  id: string;
  documentId?: string;
  documentType?: string;
  documentName?: string;
  documentUrl?: string;
  scheduledAt?: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  branchName: string;
  employeeName?: string;
  items?: Array<{ name: string; quantity: number }>;
  status: string;
  amount: number;
  notes: string;
};

type AttendanceStore = {
  id: string;
  name: string;
  branch: string;
  address: string;
  latitude: number;
  longitude: number;
  allowedRadiusMeters: number;
};

type AttendanceRecord = {
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
};

type AttendanceBranchSchedule = {
  key: string;
  label: string;
  workStartsAt: string;
  workEndsAt: string;
};

type AttendanceSchedule = {
  workStartsAt: string;
  workEndsAt: string;
  branches: AttendanceBranchSchedule[];
};

type OrderProduct = {
  code: string;
  name: string;
  quantity: number;
  price: number;
  sum: number;
  isGift: boolean;
};

type LocalOrder = {
  id: string;
  type: "retaildemand" | "demand";
  name: string;
  moment: string;
  amount: number;
  paid: number;
  unpaid: number;
  netProfit: number;
  branchName: string;
  storeName: string;
  customerName: string;
  customerPhone: string;
  customerType: "individual" | "legal" | "entrepreneur";
  employeeName: string;
  paymentType: string;
  comment: string;
  products: OrderProduct[];
};

const CUSTOMS_HISTORY_TABLE = "customs_calculator_history";
const LEGACY_BACKEND_URL = String(process.env.LEGACY_BACKEND_URL || "").trim().replace(/\/$/, "");

type PaymentOption = {
  id: string;
  href?: string;
  name: string;
  provider?: string;
  months?: number;
  rate: number;
  comment: string;
};

type RetailStoreOption = {
  id: string;
  href: string;
  name: string;
  storeHref: string;
  storeName: string;
};

type AppData = {
  users: CrmUser[];
  sessions: Record<string, string>;
  uiSettings: Record<string, UiSettings>;
  expenses: Expense[];
  deliveries: Delivery[];
  attendanceStores: AttendanceStore[];
  attendanceRecords: AttendanceRecord[];
  attendanceSchedule: AttendanceSchedule;
  customsHistory: JsonRecord[];
  orders: LocalOrder[];
};

const permissions = [
  "sales",
  "debtSale",
  "deliveries",
  "attendance",
  "reports",
  "bankCommissions",
  "reportProfit",
  "expenses",
  "payroll",
  "commercialDocuments",
  "reconciliation",
  "whatsappBroadcast",
  "priceFormula",
  "customsCalculator",
  "audit",
  "users",
  "about",
];

const rolePermissions: Record<CrmRole, string[]> = {
  admin: permissions,
  owner: permissions,
  manager: ["sales", "debtSale", "deliveries", "attendance", "reports", "reportProfit", "expenses", "payroll", "commercialDocuments", "reconciliation", "whatsappBroadcast", "customsCalculator", "bankCommissions", "about"],
  seller: ["sales", "debtSale", "deliveries", "attendance", "reports", "commercialDocuments", "about"],
  logistics: ["sales", "debtSale", "deliveries", "attendance", "commercialDocuments", "about"],
  accountant: ["attendance", "reports", "expenses", "payroll", "reconciliation", "priceFormula", "customsCalculator", "bankCommissions", "about"],
  employee: ["attendance", "about"],
};

const dataDir = process.env.ORDO_DATA_DIR || path.join(process.cwd(), ".ordo-data");
const dataFile = path.join(dataDir, "crm-data.json");

const branches = [
  { id: "ayu-grand", name: "Аю-Гранд", href: "ayu-grand" },
  { id: "besh-sary", name: "Беш-Сары", href: "besh-sary" },
  { id: "green", name: "Green", href: "green" },
];

const paymentTypes = [
  { id: "cash", name: "Наличными", provider: "cash", months: 1, rate: 0, comment: "Оплата наличными" },
  { id: "bakai-qr", name: "QR Bakai", provider: "bank", months: 1, rate: 0, comment: "Банковская оплата" },
  { id: "bank-asia-3", name: "Банк Азии (3 мес)", provider: "bank", months: 3, rate: 0.04, comment: "Рассрочка 3 месяца" },
  { id: "bank-asia-6", name: "Банк Азии (6 мес)", provider: "bank", months: 6, rate: 0.09, comment: "Рассрочка 6 месяцев" },
] satisfies PaymentOption[];

const MOYSKLAD_BASE_URL = "https://api.moysklad.ru/api/remap/1.2";
const PRICE_FORMULA_TEMPLATE_START = "[ORDO_PRICE_TEMPLATE]";
const PRICE_FORMULA_TEMPLATE_END = "[/ORDO_PRICE_TEMPLATE]";
const PAYROLL_CONFIG_START = "[ORDO_PAYROLL]";
const PAYROLL_CONFIG_END = "[/ORDO_PAYROLL]";
const RECONCILIATION_LIST_CACHE_TTL_MS = 120_000;
const RECONCILIATION_DETAILS_CACHE_TTL_MS = 120_000;
const RECONCILIATION_BATCH_SIZE = 100;
const PRODUCT_STOCK_CACHE_TTL_MS = 20_000;

const productStockCache = new Map<string, { value: number; createdAt: number }>();

type ReconciliationDocument = ReturnType<typeof mapMoySkladReportDocument>;
type ReconciliationDebtorAggregate = {
  id: string;
  href: string;
  name: string;
  customerType: string;
  customerTypeLabel: string;
  phone: string;
  inn: string;
  actualAddress: string;
  lastDocumentName: string;
  lastMoment: string;
  documentCount: number;
  paid: number;
  debt: number;
  amount: number;
};

type ReconciliationScanState = {
  createdAt: number;
  loadedAt: string;
  debtorsByKey: Map<string, ReconciliationDebtorAggregate>;
  scannedOffsets: Record<"retaildemand" | "demand", number>;
  completed: boolean;
  partial: boolean;
  truncated: boolean;
};

const reconciliationListCache = new Map<string, ReconciliationScanState>();
const reconciliationDetailsCache = new Map<string, { createdAt: number; value: JsonRecord }>();

const paymentRateRules: Record<string, Record<number, number>> = {
  "M+": { 3: 0.05, 6: 0.1, 12: 0.2 },
  "O!": { 3: 0.06, 6: 0.12, 12: 0.24 },
  "Банк Азии": { 3: 0.04, 6: 0.09, 12: 0.19 },
  Zero: { 3: 0, 6: 0, 12: 0 },
  Наличными: { 1: 0 },
  Долг: { 1: 0 },
};

function hashPassword(password: string) {
  return createHash("sha256").update(`ordo:${password}`).digest("hex");
}

function seedData(): AppData {
  return {
    users: [
      {
        id: "admin",
        name: "Сис.Админ",
        login: "admin",
        position: "Главный администратор",
        salary: 0,
        role: "admin",
        branches: branches.map((branch) => branch.id),
        permissions,
        active: true,
        passwordHash: hashPassword("admin"),
      },
      {
        id: "adil",
        name: "Адил",
        login: "adil",
        position: "Продавец",
        salary: 0,
        role: "seller",
        branches: ["ayu-grand"],
        permissions: ["sales", "attendance", "deliveries"],
        active: true,
        passwordHash: hashPassword("1234"),
      },
    ],
    sessions: {},
    uiSettings: {},
    expenses: [],
    deliveries: [],
    attendanceStores: [
      { id: "ayu-grand", name: "Аю-Гранд", branch: "Аю-Гранд", address: "Бишкек", latitude: 0, longitude: 0, allowedRadiusMeters: 100 },
      { id: "besh-sary", name: "Беш-Сары", branch: "Беш-Сары", address: "Бишкек", latitude: 0, longitude: 0, allowedRadiusMeters: 100 },
    ],
    attendanceRecords: [],
    attendanceSchedule: {
      workStartsAt: "09:00",
      workEndsAt: "18:00",
      branches: [
        { key: "ayu-grand", label: "Аю-Гранд", workStartsAt: "09:00", workEndsAt: "18:00" },
        { key: "besh-sary", label: "Беш-Сары", workStartsAt: "09:00", workEndsAt: "19:00" },
      ],
    },
    customsHistory: [],
    orders: [],
  };
}

async function readData(): Promise<AppData> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      ...seedData(),
      ...parsed,
      attendanceSchedule: normalizeAttendanceSchedule(parsed.attendanceSchedule),
    };
  } catch {
    const seeded = seedData();
    await writeData(seeded);
    return seeded;
  }
}

async function writeData(data: AppData) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(data, null, 2));
}

function slugifyAttendanceBranch(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-z0-9а-я-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAttendanceSchedule(value: Partial<AttendanceSchedule> | undefined): AttendanceSchedule {
  const fallback = seedData().attendanceSchedule;
  const branchesSource = Array.isArray(value?.branches) && value?.branches.length ? value.branches : fallback.branches;
  return {
    workStartsAt: asString(value?.workStartsAt, fallback.workStartsAt),
    workEndsAt: asString(value?.workEndsAt, fallback.workEndsAt),
    branches: branchesSource.map((branch) => ({
      key: asString(branch.key || branch.label, randomUUID()),
      label: asString(branch.label, "Филиал"),
      workStartsAt: asString(branch.workStartsAt, fallback.workStartsAt),
      workEndsAt: asString(branch.workEndsAt, fallback.workEndsAt),
    })),
  };
}

function json(payload: unknown, status = 200, cookie?: { name: string; value: string; maxAge?: number }) {
  const response = NextResponse.json(payload, { status });
  if (cookie) {
    response.cookies.set(cookie.name, cookie.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: cookie.maxAge,
    });
  }
  return response;
}

function shouldUseLegacyBackend(request: NextRequest, parts: string[]) {
  if (!LEGACY_BACKEND_URL) return false;
  if (request.headers.get("x-ordo-legacy-proxy") === "1") return false;

  const root = parts[0] || "";
  const localRoots = new Set([
    "status",
    "crm",
    "audit",
    "config",
    "employees",
    "retail-stores",
    "stores",
    "retail-shifts",
    "retail-fiscal-status",
    "retail-fiscalize",
    "payment-types",
    "products",
    "customers",
    "calculate",
    "orders",
    "reports",
    "report",
    "expenses",
    "deliveries",
    "attendance",
    "loyalty",
    "reconciliation",
    "payroll",
    "whatsapp",
    "customs-calculator",
    "accounting",
    "commercial-documents",
  ]);

  return !localRoots.has(root);
}

async function proxyLegacyBackend(request: NextRequest, parts: string[]) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${LEGACY_BACKEND_URL}/api/${parts.join("/")}${incomingUrl.search}`);
  const headers = new Headers(request.headers);
  headers.set("x-ordo-legacy-proxy", "1");
  headers.set("host", targetUrl.host);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    body: request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer()),
  };

  const response = await fetch(targetUrl, init);
  const responseHeaders = new Headers(response.headers);

  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  if (setCookies.length) {
    responseHeaders.delete("set-cookie");
    for (const cookie of setCookies) {
      responseHeaders.append("set-cookie", cookie);
    }
  }

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function error(status: number, message: string, details?: unknown) {
  return json({ error: message, message, details }, status);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeApiMoment(value: unknown) {
  const raw = asString(value);
  if (!raw) return "";
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) return raw;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(normalized)) return normalized;
  return `${normalized}Z`;
}

function toLocalDateInput(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMoney(value: unknown) {
  if (typeof value === "string") return Number(value.replace(/\s/g, "").replace(",", "."));
  return Number(value);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: unknown) {
  return roundMoney(asNumber(value)).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function toMoySkladPrice(value: number) {
  return Math.round(value * 100);
}

function meta(href: string, type: string) {
  return { meta: { href, type, mediaType: "application/json" } };
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Response(`Не задан ${name}`, { status: 500 });
  return value;
}

function getMoySkladEnvValue(key: string, fallback = "") {
  return String(process.env[`MOYSKLAD_${key}`] || fallback).trim();
}

function getMoySkladToken() {
  return requiredEnv("MOYSKLAD_TOKEN");
}

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
}

function getSupabaseKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
}

function normalizePhone(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

async function supabaseFetch(apiPath: string, init: RequestInit = {}) {
  const url = apiPath.startsWith("http") ? apiPath : `${getSupabaseUrl()}${apiPath}`;
  const key = getSupabaseKey();
  if (!getSupabaseUrl() || !key) throw new Response("Заполните SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.", { status: 500 });
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Response(asString(payload?.message ?? payload?.hint, `Supabase error ${response.status}`), { status: response.status });
  }
  return payload || [];
}

async function supabaseGet(apiPath: string, params: Record<string, string>) {
  const url = new URL(`${getSupabaseUrl()}${apiPath}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return supabaseFetch(url.toString(), { method: "GET" });
}

async function supabaseRpc(name: string, payload: JsonRecord) {
  return supabaseFetch(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(payload) });
}

function getAttributeHref(attribute: string, documentType: string) {
  if (documentType === "retaildemand") {
    return String(process.env[`MOYSKLAD_RETAILDEMAND_${attribute}_ATTRIBUTE_HREF`] || "").trim();
  }
  return String(process.env[`MOYSKLAD_${attribute}_ATTRIBUTE_HREF`] || "").trim();
}

function getIdFromHref(href: string) {
  return String(href || "").split("/").filter(Boolean).at(-1) || "";
}

async function moyskladFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Response("МойСклад слишком долго отвечает. Попробуйте еще раз.", { status: 504 });
    }
    throw new Response("Не удалось подключиться к МойСклад.", { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}

async function body(request: NextRequest) {
  try {
    return asRecord(await request.json());
  } catch {
    return {};
  }
}

function publicUser(user: CrmUser) {
  const safeUser = {
    id: user.id,
    name: user.name,
    login: user.login,
    position: user.position,
    salary: user.salary,
    role: user.role,
    branches: user.branches,
    permissions: user.permissions,
    active: user.active,
  };
  return { ...safeUser, passwordSet: true };
}

function uniquePublicUsers(users: CrmUser[]) {
  const seen = new Set<string>();
  const result: ReturnType<typeof publicUser>[] = [];
  for (const user of users) {
    const normalizedLogin = asString(user.login).trim().toLowerCase();
    const normalizedName = asString(user.name).trim().toLocaleLowerCase("ru-RU");
    const key = normalizedLogin || normalizedName || user.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(publicUser(user));
  }
  return result;
}

function uniqueManagedUsers<T extends { id: string; login?: string; name?: string }>(users: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const user of users) {
    const normalizedLogin = asString(user.login).trim().toLowerCase();
    const normalizedName = asString(user.name).trim().toLocaleLowerCase("ru-RU");
    const key = normalizedLogin || normalizedName || user.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(user);
  }
  return result;
}

function normalizeCrmBranches(value: unknown) {
  const allowed = new Set(["ayu", "besh", "green", "ayu-grand", "besh-sary", "green-city", "green-town"]);
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter((branch) => allowed.has(branch)))];
}

const reportProfitRoles = new Set<CrmRole>(["admin", "owner", "manager", "accountant"]);

function normalizeLoginValue(value: unknown) {
  return asString(value).trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60);
}

function normalizeCrmPermissions(role: unknown, value: unknown) {
  const roleName = isCrmRole(role) ? role : "employee";
  if (roleName === "admin" || roleName === "owner") return [...permissions];
  const source = Array.isArray(value) && value.length ? value.map(String) : rolePermissions[roleName];
  const filtered = [...new Set(source.filter((permission) => permissions.includes(permission)))];
  if (!reportProfitRoles.has(roleName)) {
    return filtered.filter((permission) => permission !== "reportProfit");
  }
  return filtered;
}

function isCrmRole(value: unknown): value is CrmRole {
  return ["admin", "owner", "manager", "seller", "logistics", "accountant", "employee"].includes(String(value));
}

function hashCrmPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyCrmPassword(password: string, stored: unknown) {
  const storedText = String(stored || "");
  const [algorithm, salt, expectedHex] = storedText.split("$");
  if (algorithm === "scrypt" && salt && expectedHex) {
    const actual = scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  const legacySha = hashPassword(password);
  if (/^[0-9a-f]{64}$/i.test(storedText)) {
    const actual = Buffer.from(legacySha, "hex");
    const expected = Buffer.from(storedText, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  return false;
}

function safeEqual(left: unknown, right: unknown) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getLegacyCrmUsers() {
  return [
    {
      role: "admin" as CrmRole,
      login: process.env.CRM_ADMIN_LOGIN || "admin",
      password: process.env.CRM_ADMIN_PASSWORD || "admin2026",
      name: process.env.CRM_ADMIN_NAME || "Администратор",
    },
    {
      role: "owner" as CrmRole,
      login: process.env.CRM_OWNER_LOGIN || process.env.REPORT_LOGIN || "owner",
      password: process.env.CRM_OWNER_PASSWORD || process.env.REPORT_PASSWORD || "owner2026",
      name: process.env.CRM_OWNER_NAME || "Владелец",
    },
    {
      role: "accountant" as CrmRole,
      login: process.env.CRM_ACCOUNTANT_LOGIN || "accountant",
      password: process.env.CRM_ACCOUNTANT_PASSWORD || "accountant2026",
      name: process.env.CRM_ACCOUNTANT_NAME || "Бухгалтер",
    },
    {
      role: "employee" as CrmRole,
      login: process.env.CRM_EMPLOYEE_LOGIN || "employee",
      password: process.env.CRM_EMPLOYEE_PASSWORD || "employee2026",
      name: process.env.CRM_EMPLOYEE_NAME || "Сотрудник",
    },
  ];
}

function legacySessionUser(user: ReturnType<typeof getLegacyCrmUsers>[number]) {
  const userPermissions = normalizeCrmPermissions(user.role, []);
  return {
    id: `legacy:${user.login}`,
    login: user.login,
    name: user.name,
    position: user.role === "admin" ? "Первичная настройка доступа" : user.role,
    salary: 0,
    role: user.role,
    branches: ["ayu", "besh", "ayu-grand", "besh-sary"],
    permissions: userPermissions,
    active: true,
    passwordSet: true,
  };
}

function sanitizeSupabaseUser(row: JsonRecord) {
  const role = isCrmRole(row.role) ? row.role : "employee";
  return {
    id: asString(row.id),
    login: asString(row.login),
    name: asString(row.name),
    position: asString(row.position),
    salary: asNumber(row.salary),
    role,
    branches: normalizeCrmBranches(row.branches),
    permissions: normalizeCrmPermissions(role, row.permissions),
    active: row.active !== false,
    passwordSet: Boolean(row.password_hash),
  };
}

function toSessionSupabaseUser(row: JsonRecord) {
  const user = sanitizeSupabaseUser(row);
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    position: user.position,
    role: user.role,
    branches: user.branches.length ? user.branches : ["ayu", "besh"],
    permissions: user.permissions,
    active: user.active,
    passwordSet: user.passwordSet,
  };
}

function isSupabaseCrmEnabled() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function makeEmployeeLogin(name: string, usedLogins: Set<string>) {
  const normalized = name
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized || `employee-${usedLogins.size + 1}`;
  let login = base;
  let index = 2;
  while (usedLogins.has(login)) {
    login = `${base}-${index}`;
    index += 1;
  }
  usedLogins.add(login);
  return login;
}

function canRoleHaveReportProfit(role: CrmRole) {
  return reportProfitRoles.has(role);
}

function canActorEditManagedUser(actor: CrmUser, target: { id: string; role: CrmRole }) {
  if (actor.role !== "admin" && target.role === "admin") return false;
  return true;
}

function canActorAssignRole(actor: CrmUser, role: CrmRole) {
  if (role === "admin" && actor.role !== "admin") return false;
  return true;
}

function canActorGrantReportProfit(actor: CrmUser, targetRole: CrmRole) {
  if (!canRoleHaveReportProfit(targetRole)) return false;
  return actor.role === "admin" || targetRole !== "admin";
}

function applyManagedUserPermissionRules(actor: CrmUser, targetRole: CrmRole, requestedPermissions: unknown, currentPermissions: string[] = []) {
  let normalized = normalizeCrmPermissions(targetRole, requestedPermissions);
  if (targetRole === "admin" || targetRole === "owner") {
    return [...permissions];
  }
  if (!canActorGrantReportProfit(actor, targetRole)) {
    normalized = normalized.filter((permission) => permission !== "reportProfit");
  }
  if (actor.role !== "admin" && !currentPermissions.includes("reportProfit")) {
    normalized = normalized.filter((permission) => permission !== "reportProfit");
  }
  return normalized;
}

function sanitizeManagedCrmUser(row: JsonRecord) {
  return sanitizeSupabaseUser(row);
}

async function getSupabaseCrmUserById(id: string) {
  const rows = await supabaseGet("/rest/v1/crm_users", {
    id: `eq.${id}`,
    select: "id,login,name,position,salary,role,branches,permissions,active,password_hash,created_at,updated_at",
    limit: "1",
  }) as JsonRecord[];
  return rows[0] || null;
}

async function getSupabaseCrmUserByLogin(login: string) {
  const rows = await supabaseGet("/rest/v1/crm_users", {
    login: `eq.${login}`,
    select: "id,login",
    limit: "1",
  }) as JsonRecord[];
  return rows[0] || null;
}

async function removeMoySkladEmployeeForCrmUser(user: { name: string }) {
  const entityId = String(process.env.MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID || "").trim();
  if (!entityId) {
    return { status: "skipped", reason: "MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID не задан." };
  }

  const remoteEmployees = await getMoySkladCustomEntityOptions(entityId, []);
  const normalizedName = normalizeEmployeeKey(user.name);
  const matches = remoteEmployees.filter((employee) => normalizeEmployeeKey(employee.name) === normalizedName && employee.href);
  if (!matches.length) return { status: "not_found" };
  if (matches.length > 1) {
    throw new Response("В МойСклад найдено несколько сотрудников с таким именем.", { status: 409 });
  }

  const href = asString(matches[0].href);
  const token = getMoySkladToken();
  const deletionResponse = await moyskladFetch(href, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;charset=utf-8",
    },
  });

  if (deletionResponse.ok) {
    return { status: "deleted" };
  }

  const currentResponse = await moyskladFetch(href, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;charset=utf-8",
    },
  });
  const current = await currentResponse.json().catch(() => ({})) as JsonRecord;
  if (!currentResponse.ok) {
    return { status: "skipped", reason: "Не удалось получить сотрудника из МойСклад." };
  }

  const description = [asString(current.description).trim(), `[CRM удаление ${new Date().toISOString()}]`].filter(Boolean).join("\n");
  const archiveResponse = await moyskladFetch(href, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;charset=utf-8",
      "Content-Type": "application/json;charset=utf-8",
    },
    body: JSON.stringify({ archived: true, description }),
  });
  if (archiveResponse.ok) {
    return { status: "archived" };
  }

  const archivePayload = await archiveResponse.json().catch(() => null);
  return { status: "skipped", reason: getMoySkladError(archivePayload, "Не удалось удалить или архивировать сотрудника в МойСклад.") };
}

async function syncMoySkladEmployeesToCrm(data: AppData) {
  const entityId = String(process.env.MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID || "").trim();
  if (!entityId) return false;

  if (isSupabaseCrmEnabled()) {
    return syncMoySkladEmployeesToSupabaseCrm();
  }

  const remoteEmployees = await getMoySkladCustomEntityOptions(entityId, []).catch(() => []);
  const existingNames = new Map(data.users.map((user) => [user.name.trim().toLocaleLowerCase("ru-RU"), user]));
  const usedLogins = new Set(data.users.map((user) => user.login));
  let changed = false;

  for (const employee of remoteEmployees) {
    const name = employee.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru-RU");
    const existing = existingNames.get(key);
    if (existing) {
      if (!existing.active) {
        existing.active = true;
        changed = true;
      }
      continue;
    }
    data.users.push({
      id: getIdFromHref(employee.href || "") || randomUUID(),
      name,
      login: makeEmployeeLogin(name, usedLogins),
      position: "Сотрудник",
      salary: 0,
      role: "employee",
      branches: branches.map((branch) => branch.id),
      permissions: ["sales", "attendance", "deliveries"],
      active: true,
      passwordHash: hashPassword("1234"),
    });
    changed = true;
  }

  if (changed) await writeData(data);
  return changed;
}

async function syncMoySkladEmployeesToSupabaseCrm() {
  const entityId = String(process.env.MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID || "").trim();
  const remoteEmployees = await getMoySkladCustomEntityOptions(entityId, []).catch(() => []);
  if (!remoteEmployees.length) return false;

  const currentRows = await supabaseGet("/rest/v1/crm_users", {
    select: "id,login,name,branches",
    order: "name.asc",
  }).catch(() => []) as JsonRecord[];
  const existingByName = new Map(currentRows.map((row) => [normalizeEmployeeKey(row.name), row]));
  const existingLogins = new Set(currentRows.map((row) => asString(row.login).trim().toLowerCase()).filter(Boolean));
  const payload: JsonRecord[] = [];
  let changed = false;

  for (const employee of remoteEmployees) {
    const name = employee.name.trim();
    if (!name) continue;
    const branchIds = ["ayu", "besh"];
    const existing = existingByName.get(normalizeEmployeeKey(name));
    if (existing) {
      const nextBranches = [...new Set([...normalizeCrmBranches(existing.branches), ...branchIds])];
      if (nextBranches.length !== normalizeCrmBranches(existing.branches).length) {
        await supabaseFetch(`/rest/v1/crm_users?id=eq.${encodeURIComponent(asString(existing.id))}&select=id`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ branches: nextBranches }),
        }).catch(() => null);
        changed = true;
      }
      continue;
    }
    const employeeIdPrefix = getIdFromHref(employee.href || "").slice(0, 6) || randomUUID().slice(0, 6);
    const login = makeEmployeeLogin(`emp-ayu-${employeeIdPrefix}`, existingLogins);
    payload.push({
      login,
      name,
      position: "Сотрудник МойСклад",
      salary: 0,
      role: "seller",
      branches: branchIds,
      permissions: normalizeCrmPermissions("seller", []),
      active: true,
      password_hash: null,
    });
  }

  if (payload.length) {
    await supabaseFetch("/rest/v1/crm_users", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload),
    });
    changed = true;
  }
  return changed;
}

async function getCrmLoginUsers(data: AppData) {
  await syncMoySkladEmployeesToCrm(data).catch(() => {});
  if (!isSupabaseCrmEnabled()) {
    const legacy = getLegacyCrmUsers().map(legacySessionUser);
    const local = data.users.filter((user) => user.active).map(publicUser);
    return [...legacy, ...local.filter((user) => !legacy.some((legacyUser) => legacyUser.login === user.login))];
  }

  try {
    const rows = await supabaseGet("/rest/v1/crm_users", {
      select: "id,login,name,position,role,branches,password_hash",
      active: "eq.true",
      order: "name.asc",
    }) as JsonRecord[];
    const users = rows.map(sanitizeSupabaseUser);
    if (!users.some((user) => user.passwordSet && (user.role === "admin" || user.role === "owner"))) {
      users.unshift(legacySessionUser(getLegacyCrmUsers()[0]));
    }
    return users;
  } catch {
    const legacy = getLegacyCrmUsers().map(legacySessionUser);
    const local = data.users.filter((user) => user.active).map(publicUser);
    return [...legacy, ...local.filter((user) => !legacy.some((legacyUser) => legacyUser.login === user.login))];
  }
}

async function authenticateCrmUser(login: string, password: string, data: AppData) {
  const normalizedLogin = String(login || "").trim();
  const legacyLogin = normalizedLogin.replace(/^legacy:/, "");
  const legacyUser = getLegacyCrmUsers().find((user) => safeEqual(user.login, legacyLogin) && safeEqual(user.password, password));
  if (legacyUser) return legacySessionUser(legacyUser);

  if (isSupabaseCrmEnabled()) {
    try {
      const select = "id,login,name,position,salary,role,branches,permissions,password_hash,active";
      const byId = isUuid(normalizedLogin)
        ? await supabaseGet("/rest/v1/crm_users", {
            id: `eq.${normalizedLogin}`,
            active: "eq.true",
            select,
            limit: "1",
          }) as JsonRecord[]
        : [];
      const rows = byId.length ? byId : await supabaseGet("/rest/v1/crm_users", {
        login: `eq.${normalizedLogin.toLowerCase()}`,
        active: "eq.true",
        select,
        limit: "1",
      }) as JsonRecord[];
      const found = rows[0];
      if (found && found.password_hash && verifyCrmPassword(password, found.password_hash)) {
        return toSessionSupabaseUser(found);
      }
    } catch {
      // Local fallback below keeps the app usable if Supabase is temporarily down.
    }
  }

  const localUser = data.users.find((item) => (item.id === normalizedLogin || item.login === normalizedLogin) && item.active);
  if (!localUser || !verifyCrmPassword(password, localUser.passwordHash)) return null;
  return publicUser(localUser);
}

async function getManagedCrmUsers(data: AppData) {
  await syncMoySkladEmployeesToCrm(data).catch(() => {});
  if (!isSupabaseCrmEnabled()) return data.users.map(publicUser);
  try {
    const rows = await supabaseGet("/rest/v1/crm_users", {
      select: "id,login,name,position,salary,role,branches,permissions,active,password_hash,created_at,updated_at",
      active: "eq.true",
      order: "name.asc",
    }) as JsonRecord[];
    return rows.map(sanitizeManagedCrmUser);
  } catch {
    return data.users.map(publicUser);
  }
}

async function updateManagedCrmUser(id: string, input: JsonRecord, data: AppData, actor: CrmUser) {
  if (!isSupabaseCrmEnabled() || !isUuid(id)) {
    const index = data.users.findIndex((user) => user.id === id);
    if (index < 0) throw new Response("Сотрудник не найден", { status: 404 });
    const target = data.users[index];
    if (!canActorEditManagedUser(actor, target)) throw new Response("Главный администратор доступен владельцу только для просмотра.", { status: 403 });
    const role = isCrmRole(input.role) ? input.role : target.role;
    if (!canActorAssignRole(actor, role)) throw new Response("Только admin может назначать роль admin.", { status: 403 });
    const branches = normalizeCrmBranches(input.branches);
    if (!branches.length) throw new Response("Выберите хотя бы один филиал.", { status: 400 });
    const password = asString(input.password);
    if (password && password.length < 6) throw new Response("Пароль должен содержать минимум 6 символов.", { status: 400 });
    data.users[index] = {
      ...target,
      name: asString(input.name, target.name).trim().slice(0, 120),
      login: normalizeLoginValue(input.login) || target.login,
      position: asString(input.position, target.position).trim().slice(0, 120),
      salary: Math.min(10_000_000, Math.max(0, asNumber(input.salary, target.salary))),
      role,
      branches,
      permissions: applyManagedUserPermissionRules(actor, role, input.permissions, target.permissions),
      active: input.active !== false,
      passwordHash: password ? hashCrmPassword(password) : target.passwordHash,
    };
    await writeData(data);
    return publicUser(data.users[index]);
  }

  const current = await getSupabaseCrmUserById(id);
  if (!current) throw new Response("Сотрудник не найден", { status: 404 });
  const currentRole = isCrmRole(current.role) ? current.role : "employee";
  if (!canActorEditManagedUser(actor, { id, role: currentRole })) {
    throw new Response("Главный администратор доступен владельцу только для просмотра.", { status: 403 });
  }

  const role = isCrmRole(input.role) ? input.role : currentRole;
  if (!canActorAssignRole(actor, role)) {
    throw new Response("Только admin может назначать роль admin.", { status: 403 });
  }
  const branches = normalizeCrmBranches(input.branches);
  if (!branches.length) throw new Response("Выберите хотя бы один филиал.", { status: 400 });
  const nextLogin = normalizeLoginValue(input.login);
  const payload: JsonRecord = {
    name: asString(input.name).trim().slice(0, 120),
    login: nextLogin,
    position: asString(input.position).trim().slice(0, 120),
    salary: Math.min(10_000_000, Math.max(0, asNumber(input.salary))),
    role,
    branches,
    permissions: applyManagedUserPermissionRules(actor, role, input.permissions, Array.isArray(current.permissions) ? current.permissions.map(String) : []),
    active: input.active !== false,
  };
  if (!payload.name || !payload.login) throw new Response("Заполните имя и логин сотрудника.", { status: 400 });
  const existingLogin = nextLogin ? await getSupabaseCrmUserByLogin(nextLogin) : null;
  if (existingLogin && asString(existingLogin.id) !== id) {
    throw new Response("Логин уже занят.", { status: 409 });
  }
  const password = asString(input.password);
  if (password) {
    if (password.length < 6) throw new Response("Пароль должен содержать минимум 6 символов.", { status: 400 });
    payload.password_hash = hashCrmPassword(password);
  }
  const rows = await supabaseFetch(`/rest/v1/crm_users?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  }) as JsonRecord[];
  if (!rows[0]) throw new Response("Сотрудник не найден", { status: 404 });
  return sanitizeManagedCrmUser(rows[0]);
}

async function deleteManagedCrmUser(id: string, data: AppData, actor: CrmUser) {
  if (!isSupabaseCrmEnabled() || !isUuid(id)) {
    const index = data.users.findIndex((user) => user.id === id);
    if (index < 0) throw new Response("Сотрудник не найден", { status: 404 });
    const target = data.users[index];
    if (actor.id === target.id) throw new Response("Нельзя удалить самого себя.", { status: 400 });
    if (target.role === "admin" || target.role === "owner") throw new Response("Нельзя удалить admin или owner.", { status: 400 });
    if (target.role === "manager" && actor.role !== "admin") throw new Response("Только admin может удалить manager.", { status: 403 });
    data.users[index] = { ...target, active: false };
    await writeData(data);
    return { ok: true, user: publicUser(data.users[index]), moySkladRemoval: { status: "skipped" } };
  }

  const current = await getSupabaseCrmUserById(id);
  if (!current) throw new Response("Сотрудник не найден", { status: 404 });
  const currentRole = isCrmRole(current.role) ? current.role : "employee";
  if (actor.id === id) throw new Response("Нельзя удалить самого себя.", { status: 400 });
  if (currentRole === "admin" || currentRole === "owner") throw new Response("Нельзя удалить admin или owner.", { status: 400 });
  if (currentRole === "manager" && actor.role !== "admin") throw new Response("Только admin может удалить manager.", { status: 403 });

  const moySkladRemoval = await removeMoySkladEmployeeForCrmUser({ name: asString(current.name) }).catch((error) => {
    if (error instanceof Response) throw error;
    return { status: "skipped", reason: error instanceof Error ? error.message : "МойСклад недоступен." };
  });
  const rows = await supabaseFetch(`/rest/v1/crm_users?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ active: false }),
  }) as JsonRecord[];
  if (!rows[0]) throw new Response("Сотрудник не найден", { status: 404 });
  return { ok: true, user: sanitizeManagedCrmUser(rows[0]), moySkladRemoval };
}

function normalizeUiSettings(value: unknown): UiSettings {
  const input = asRecord(value);
  const theme = ["blue", "green", "violet", "red"].includes(asString(input.theme)) ? asString(input.theme) : "blue";
  const mode = asString(input.mode) === "dark" ? "dark" : "light";
  const density = asString(input.density) === "compact" ? "compact" : "comfortable";
  return {
    theme,
    mode,
    sidebarColor: asString(input.sidebarColor),
    accentColor: asString(input.accentColor),
    density,
    confirmBeforeSubmit: input.confirmBeforeSubmit !== false,
    focusProductSearch: input.focusProductSearch !== false,
    stickySummary: input.stickySummary !== false,
  };
}

async function getUserUiSettings(user: CrmUser, data: AppData) {
  if (isSupabaseCrmEnabled() && /^[0-9a-f-]{36}$/i.test(user.id)) {
    try {
      const rows = await supabaseGet("/rest/v1/crm_users", {
        id: `eq.${user.id}`,
        select: "ui_settings",
        limit: "1",
      }) as JsonRecord[];
      return normalizeUiSettings(rows[0]?.ui_settings);
    } catch {
      // Local fallback below.
    }
  }
  return data.uiSettings[user.id] || {};
}

async function updateUserUiSettings(user: CrmUser, value: unknown, data: AppData) {
  const settings = normalizeUiSettings(value);
  if (isSupabaseCrmEnabled() && /^[0-9a-f-]{36}$/i.test(user.id)) {
    try {
      const rows = await supabaseFetch(`/rest/v1/crm_users?id=eq.${encodeURIComponent(user.id)}&select=ui_settings`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ui_settings: settings }),
      }) as JsonRecord[];
      return normalizeUiSettings(rows[0]?.ui_settings);
    } catch {
      // Local fallback below.
    }
  }
  data.uiSettings[user.id] = settings;
  await writeData(data);
  return settings;
}

function normalizeExpenseRow(row: JsonRecord): Expense {
  return {
    id: asString(row.id),
    expenseDate: asString(row.expense_date ?? row.expenseDate),
    category: asString(row.category),
    subcategory: asString(row.subcategory),
    amount: asNumber(row.amount),
    branchName: asString(row.branch_name ?? row.branchName),
    paymentMethod: asString(row.payment_method ?? row.paymentMethod),
    description: asString(row.description),
    createdBy: asString(row.created_by ?? row.createdBy),
  };
}

function expensePayload(input: JsonRecord, user: CrmUser) {
  return {
    expense_date: asString(input.expenseDate, new Date().toISOString().slice(0, 10)),
    category: asString(input.category, "operational"),
    subcategory: asString(input.subcategory),
    amount: asNumber(input.amount),
    branch_name: asString(input.branchName),
    payment_method: asString(input.paymentMethod, "Наличными"),
    description: asString(input.description),
    created_by: user.name,
  };
}

function normalizeDeliveryRow(row: JsonRecord): Delivery {
  return {
    id: asString(row.id),
    documentId: asString(row.document_id ?? row.documentId),
    documentType: asString(row.document_type ?? row.documentType),
    documentName: asString(row.document_name ?? row.documentName),
    documentUrl: asString(row.document_url ?? row.documentUrl),
    scheduledAt: normalizeApiMoment(row.scheduled_at ?? row.scheduledAt),
    createdAt: asString(row.created_at ?? row.createdAt),
    customerName: asString(row.customer_name ?? row.customerName),
    customerPhone: asString(row.customer_phone ?? row.customerPhone),
    deliveryAddress: asString(row.delivery_address ?? row.address ?? row.deliveryAddress),
    branchName: asString(row.branch_name ?? row.branchName),
    status: asString(row.status, "new"),
    amount: asNumber(row.amount),
    employeeName: asString(row.employee_name ?? row.employeeName),
    items: Array.isArray(row.items) ? row.items.map((item) => ({
      name: asString(asRecord(item).name),
      quantity: asNumber(asRecord(item).quantity, 1),
    })) : [],
    notes: asString(row.notes ?? row.comment),
  };
}

function deliveryPayload(input: JsonRecord, user: CrmUser) {
  const now = new Date().toISOString();
  return {
    document_id: asString(input.documentId ?? input.id, randomUUID()),
    document_type: asString(input.documentType, "manual"),
    document_name: asString(input.documentName),
    document_url: asString(input.documentUrl),
    branch_name: asString(input.branchName),
    customer_name: asString(input.customerName),
    customer_phone: asString(input.customerPhone),
    delivery_address: asString(input.address ?? input.deliveryAddress),
    scheduled_at: asString(input.scheduledAt, now),
    employee_name: asString(input.employeeName),
    items: Array.isArray(input.items) ? input.items : [],
    status: asString(input.status, "new"),
    notes: asString(input.comment ?? input.notes),
    created_by: user.name,
  };
}

function deliveryUpdatePayload(input: JsonRecord) {
  const payload: JsonRecord = {};
  if ("documentId" in input) payload.document_id = asString(input.documentId);
  if ("documentType" in input) payload.document_type = asString(input.documentType);
  if ("documentName" in input) payload.document_name = asString(input.documentName);
  if ("documentUrl" in input) payload.document_url = asString(input.documentUrl);
  if ("branchName" in input) payload.branch_name = asString(input.branchName);
  if ("customerName" in input) payload.customer_name = asString(input.customerName);
  if ("customerPhone" in input) payload.customer_phone = asString(input.customerPhone);
  if ("address" in input || "deliveryAddress" in input) payload.delivery_address = asString(input.address ?? input.deliveryAddress);
  if ("scheduledAt" in input) payload.scheduled_at = asString(input.scheduledAt);
  if ("employeeName" in input) payload.employee_name = asString(input.employeeName);
  if ("items" in input) payload.items = Array.isArray(input.items) ? input.items : [];
  if ("status" in input) payload.status = asString(input.status, "new");
  if ("comment" in input || "notes" in input) payload.notes = asString(input.comment ?? input.notes);
  return payload;
}

function normalizeCustomsHistoryRow(row: JsonRecord) {
  const payload = asRecord(row.payload);
  return {
    id: asString(row.id),
    title: asString(row.title ?? row.name),
    user_id: asString(row.user_id ?? row.userId),
    payload,
    totals: calculateCustomsHistoryTotals(payload),
    created_by: asString(row.created_by ?? row.createdBy),
    created_at: asString(row.created_at ?? row.createdAt),
    updated_at: asString(row.updated_at ?? row.updatedAt),
  };
}

function calculateCustomsHistoryTotals(payload: JsonRecord) {
  const rows = Array.isArray(payload.rows) ? payload.rows.map(asRecord) : [];
  const totals = rows.reduce<{ rowsCount: number; units: number; buy: number; profit: number; other: number }>((acc, row) => {
    const quantity = asNumber(row.quantity, 1);
    const boxesCount = asNumber(row.boxesCount);
    const unitsPerBox = asNumber(row.unitsPerBox);
    const boxVariant = asString(row.boxVariant, "single");
    const rowUnits = boxVariant === "master" && boxesCount > 0 && unitsPerBox > 0 ? boxesCount * unitsPerBox : Math.max(1, quantity);
    const buyPriceValue = asNumber(row.buyPriceValue);
    const profitPerUnitUsd = asNumber(row.profitPerUnitUsd);
    const otherPerUnitUsd = asNumber(row.otherPerUnitUsd);
    acc.rowsCount += 1;
    acc.units += rowUnits;
    acc.buy += roundMoney(buyPriceValue * rowUnits);
    acc.profit += roundMoney(profitPerUnitUsd * rowUnits);
    acc.other += roundMoney(otherPerUnitUsd * rowUnits);
    return acc;
  }, { rowsCount: 0, units: 0, buy: 0, profit: 0, other: 0 });
  return totals;
}

function customsHistoryPayload(input: JsonRecord, user: CrmUser) {
  const payload = asRecord(input.draft);
  return {
    user_id: asString(user.id),
    title: asString(input.title, "Расчет таможни"),
    payload,
  };
}

function upsertSessionUser(data: AppData, value: unknown) {
  const row = asRecord(value);
  const id = asString(row.id);
  if (!id) return;
  const role = isCrmRole(row.role) ? row.role : "employee";
  const user: CrmUser = {
    id,
    name: asString(row.name),
    login: asString(row.login, id),
    position: asString(row.position),
    salary: asNumber(row.salary),
    role,
    branches: normalizeCrmBranches(row.branches),
    permissions: normalizeCrmPermissions(role, row.permissions),
    active: row.active !== false,
    passwordHash: "",
  };
  const index = data.users.findIndex((item) => item.id === id);
  if (index >= 0) data.users[index] = { ...data.users[index], ...user, passwordHash: data.users[index].passwordHash };
  else data.users.push(user);
}

function getUserByRequest(request: NextRequest, data: AppData) {
  const sessionId = request.cookies.get("ordo_crm_session")?.value || "";
  const userId = data.sessions[sessionId];
  const user = userId ? data.users.find((item) => item.id === userId && item.active) : null;
  return user || null;
}

function requireUser(request: NextRequest, data: AppData) {
  const user = getUserByRequest(request, data);
  if (!user) throw new Response("Нужно войти в систему", { status: 401 });
  return user;
}

function requireAdmin(request: NextRequest, data: AppData) {
  const user = requireUser(request, data);
  if (!["admin", "owner"].includes(user.role)) throw new Response("Недостаточно прав", { status: 403 });
  return user;
}

async function moysklad(pathname: string, params: Record<string, string> = {}) {
  const token = getMoySkladToken();
  const url = new URL(`${MOYSKLAD_BASE_URL}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await moyskladFetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Response(getMoySkladError(payload, "МойСклад вернул ошибку."), { status: response.status });
  }
  return response.json() as Promise<JsonRecord>;
}

async function moyskladRows(pathname: string, params: Record<string, string> = {}) {
  const token = getMoySkladToken();
  const url = new URL(`${MOYSKLAD_BASE_URL}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await moyskladFetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Response(getMoySkladError(payload, "МойСклад вернул ошибку при загрузке справочника."), { status: response.status });
  return Array.isArray(payload?.rows) ? (payload.rows as unknown[]) : [];
}

function getMoySkladError(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  const errors = Array.isArray(record.errors) ? record.errors.map(asRecord) : [];
  const messages = errors.map((item) => asString(item.error ?? item.message)).filter(Boolean);
  return messages.join("; ") || asString(record.error ?? record.message, fallback);
}

async function getMoySkladRetailStores(): Promise<RetailStoreOption[]> {
  const rows = await moyskladRows("/entity/retailstore", { limit: "100", expand: "store" }).catch(() => []);
  if (!rows.length) return [];
  return rows.map((value: unknown) => {
    const row = asRecord(value);
    const href = asString(asRecord(row.meta).href);
    const storeHref = asString(asRecord(asRecord(row.store).meta).href);
    return { id: href, href, name: asString(row.name), storeHref, storeName: asString(asRecord(row.store).name) };
  }).filter((item: RetailStoreOption) => item.href);
}

async function getMoySkladCustomEntityOptions(entityId: string, fallback: PaymentOption[] = []): Promise<PaymentOption[]> {
  if (!entityId) return fallback;
  const rows = await moyskladRows(`/entity/customentity/${entityId}`, { limit: "100" }).catch(() => []);
  if (!rows.length) return fallback;
  return rows.map((value: unknown) => {
    const row = asRecord(value);
    const href = asString(asRecord(row.meta).href);
    const name = asString(row.name);
    const parsed = parsePaymentType(name);
    return { id: href, href, name, provider: parsed.provider, months: parsed.months, rate: getPaymentRate(parsed.provider, parsed.months, parseRateFromComment(asString(row.description))), comment: asString(row.description) };
  }).filter((item: PaymentOption) => Boolean(item.href));
}

async function getMoySkladCustomEntityOptionsWithToken(entityId: string, token: string, fallback: PaymentOption[] = []): Promise<PaymentOption[]> {
  if (!entityId || !token) return fallback;
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/customentity/${encodeURIComponent(entityId)}?limit=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  }).catch(() => null);
  if (!response || !("ok" in response) || !response.ok) return fallback;
  const payload = asRecord(await response.json().catch(() => null));
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return fallback;
  return rows.map((value: unknown) => {
    const row = asRecord(value);
    const href = asString(asRecord(row.meta).href);
    const name = asString(row.name);
    const parsed = parsePaymentType(name);
    return { id: href, href, name, provider: parsed.provider, months: parsed.months, rate: getPaymentRate(parsed.provider, parsed.months, parseRateFromComment(asString(row.description))), comment: asString(row.description) };
  }).filter((item: PaymentOption) => Boolean(item.href));
}

function getMoySkladEmployeeEntityConfigs() {
  const configs = [
    {
      key: "default",
      entityId: asString(process.env.MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID).trim(),
      token: asString(process.env.MOYSKLAD_TOKEN).trim(),
      branchIds: ["ayu", "besh", "green", "ayu-grand", "besh-sary"],
    },
    ...["AYU", "BESH", "GREEN"].map((branch) => ({
      key: branch.toLowerCase(),
      entityId: asString(process.env[`MOYSKLAD_${branch}_EMPLOYEE_CUSTOM_ENTITY_ID`]).trim(),
      token: asString(process.env[`MOYSKLAD_${branch}_TOKEN`] || process.env.MOYSKLAD_TOKEN).trim(),
      branchIds: branch === "AYU"
        ? ["ayu", "ayu-grand"]
        : branch === "BESH"
          ? ["besh", "besh-sary"]
          : ["green", "green-city", "green-town"],
    })),
  ].filter((config) => config.entityId && config.token);

  const deduped = new Map<string, { key: string; entityId: string; token: string; branchIds: string[] }>();
  for (const config of configs) {
    deduped.set(`${config.token}:${config.entityId}`, config);
  }
  return [...deduped.values()];
}

async function getAllMoySkladEmployeesRemote() {
  const configs = getMoySkladEmployeeEntityConfigs();
  const employeesByKey = new Map<string, { id: string; href: string; name: string; branchIds: string[]; payroll?: Record<string, unknown> }>();

  for (const config of configs) {
    const rows = await getMoySkladCustomEntityOptionsWithToken(config.entityId, config.token, []);
    for (const item of rows) {
      const href = asString(item.href);
      const name = asString(item.name).trim();
      if (!href || !name) continue;
      const existing = employeesByKey.get(href) || employeesByKey.get(normalizeEmployeeKey(name));
      if (existing) {
        existing.branchIds = [...new Set([...existing.branchIds, ...config.branchIds])];
        continue;
      }
      employeesByKey.set(href || normalizeEmployeeKey(name), {
        id: href || normalizeEmployeeKey(name),
        href,
        name,
        branchIds: [...config.branchIds],
      });
    }
  }

  return [...employeesByKey.values()];
}

async function getProducts(search: string, storeHref = "") {
  const normalizedSearch = search.trim();
  if (normalizedSearch.length < 2) return [];
  const queries = getProductSearchQueries(normalizedSearch);
  const allRows: unknown[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const remote = await moysklad("/entity/product", {
      limit: "20",
      search: query,
      expand: "productFolder",
    });
    const rows = Array.isArray(remote?.rows) ? remote.rows : [];
    for (const value of rows) {
      const row = asRecord(value);
      const href = asString(asRecord(row.meta).href);
      if (!href || seen.has(href) || row.archived === true) continue;
      seen.add(href);
      allRows.push(value);
    }
  }
  const selectedRows = allRows.slice(0, 50);
  const stockValues = await Promise.all(
    selectedRows.map((value) => {
      const row = asRecord(value);
      return getMoySkladProductStock(asString(asRecord(row.meta).href), storeHref).catch(() => 0);
    }),
  );
  return selectedRows.map((value, index) => mapMoySkladProductForSales(value, index, stockValues[index] ?? 0));
}

function getProductSearchQueries(search: string) {
  const query = String(search || "").trim();
  const queries = [query];
  if (/^\d+$/.test(query)) queries.push(`B${query}`, `b${query}`);
  return [...new Set(queries)];
}

function getProductBarcode(row: JsonRecord) {
  const barcodes = Array.isArray(row.barcodes) ? row.barcodes.map(asRecord) : [];
  const barcode = barcodes[0] || {};
  return asString(barcode.ean13 ?? barcode.ean8 ?? barcode.code128 ?? barcode.gtin);
}

function getProductSalePrice(row: JsonRecord, preferredName = process.env.MOYSKLAD_PRODUCT_PRICE_NAME || "3-6") {
  const salePrices = Array.isArray(row.salePrices) ? row.salePrices.map(asRecord) : [];
  const preferred = preferredName.trim().toLowerCase();
  const selected = salePrices.find((price) => asString(asRecord(price.priceType).name).toLowerCase() === preferred)
    || salePrices.find((price) => asString(asRecord(price.priceType).name).toLowerCase().includes(preferred))
    || salePrices[0];
  return asNumber(selected?.value) / 100;
}

function getProductBuyPrice(row: JsonRecord) {
  return asNumber(asRecord(row.buyPrice).value) / 100;
}

async function getMoySkladProductStock(productHref: string, storeHref = "") {
  if (!productHref) return 0;

  const effectiveStoreHref = String(storeHref || getMoySkladEnvValue("STORE_HREF")).trim();
  if (!effectiveStoreHref) return 0;

  const cacheKey = `${effectiveStoreHref}|${productHref}`;
  const cached = productStockCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PRODUCT_STOCK_CACHE_TTL_MS) {
    return cached.value;
  }

  const payload = await moysklad("/report/stock/all", {
    limit: "1",
    filter: `store=${effectiveStoreHref};product=${productHref}`,
  });
  const row = Array.isArray(payload?.rows) ? asRecord(payload.rows[0]) : {};
  const stock = asNumber(row.stock);
  const normalized = Number.isFinite(stock) ? stock : 0;
  productStockCache.set(cacheKey, { value: normalized, createdAt: Date.now() });
  return normalized;
}

function mapMoySkladProductForSales(value: unknown, index: number, stock = 0) {
  const row = asRecord(value);
  return {
    id: index + 1,
    href: asString(asRecord(row.meta).href),
    type: asString(asRecord(row.meta).type, "product"),
    name: asString(row.name),
    code: asString(row.code),
    sku: asString(row.article),
    article: asString(row.article),
    barcode: getProductBarcode(row),
    price: getProductSalePrice(row),
    cost: getProductBuyPrice(row),
    stock,
  };
}

async function getCustomers(search: string) {
  const remote = await moysklad("/entity/counterparty", {
    limit: "50",
    search,
  });
  const rows = Array.isArray(remote?.rows) ? remote.rows : [];
  return rows.map((value, index) => {
    const row = asRecord(value);
    return {
      id: index + 1,
      href: asString(asRecord(row.meta).href),
      name: asString(row.name),
      phone: asString(row.phone),
      actualAddress: asString(row.actualAddress ?? row.legalAddress),
      customerType: row.companyType === "legal" ? "legal" : row.companyType === "entrepreneur" ? "entrepreneur" : "individual",
    };
  });
}

function getOrderItems(input: JsonRecord) {
  const rawItems = Array.isArray(input.items) ? input.items.map(asRecord) : [];
  if (!rawItems.length) throw new Response("Добавьте хотя бы один товар.", { status: 400 });

  return rawItems.map((item, index) => {
    const isGift = item.isGift === true;
    const productPrice = isGift ? 0 : toMoney(item.productPrice ?? item.price);
    const productCost = toMoney(item.productCost ?? item.cost ?? 0);
    const quantity = asNumber(item.quantity, 1);
    const assortmentHref = asString(item.assortmentHref ?? item.href);
    const assortmentType = asString(item.assortmentType ?? item.type, "product");

    if (!assortmentHref) throw new Response(`Выберите товар в позиции ${index + 1}.`, { status: 400 });
    if (!Number.isFinite(productPrice) || (!isGift && productPrice <= 0)) throw new Response(`Укажите цену товара в позиции ${index + 1}.`, { status: 400 });
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Response(`Укажите количество в позиции ${index + 1}.`, { status: 400 });

    return {
      productName: asString(item.productName ?? item.name, `Позиция ${index + 1}`),
      code: asString(item.productCode ?? item.code ?? item.article),
      assortmentHref,
      assortmentType,
      productPrice,
      productCost,
      isGift,
      quantity,
      lineTotal: roundMoney(productPrice * quantity),
      costTotal: roundMoney(productCost * quantity),
    };
  });
}

function parsePaymentType(name: string) {
  const text = String(name || "").trim();
  const monthsMatch = text.match(/\((\d+)\s*мес\)/i);
  const months = monthsMatch ? Number(monthsMatch[1]) : 1;
  const provider = text.replace(/\s*\(\d+\s*мес\)\s*/i, "").trim() || text;
  return { provider, months };
}

function parseRateFromComment(comment: string) {
  const text = String(comment || "").trim().replace(",", ".");
  const numberOnlyMatch = text.match(/^(\d+(?:\.\d+)?)$/);
  if (numberOnlyMatch) return Number(numberOnlyMatch[1]) / 100;
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Number(percentMatch[1]) / 100;
  return undefined;
}

function getPaymentRate(provider: string, months: number, explicitRate?: number) {
  const rate = Number(explicitRate);
  if (Number.isFinite(rate) && rate >= 0) return rate > 1 ? rate / 100 : rate;
  return paymentRateRules[provider]?.[months] ?? 0;
}

function shouldCreateRetailDemand(calculation: JsonRecord) {
  const paymentName = asString(calculation.paymentType).toLowerCase();
  return !paymentName.includes("долг");
}

function resolveDocumentType(calculation: JsonRecord) {
  const configured = String(process.env.MOYSKLAD_DOCUMENT_TYPE || "auto");
  if (configured !== "auto") return configured;
  return shouldCreateRetailDemand(calculation) ? "retaildemand" : "demand";
}

function calculateDraft(draft: JsonRecord) {
  const items = getOrderItems(draft);
  const cashPrepayment = toMoney(draft.cashPrepayment ?? draft.cashAmount ?? 0);
  const transferPrepayment = toMoney(draft.transferPrepayment ?? draft.bankAmount ?? 0);
  const secondBankAmount = toMoney(draft.secondBankAmount ?? 0);
  const paymentTypeName = asString(draft.paymentTypeName ?? draft.paymentType, "Наличными");
  const paymentType = parsePaymentType(paymentTypeName);
  const secondPaymentTypeName = asString(draft.secondPaymentTypeName);
  const secondPaymentType = secondPaymentTypeName ? parsePaymentType(secondPaymentTypeName) : { provider: "", months: 0 };
  const rate = getPaymentRate(paymentType.provider, paymentType.months, asNumber(draft.paymentTypeRate, parseRateFromComment(asString(draft.paymentTypeComment))));
  const secondRate = secondPaymentTypeName ? getPaymentRate(secondPaymentType.provider, secondPaymentType.months, asNumber(draft.secondPaymentTypeRate, parseRateFromComment(asString(draft.secondPaymentTypeComment)))) : 0;
  const loyaltyRedemption = toMoney(draft.loyaltyRedemption || 0);
  const baseTotal = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  if (!items.length) throw new Response("Добавьте хотя бы один товар.", { status: 400 });
  if (!items.some((item) => !item.isGift && item.lineTotal > 0)) throw new Response("В продаже должен быть хотя бы один оплачиваемый товар. Подарок добавляется вместе с покупкой.", { status: 400 });
  if (!Number.isFinite(cashPrepayment) || cashPrepayment < 0) throw new Response("Наличная предоплата не может быть отрицательной.", { status: 400 });
  if (!Number.isFinite(transferPrepayment) || transferPrepayment < 0) throw new Response("Предоплата переводом не может быть отрицательной.", { status: 400 });
  if (!Number.isFinite(secondBankAmount) || secondBankAmount < 0) throw new Response("Сумма через второй банк не может быть отрицательной.", { status: 400 });
  if (secondBankAmount > 0 && !secondPaymentTypeName) throw new Response("Выберите второй банк.", { status: 400 });
  if (secondBankAmount > 0 && secondPaymentTypeName === paymentTypeName) throw new Response("Для смешанной оплаты выберите два разных банка.", { status: 400 });
  if (loyaltyRedemption > 0 && !getLoyaltyConfig().enabled) throw new Response("Бонусная система сейчас выключена.", { status: 400 });
  if (loyaltyRedemption > 0 && draft.customerMode === "retail") throw new Response("Для розничного покупателя нельзя списывать бонусы. Выберите старого или нового клиента.", { status: 400 });
  if (!Number.isFinite(loyaltyRedemption) || loyaltyRedemption < 0 || !Number.isInteger(loyaltyRedemption)) throw new Response("Бонусы списываются только целым числом.", { status: 400 });
  if (loyaltyRedemption > baseTotal) throw new Response("Нельзя списать бонусов больше суммы товара.", { status: 400 });
  const maxLoyaltyRedemption = roundMoney(baseTotal * getLoyaltyConfig().maxRedeemPercent / 100);
  if (loyaltyRedemption > maxLoyaltyRedemption) throw new Response(`Можно списать бонусами не больше ${maxLoyaltyRedemption} сом.`, { status: 400 });
  const payableTotal = roundMoney(baseTotal - loyaltyRedemption);
  const prepaidTotal = roundMoney(cashPrepayment + transferPrepayment);
  if (prepaidTotal > payableTotal) throw new Response("Предоплата не может быть больше суммы товара.", { status: 400 });
  const installmentBase = roundMoney(payableTotal - prepaidTotal);
  if (secondBankAmount > installmentBase) throw new Response("Сумма через второй банк не может быть больше остатка.", { status: 400 });
  const primaryBankAmount = roundMoney(installmentBase - secondBankAmount);
  const commission = roundMoney(primaryBankAmount * rate + secondBankAmount * secondRate);
  const costTotal = roundMoney(items.reduce((sum, item) => sum + item.costTotal, 0));
  const netTotal = roundMoney(payableTotal - commission);
  const result = {
    items,
    bank: paymentType.provider,
    paymentType: paymentTypeName,
    paymentLabel: secondBankAmount > 0 ? `${paymentTypeName} + ${secondPaymentTypeName}` : paymentTypeName,
    months: paymentType.months,
    rate,
    primaryBankAmount,
    secondPaymentType: secondPaymentTypeName,
    secondPaymentTypeHref: asString(draft.secondPaymentTypeHref),
    secondMonths: secondPaymentType.months,
    secondRate,
    secondBankAmount,
    baseTotal,
    loyaltyRedemption,
    payableTotal,
    cashPrepayment,
    prepaymentMethodName: asString(draft.prepaymentMethodName, "Наличными"),
    transferPrepayment,
    prepaidTotal,
    installmentBase,
    commission,
    finalTotal: payableTotal,
    netTotal,
    costTotal,
    netProfit: roundMoney(netTotal - costTotal),
    monthlyPayment: roundMoney((paymentType.months > 0 ? primaryBankAmount / paymentType.months : 0) + (secondPaymentType.months > 0 ? secondBankAmount / secondPaymentType.months : 0)),
    currency: "KGS",
  };
  return { ...result, documentType: resolveDocumentType(result) };
}

function buildPositions(calculation: JsonRecord) {
  const items = Array.isArray(calculation.items) ? calculation.items.map(asRecord) : [];
  const discounts = distributeLoyaltyDiscount(calculation);
  return items.map((item, index) => ({
    quantity: asNumber(item.quantity, 1),
    price: toMoySkladPrice(asNumber(item.productPrice)),
    ...(discounts[index] > 0 ? { discount: discounts[index] } : {}),
    assortment: meta(asString(item.assortmentHref), asString(item.assortmentType, "product")),
  }));
}

function distributeLoyaltyDiscount(calculation: JsonRecord) {
  const items = Array.isArray(calculation.items) ? calculation.items.map(asRecord) : [];
  const targetDiscount = toMoySkladPrice(asNumber(calculation.loyaltyRedemption));
  if (targetDiscount <= 0 || !items.length) return items.map(() => 0);

  const lineTotals = items.map((item) => toMoySkladPrice(asNumber(item.lineTotal)));
  const total = lineTotals.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return items.map(() => 0);

  let distributed = 0;
  const lineDiscounts = lineTotals.map((lineTotal, index) => {
    if (index === lineTotals.length - 1) return Math.max(0, targetDiscount - distributed);
    const value = Math.round(targetDiscount * lineTotal / total);
    distributed += value;
    return value;
  });

  return items.map((_item, index) => {
    const lineTotal = lineTotals[index];
    if (lineTotal <= 0) return 0;
    return Number((lineDiscounts[index] / lineTotal * 100).toFixed(6));
  });
}

function getPositionsTotal(positions: JsonRecord[]) {
  return positions.reduce((sum, position) => {
    const quantity = asNumber(position.quantity);
    const price = asNumber(position.price);
    const discount = asNumber(position.discount);
    return sum + Math.round(price * quantity * Math.max(0, 100 - discount) / 100);
  }, 0);
}

function getPaidAmount(calculation: JsonRecord) {
  return roundMoney(asNumber(calculation.prepaidTotal));
}

function getUnpaidAmount(calculation: JsonRecord) {
  return roundMoney(Math.max(0, asNumber(calculation.finalTotal) - getPaidAmount(calculation)));
}

function getReceivableAmount(calculation: JsonRecord, documentType: string) {
  if (asNumber(calculation.commission) > 0) return asNumber(calculation.netTotal);
  if (documentType === "retaildemand") return asNumber(calculation.finalTotal);
  return getUnpaidAmount(calculation);
}

function isCashPrepaymentMethod(methodName: unknown) {
  const name = asString(methodName).toLowerCase();
  return name.includes("налич") || name.includes("cash");
}

function getRetailPaymentSums(calculation: JsonRecord, documentTotal = asNumber(calculation.finalTotal)) {
  const paymentName = asString(calculation.paymentType).toLowerCase();
  const total = roundMoney(documentTotal);
  const prepaidTotal = roundMoney(asNumber(calculation.cashPrepayment) + asNumber(calculation.transferPrepayment));
  if (prepaidTotal <= 0 && (paymentName.includes("налич") || paymentName.includes("cash"))) return { cashSum: toMoySkladPrice(total), noCashSum: 0 };
  if (prepaidTotal <= 0 && (paymentName.includes("карта") || paymentName.includes("qr"))) return { cashSum: 0, noCashSum: toMoySkladPrice(total) };
  const prepaidAmount = roundMoney(Math.min(asNumber(calculation.cashPrepayment), total));
  const cashSum = isCashPrepaymentMethod(calculation.prepaymentMethodName) ? prepaidAmount : 0;
  return { cashSum: toMoySkladPrice(cashSum), noCashSum: toMoySkladPrice(total - cashSum) };
}

function buildDocumentDescription(calculation: JsonRecord) {
  const paymentName = asString(calculation.paymentType);
  const lowerPaymentName = paymentName.toLowerCase();
  const paidAmount = getPaidAmount(calculation);
  const unpaidAmount = getUnpaidAmount(calculation);
  const isDebt = lowerPaymentName.includes("долг");
  const hasSecondBank = asNumber(calculation.secondBankAmount) > 0;
  const isMixed = paidAmount > 0 && unpaidAmount > 0;
  const lines = (isMixed || hasSecondBank) && !isDebt ? [] : [`Тип оплаты: ${paymentName}.`];

  if (isDebt) {
    lines.push(`${asString(calculation.prepaymentMethodName, "Наличными")}: ${formatMoney(paidAmount)} сом.`);
    lines.push(`Не оплачено: ${formatMoney(unpaidAmount)} сом.`);
    lines.push(`Долг: ${formatMoney(unpaidAmount)} сом.`);
  } else if (hasSecondBank) {
    if (paidAmount > 0) lines.push(`${asString(calculation.prepaymentMethodName, "Наличными")}: ${formatMoney(paidAmount)} сом.`);
    if (asNumber(calculation.primaryBankAmount) > 0) lines.push(`${paymentName}: ${formatMoney(calculation.primaryBankAmount)} сом.`);
    lines.push(`${asString(calculation.secondPaymentType)}: ${formatMoney(calculation.secondBankAmount)} сом.`);
  } else if (isMixed) {
    lines.push(`${asString(calculation.prepaymentMethodName, "Наличными")}: ${formatMoney(paidAmount)} сом.`);
    lines.push(`${paymentName}: ${formatMoney(unpaidAmount)} сом.`);
  }
  if (asNumber(calculation.loyaltyRedemption) > 0) lines.push(`Бонусы списано: ${formatMoney(calculation.loyaltyRedemption)} сом.`);
  return lines.slice(0, 4).join("\n");
}

async function getActiveRetailShiftHref(token: string, retailStoreHref: string) {
  const url = new URL(`${MOYSKLAD_BASE_URL}/entity/retailshift`);
  url.searchParams.set("limit", "20");
  url.searchParams.set("filter", `retailStore=${retailStoreHref}`);
  url.searchParams.set("order", "moment,desc");
  const response = await moyskladFetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Response("Не удалось загрузить смены из МойСклад.", { status: response.status });
  const retailStoreId = getIdFromHref(retailStoreHref);
  const rows: JsonRecord[] = Array.isArray(payload?.rows) ? payload.rows.map(asRecord) : [];
  const shift = rows.find((row: JsonRecord) => {
    const shiftStoreHref = asString(asRecord(asRecord(row.retailStore).meta).href || asRecord(asRecord(row.retailstore).meta).href);
    return !row.closed && (shiftStoreHref === retailStoreHref || getIdFromHref(shiftStoreHref) === retailStoreId);
  });
  return asString(asRecord(shift?.meta).href);
}

async function createRetailShift(token: string, retailStoreHref: string, organizationHref: string) {
  const basePayload: JsonRecord = {
    retailStore: meta(retailStoreHref, "retailstore"),
  };
  const payloads = organizationHref
    ? [{ ...basePayload, organization: meta(organizationHref, "organization") }, basePayload]
    : [basePayload];

  for (const payload of payloads) {
    const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/retailshift`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const created = await response.json().catch(() => null);
    if (response.ok) return asString(asRecord(created?.meta).href);
  }
  return "";
}

async function getStoreHrefForRetailStore(token: string, retailStoreHref: string) {
  const response = await moyskladFetch(retailStoreHref, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Response("Не удалось получить точку продаж из МойСклад.", { status: response.status });
  return asString(asRecord(asRecord(payload?.store).meta).href);
}

async function getOrCreateCounterparty(token: string, input: JsonRecord) {
  if (asString(input.agentHref)) return asString(input.agentHref);
  if (input.customerMode === "retail") return getMoySkladEnvValue("AGENT_HREF");
  if (input.customerMode === "existing" && asString(input.customerHref)) return asString(input.customerHref);
  const customerName = asString(input.customerName).trim();
  if (!customerName) throw new Response("Укажите ФИО клиента.", { status: 400 });
  const payload: JsonRecord = { name: customerName, description: "Создано автоматически из Ordo CRM" };
  if (asString(input.customerPhone)) payload.phone = asString(input.customerPhone);
  if (asString(input.customerAddress)) payload.actualAddress = asString(input.customerAddress);
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/counterparty`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const created = await response.json().catch(() => null);
  if (!response.ok) throw new Response("Не удалось создать контрагента в МойСклад.", { status: response.status });
  return asString(asRecord(created?.meta).href);
}

async function createIncomingPayment(token: string, input: JsonRecord) {
  const amount = roundMoney(asNumber(input.amount));
  if (amount <= 0) return null;
  const sum = toMoySkladPrice(amount);
  const payload: JsonRecord = {
    organization: meta(asString(input.organizationHref), "organization"),
    agent: meta(asString(input.agentHref), "counterparty"),
    sum,
    description: asString(input.description, "Создано автоматически из Ordo CRM"),
    operations: [
      {
        meta: asRecord(input.demandMeta),
        linkedSum: sum,
      },
    ],
  };
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/paymentin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const created = await response.json().catch(() => null);
  if (!response.ok) throw new Response(getMoySkladError(created, "Отгрузка создана, но не удалось создать входящий платеж."), { status: response.status });
  return {
    id: asString(created?.id),
    name: asString(created?.name),
    sum: asNumber(created?.sum),
    meta: asRecord(created?.meta),
  };
}

async function createMoySkladDocument(calculation: JsonRecord, input: JsonRecord) {
  const token = getMoySkladToken();
  let documentType = asString(input.documentType || calculation.documentType || resolveDocumentType(calculation));
  const organizationHref = getMoySkladEnvValue("ORGANIZATION_HREF");
  if (input.customerMode !== "retail" && !asString(input.customerPhone).trim()) throw new Response("Укажите номер телефона клиента.", { status: 400 });
  const agentHref = await getOrCreateCounterparty(token, input);
  const storeHref = asString(input.storeHref) || getMoySkladEnvValue("STORE_HREF");
  const retailStoreHref = asString(input.retailStoreHref) || getMoySkladEnvValue("RETAIL_STORE_HREF");
  if (!organizationHref) throw new Response("Для создания документа нужен MOYSKLAD_ORGANIZATION_HREF.", { status: 500 });
  if (!["customerorder", "demand", "retaildemand"].includes(documentType)) throw new Response("MOYSKLAD_DOCUMENT_TYPE должен быть auto, customerorder, demand или retaildemand.", { status: 500 });
  if (documentType === "demand" && !storeHref) throw new Response("Для создания отгрузки нужен MOYSKLAD_STORE_HREF.", { status: 500 });
  if (documentType === "retaildemand" && !retailStoreHref) throw new Response("Для розничной продажи нужна точка продаж.", { status: 500 });

  let shiftHref = "";
  if (documentType === "retaildemand") {
    shiftHref = asString(input.retailShiftHref) || await getActiveRetailShiftHref(token, retailStoreHref).catch(() => "");
    if (!shiftHref) {
      shiftHref = await createRetailShift(token, retailStoreHref, organizationHref).catch(() => "");
    }
    if (!shiftHref) {
      if (!storeHref) throw new Response("Для создания документа без кассовой смены нужен MOYSKLAD_STORE_HREF.", { status: 500 });
      documentType = "demand";
    }
  }
  if (documentType === "customerorder") throw new Response("Создание заказа покупателя на странице продаж сейчас не используется.", { status: 400 });
  const positions = buildPositions(calculation);
  const documentTotal = fromMoySkladPrice(getPositionsTotal(positions));

  const payload: JsonRecord = {
    organization: meta(organizationHref, "organization"),
    agent: meta(agentHref, "counterparty"),
    description: buildDocumentDescription(calculation),
    positions,
  };
  const stateHref = getMoySkladEnvValue("STATE_HREF");
  if (stateHref) payload.state = meta(stateHref, "state");

  if (documentType === "retaildemand") {
    payload.retailStore = meta(retailStoreHref, "retailstore");
    const retailStoreStockHref = storeHref || await getStoreHrefForRetailStore(token, retailStoreHref);
    if (retailStoreStockHref) payload.store = meta(retailStoreStockHref, "store");
    payload.retailShift = meta(shiftHref, "retailshift");
    Object.assign(payload, getRetailPaymentSums(calculation, documentTotal));
  } else {
    payload.store = meta(storeHref, "store");
  }

  const attributes: JsonRecord[] = [];
  const attributeMap = [
    ["PAYMENT_TYPE", asString(input.paymentTypeHref) ? meta(asString(input.paymentTypeHref), "customentity") : null],
    ["EMPLOYEE", asString(input.employeeHref) ? meta(asString(input.employeeHref), "customentity") : null],
    ["RECEIVABLE", Math.round(getReceivableAmount(calculation, documentType))],
    ["PAID", Math.round(getPaidAmount(calculation))],
    ["UNPAID", Math.round(getUnpaidAmount(calculation))],
    ["COMMISSION", `${formatMoney(calculation.commission)} сом`],
    ["NET_PROFIT", Math.round(asNumber(calculation.netProfit))],
  ] as const;
  for (const [key, value] of attributeMap) {
    const href = getAttributeHref(key, documentType);
    if (href && value !== null) attributes.push({ meta: { href, type: "attributemetadata", mediaType: "application/json" }, value });
  }
  if (attributes.length) payload.attributes = attributes;

  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/${documentType}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  let created = await response.json().catch(() => null);
  if (!response.ok) {
    created = await postMoySkladDocumentWithAttributeRetry(token, documentType, payload, created);
  }
  const document = { id: asString(created?.id), name: asString(created?.name), type: documentType, moment: asString(created?.moment), sum: asNumber(created?.sum), meta: asRecord(created?.meta), webUrl: `https://online.moysklad.ru/app/#${documentType}/edit?id=${encodeURIComponent(asString(created?.id))}` } as JsonRecord;
  if (documentType === "demand" && getPaidAmount(calculation) > 0) {
    document.payment = await createIncomingPayment(token, {
      organizationHref,
      agentHref,
      demandMeta: asRecord(created?.meta),
      amount: getPaidAmount(calculation),
      description: `Оплата по отгрузке ${asString(created?.name)}`.trim(),
    });
  }
  return document;
}

async function postMoySkladDocumentWithAttributeRetry(token: string, documentType: string, originalPayload: JsonRecord, firstError: unknown) {
  const payload = structuredClone(originalPayload) as JsonRecord;
  let lastError = firstError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const badAttributeId = getMissingAttributeId(lastError);
    const attributes = Array.isArray(payload.attributes) ? payload.attributes.map(asRecord) : [];
    if (!badAttributeId || !attributes.length) {
      throw new Response("МойСклад вернул ошибку при создании документа.", { status: 400 });
    }

    const nextAttributes = attributes.filter((attribute) =>
      getIdFromHref(asString(asRecord(attribute.meta).href)) !== badAttributeId
    );
    if (nextAttributes.length === attributes.length) {
      throw new Response("МойСклад вернул ошибку при создании документа.", { status: 400 });
    }
    if (nextAttributes.length) payload.attributes = nextAttributes;
    else delete payload.attributes;

    const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/${documentType}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const created = await response.json().catch(() => null);
    if (response.ok) return created;
    lastError = created;
  }
  throw new Response("Не удалось создать документ: слишком много некорректных доп.полей.", { status: 500 });
}

function getMissingAttributeId(payload: unknown) {
  const record = asRecord(payload);
  const errors = Array.isArray(record.errors) ? record.errors.map(asRecord) : [];
  for (const item of errors) {
    const message = asString(item.error);
    if (asNumber(item.code) !== 1021 || !message.includes("AttributeMetadata")) continue;
    return message.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
  }
  return "";
}

function orderFromDraft(draft: JsonRecord, data: AppData): LocalOrder {
  const result = calculateDraft(draft);
  const items = Array.isArray(draft.items) ? draft.items.map(asRecord) : [];
  const id = randomUUID();
  const employee = data.users.find((user) => user.id === draft.employeeId);
  const store = data.attendanceStores.find((item) => item.id === draft.retailStoreId || item.name === draft.retailStoreId);
  return {
    id,
    type: draft.customerMode === "existing" ? "demand" : "retaildemand",
    name: `ORDO-${String(data.orders.length + 1).padStart(5, "0")}`,
    moment: new Date().toISOString(),
    amount: asNumber(result.finalTotal),
    paid: getPaidAmount(result),
    unpaid: getUnpaidAmount(result),
    netProfit: asNumber(result.netProfit),
    branchName: asString(draft.branchName ?? draft.branchId, "Аю-Гранд"),
    storeName: store?.name || asString(draft.retailStoreName ?? draft.retailStoreId, "Аю-Гранд"),
    customerName: asString(draft.customerName, "Розничный покупатель"),
    customerPhone: asString(draft.customerPhone),
    customerType: draft.customerMode === "existing" ? "legal" : "individual",
    employeeName: employee?.name || asString(draft.employeeName, ""),
    paymentType: asString(draft.paymentType, "cash"),
    comment: asString(draft.comment),
    products: items.map((item) => ({
      code: asString(item.code ?? item.sku),
      name: asString(item.productName ?? item.name),
      quantity: asNumber(item.quantity, 1),
      price: asNumber(item.productPrice ?? item.price),
      sum: item.isGift === true ? 0 : asNumber(item.quantity, 1) * asNumber(item.productPrice ?? item.price),
      isGift: item.isGift === true,
    })),
  };
}

function normalizeReportDate(value: string, side: "from" | "to") {
  const date = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
  return `${date} ${side === "to" ? "23:59:59" : "00:00:00"}`;
}

function fromMoySkladPrice(value: unknown) {
  return roundMoney(asNumber(value) / 100);
}

function getDocumentTypeLabel(type: string) {
  if (type === "retaildemand") return "Продажа";
  if (type === "demand") return "Отгрузка";
  if (type === "retailsalesreturn") return "Возврат продажи";
  if (type === "salesreturn") return "Возврат отгрузки";
  return "Документ";
}

function normalizeCounterpartyType(agent: JsonRecord) {
  const value = [agent.companyType, agent.legalTitle, agent.name].map(String).join(" ").toLowerCase();
  if (value.includes("entrepreneur") || value.includes("ип")) return "entrepreneur";
  if (value.includes("legal") || value.includes("company") || value.includes("юр")) return "legal";
  return agent.inn ? "legal" : "individual";
}

function getCounterpartyTypeLabel(type: string) {
  if (type === "entrepreneur") return "ИП";
  if (type === "legal") return "Юрлицо";
  return "Физлицо";
}

function getReportPaymentType(document: JsonRecord) {
  const attr = getReportAttributeValue(document, "PAYMENT_TYPE", asString(document.reportDocumentType || asRecord(document.meta).type));
  if (attr) return typeof attr === "object" ? asString(asRecord(attr).name) : String(attr);
  return asString(document.description).match(/Тип оплаты:\s*([^\n.]+)/i)?.[1]?.trim() || "";
}

function getReportAttributeValue(document: JsonRecord, attribute: string, documentType: string) {
  const attributeHref = getAttributeHref(attribute, documentType);
  if (!attributeHref || !Array.isArray(document.attributes)) return undefined;
  const attributeId = getIdFromHref(attributeHref);
  const found = document.attributes.map(asRecord).find((entry) => {
    const href = asString(asRecord(entry.meta).href);
    return href === attributeHref || getIdFromHref(href) === attributeId;
  });
  return found?.value;
}

function getReportTextAttribute(document: JsonRecord, attribute: string, documentType: string) {
  const value = getReportAttributeValue(document, attribute, documentType);
  if (!value) return "";
  if (typeof value === "object") return asString(asRecord(value).name || asRecord(value).href || asRecord(asRecord(value).meta).href);
  return String(value);
}

function getReportNumberAttribute(document: JsonRecord, attribute: string, documentType: string) {
  const value = getReportAttributeValue(document, attribute, documentType);
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReportMoneyFromTextAttribute(document: JsonRecord, attribute: string, documentType: string) {
  const value = getReportAttributeValue(document, attribute, documentType);
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  const match = String(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? asNumber(match[0]) : 0;
}

function isUsdCurrency(currency: JsonRecord) {
  const value = [currency.isoCode, currency.name, currency.fullName].filter(Boolean).join(" ").toLowerCase();
  return value.includes("usd") || value.includes("доллар");
}

function getReportUsdRate() {
  const rate = Number(process.env.MOYSKLAD_REPORT_USD_RATE || process.env.MOYSKLAD_COST_USD_RATE || 88);
  return Number.isFinite(rate) && rate > 0 ? rate : 88;
}

function getReportPositionCostTotal(position: JsonRecord) {
  const assortment = asRecord(position.assortment);
  const buyPrice = asRecord(assortment.buyPrice);
  const rawCost = fromMoySkladPrice(buyPrice.value);
  if (rawCost <= 0) return 0;
  const currency = asRecord(buyPrice.currency);
  const cost = isUsdCurrency(currency) ? rawCost * getReportUsdRate() : rawCost;
  return roundMoney(cost * asNumber(position.quantity));
}

function mapMoySkladReportDocument(value: unknown, documentType: string) {
  const row = asRecord(value);
  const positionsRecord = asRecord(row.positions);
  const positions = Array.isArray(positionsRecord.rows) ? positionsRecord.rows.map(asRecord) : [];
  const agent = asRecord(row.agent);
  const customerType = normalizeCounterpartyType(agent);
  const amount = fromMoySkladPrice(row.sum);
  const paidAttribute = getReportNumberAttribute(row, "PAID", documentType);
  const unpaidAttribute = getReportNumberAttribute(row, "UNPAID", documentType);
  const paid = documentType === "retaildemand"
    ? paidAttribute !== null
      ? paidAttribute
      : roundMoney(fromMoySkladPrice(row.cashSum) + fromMoySkladPrice(row.noCashSum))
    : Math.max(fromMoySkladPrice(row.payedSum), paidAttribute ?? 0);
  const unpaid = unpaidAttribute !== null ? unpaidAttribute : Math.max(0, roundMoney(amount - paid));
  const costTotal = roundMoney(positions.reduce((sum, position) => sum + getReportPositionCostTotal(position), 0));
  const commission = roundMoney(getReportMoneyFromTextAttribute(row, "COMMISSION", documentType));
  const netProfitAttribute = getReportNumberAttribute(row, "NET_PROFIT", documentType);
  const netProfit = netProfitAttribute !== null ? netProfitAttribute : roundMoney(amount - commission - costTotal);
  const products = positions.map((position: JsonRecord) => {
    const assortment = asRecord(position.assortment);
    const folder = asRecord(assortment.productFolder);
    const price = fromMoySkladPrice(position.price);
    const quantity = asNumber(position.quantity);
    return {
      code: asString(assortment.code),
      name: asString(assortment.name ?? position.name, "Товар"),
      categoryName: asString(folder.name),
      categoryPath: asString(folder.pathName),
      quantity,
      price,
      sum: roundMoney(price * quantity),
      isGift: price <= 0,
    };
  });
  return {
    id: asString(row.id),
    type: documentType,
    typeLabel: getDocumentTypeLabel(documentType),
    name: asString(row.name),
    moment: normalizeApiMoment(row.moment ?? row.created),
    amount,
    paid,
    unpaid,
    commission,
    netProfit,
    storeName: asString(asRecord(row.retailStore).name || asRecord(row.store).name),
    organizationName: asString(asRecord(row.organization).name),
    customerId: asString(agent.id) || getIdFromHref(asString(asRecord(agent.meta).href)),
    customerHref: asString(asRecord(agent.meta).href),
    customerName: asString(agent.name),
    customerType,
    customerTypeLabel: getCounterpartyTypeLabel(customerType),
    customerPhone: asString(agent.phone),
    customerInn: asString(agent.inn),
    customerAddress: asString(agent.actualAddress ?? agent.legalAddress),
    employeeName: getReportTextAttribute(row, "EMPLOYEE", documentType),
    paymentType: getReportPaymentType(row),
    comment: asString(row.description),
    webUrl: `https://online.moysklad.ru/app/#${documentType}/edit?id=${encodeURIComponent(asString(row.id))}`,
    productText: products.map((item: { name: string; quantity: number }) => `${item.name} x ${item.quantity}`).join(", "),
    products,
  };
}

async function loadMoySkladDocuments(documentType: string, dateFrom: string, dateTo: string, options: Record<string, string | number> = {}) {
  const rows: JsonRecord[] = [];
  let offset = Math.max(0, Number(options.offset) || 0);
  const maxRows = Math.max(1, Math.min(1000, Number(options.maxRows) || 1000));
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
  while (rows.length < maxRows) {
    const filters = [`moment>=${dateFrom}`, `moment<=${dateTo}`];
    if ((documentType === "retaildemand" || documentType === "retailsalesreturn") && options.retailStoreHref) filters.push(`retailStore=${options.retailStoreHref}`);
    if ((documentType === "demand" || documentType === "salesreturn") && options.storeHref) filters.push(`store=${options.storeHref}`);
    if (options.filterAgentHref) filters.push(`agent=${options.filterAgentHref}`);
    const page = await moysklad(`/entity/${documentType}`, {
      limit: String(limit),
      offset: String(offset),
      order: "moment,desc",
      filter: filters.join(";"),
      expand: "agent,organization,store,retailStore,positions,positions.assortment,positions.assortment.productFolder",
    });
    const pageRows = Array.isArray(page.rows) ? page.rows.map(asRecord) : [];
    rows.push(...pageRows.slice(0, maxRows - rows.length));
    if (pageRows.length < limit) break;
    offset += limit;
  }
  return rows;
}

function canViewReportProfit(user: CrmUser | null) {
  if (!user) return false;
  if (["admin", "owner", "accountant"].includes(user.role)) return true;
  return user.permissions.includes("reportProfit");
}

function sanitizeSalesReportForUser(report: { rows: Array<Record<string, unknown>>; canViewProfit: boolean; totals?: JsonRecord; dateFrom?: string; dateTo?: string }, user: CrmUser | null) {
  const allowed = canViewReportProfit(user);
  if (allowed) return { ...report, canViewProfit: true };
  return {
    ...report,
    canViewProfit: false,
    rows: report.rows.map((row) => {
      const next = { ...row };
      delete next.netProfit;
      return next;
    }),
    totals: report.totals ? { ...report.totals, netProfit: 0 } : undefined,
  };
}

async function getMoySkladSalesReport(url: URL, user?: CrmUser | null) {
  const dateFrom = normalizeReportDate(url.searchParams.get("dateFrom") || "", "from");
  const dateTo = normalizeReportDate(url.searchParams.get("dateTo") || "", "to");
  const requested = url.searchParams.get("documentType") || "";
  const allowed = ["retaildemand", "demand", "retailsalesreturn", "salesreturn"];
  const documentTypes = allowed.includes(requested) ? [requested] : allowed;
  const customerType = url.searchParams.get("customerType") || "";
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const groups = await Promise.all(documentTypes.map((type) => loadMoySkladDocuments(type, dateFrom, dateTo, {
    retailStoreHref: url.searchParams.get("retailStoreHref") || "",
    storeHref: url.searchParams.get("storeHref") || "",
  })));
  let rows = groups.flatMap((group, index) => group.map((row) => mapMoySkladReportDocument(row, documentTypes[index])));
  if (customerType) rows = rows.filter((row) => row.customerType === customerType);
  if (search) {
    const first = rows.find((row) => [row.customerName, row.customerPhone, row.customerInn, row.name, row.productText].join(" ").toLowerCase().includes(search));
    const key = first?.customerHref || "";
    rows = key ? rows.filter((row) => row.customerHref === key) : [];
  }
  const sortedRows = rows.sort((a, b) => new Date(b.moment).getTime() - new Date(a.moment).getTime());
  const totals = sortedRows.reduce((sum, row) => ({
    documents: sum.documents + 1,
    amount: roundMoney(sum.amount + asNumber(row.amount)),
    paid: roundMoney(sum.paid + asNumber(row.paid)),
    unpaid: roundMoney(sum.unpaid + asNumber(row.unpaid)),
    commission: roundMoney(sum.commission + asNumber(row.commission)),
    netProfit: roundMoney(sum.netProfit + asNumber(row.netProfit)),
  }), { documents: 0, amount: 0, paid: 0, unpaid: 0, commission: 0, netProfit: 0 });
  return sanitizeSalesReportForUser({
    dateFrom: url.searchParams.get("dateFrom") || "",
    dateTo: url.searchParams.get("dateTo") || "",
    rows: sortedRows,
    totals,
    canViewProfit: true,
  }, user || null);
}

async function createReportReturn(payload: JsonRecord) {
  const documentType = asString(payload.documentType);
  const documentId = asString(payload.documentId);
  const productIndex = Math.trunc(asNumber(payload.productIndex));
  const quantity = asNumber(payload.quantity, 0);
  if (!["retaildemand", "demand"].includes(documentType)) throw new Response("Возврат можно создать только по продаже или отгрузке.", { status: 400 });
  if (!documentId) throw new Response("Не найден документ для возврата.", { status: 400 });
  if (productIndex < 0) throw new Response("Не найден товар для возврата.", { status: 400 });
  if (!(quantity > 0)) throw new Response("Количество возврата должно быть больше нуля.", { status: 400 });

  const token = getMoySkladToken();
  const originalResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/${documentType}/${encodeURIComponent(documentId)}?expand=agent,organization,store,retailStore,retailShift,positions,positions.assortment`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const original = asRecord(await originalResponse.json().catch(() => null));
  if (!originalResponse.ok) throw new Response(getMoySkladError(original, "Не удалось загрузить исходный документ для возврата."), { status: originalResponse.status });

  const originalPositions = asRecord(original.positions);
  const positions = Array.isArray(originalPositions.rows) ? originalPositions.rows.map(asRecord) : [];
  const position = positions[productIndex];
  if (!position) throw new Response("Товар не найден в документе.", { status: 400 });
  const originalQuantity = asNumber(position.quantity, 0);
  if (quantity > originalQuantity) throw new Response("Количество возврата больше количества в документе.", { status: 400 });

  const returnType = documentType === "retaildemand" ? "retailsalesreturn" : "salesreturn";
  const bodyPayload: JsonRecord = {
    organization: original.organization,
    agent: original.agent,
    description: `Возврат товара из документа ${asString(original.name)}`.trim(),
    positions: [
      {
        quantity,
        price: asNumber(position.price),
        assortment: position.assortment,
      },
    ],
  };
  if (documentType === "retaildemand") {
    bodyPayload.retailDemand = original.meta;
    bodyPayload.retailStore = original.retailStore;
    if (asString(asRecord(asRecord(original.retailShift).meta).href)) bodyPayload.retailShift = original.retailShift;
    const fullQuantity = originalQuantity > 0 ? quantity / originalQuantity : 0;
    const cashSum = roundMoney(fromMoySkladPrice(asRecord(original).cashSum) * fullQuantity);
    const noCashSum = roundMoney(fromMoySkladPrice(asRecord(original).noCashSum) * fullQuantity);
    bodyPayload.cashSum = toMoySkladPrice(cashSum);
    bodyPayload.noCashSum = toMoySkladPrice(noCashSum);
    if (original.store) bodyPayload.store = original.store;
  } else {
    bodyPayload.demand = original.meta;
    if (original.store) bodyPayload.store = original.store;
  }

  const createResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/${returnType}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(bodyPayload),
  });
  const created = asRecord(await createResponse.json().catch(() => null));
  if (!createResponse.ok) throw new Response(getMoySkladError(created, "Не удалось создать возврат."), { status: createResponse.status });
  return {
    document: {
      id: asString(created.id),
      name: asString(created.name),
      type: returnType,
      webUrl: `https://online.moysklad.ru/app/#${returnType}/edit?id=${encodeURIComponent(asString(created.id))}`,
    },
  };
}

function normalizePaymentAnalyticsKey(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function isBankCommissionPaymentName(name: unknown) {
  const value = normalizePaymentAnalyticsKey(name);
  if (!value || value.includes("налич") || value.includes("долг") || value.includes("бонус")) return false;
  return /qr|банк|mbank|m\+|мбанк|мплюс|optima|оптима|bakai|бакай|o!|visa|mastercard|терминал|перевод|карт/i.test(value);
}

function parseBankPaymentLines(description: string) {
  return String(description || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(-?\d[\d\s.,]*)\s*сом/i);
      if (!match) return null;
      const amount = Number(match[2].replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(amount)) return null;
      return { name: match[1].replace(/\.+$/, "").trim(), amount: roundMoney(amount) };
    })
    .filter((item): item is { name: string; amount: number } => Boolean(item));
}

function extractBankCommissionPayments(row: Record<string, unknown>, paymentTypeMap: Map<string, PaymentOption>) {
  const parsedLines = parseBankPaymentLines(asString(row.comment));
  const bankLines = parsedLines.filter((line) => isBankCommissionPaymentName(line.name));
  const effectiveEntries = bankLines.length
    ? bankLines
    : isBankCommissionPaymentName(asString(row.paymentType))
      ? [{ name: asString(row.paymentType), amount: roundMoney(asNumber(row.amount)) }]
      : [];

  return effectiveEntries
    .filter((entry) => entry.amount > 0)
    .map((entry, index) => {
      const typeMeta = paymentTypeMap.get(normalizePaymentAnalyticsKey(entry.name));
      const parsed = parsePaymentType(entry.name);
      const rate = asNumber(typeMeta?.rate, getPaymentRate(parsed.provider, parsed.months));
      const commission = roundMoney(entry.amount * rate);
      const bankName = typeMeta?.provider || parsed.provider || entry.name;
      return {
        id: `${asString(row.id)}:${index}`,
        saleId: asString(row.id),
        saleName: asString(row.name),
        customerName: asString(row.customerName),
        moment: asString(row.moment),
        paymentType: entry.name,
        bankName,
        amount: entry.amount,
        rate: roundMoney(rate * 100),
        commission,
        netAmount: roundMoney(entry.amount - commission),
        storeName: asString(row.storeName),
        webUrl: asString(row.webUrl),
      };
    });
}

async function getBankCommissionAnalytics(url: URL) {
  const report = await getMoySkladSalesReport(url);
  const remotePaymentTypes = await getMoySkladCustomEntityOptions(String(process.env.MOYSKLAD_PAYMENT_TYPE_CUSTOM_ENTITY_ID || "").trim(), paymentTypes);
  const paymentTypeMap = new Map(remotePaymentTypes.map((item) => [normalizePaymentAnalyticsKey(item.name), item]));
  const bankFilter = normalizePaymentAnalyticsKey(url.searchParams.get("bank") || "");
  const paymentTypeFilter = normalizePaymentAnalyticsKey(url.searchParams.get("paymentType") || "");
  const payments = report.rows
    .flatMap((row) => extractBankCommissionPayments(row, paymentTypeMap))
    .filter((payment) => !bankFilter || normalizePaymentAnalyticsKey(payment.bankName) === bankFilter)
    .filter((payment) => !paymentTypeFilter || normalizePaymentAnalyticsKey(payment.paymentType) === paymentTypeFilter);

  const byType = new Map<string, {
    paymentType: string;
    bankName: string;
    turnover: number;
    commission: number;
    netAmount: number;
    paymentCount: number;
    payments: typeof payments;
  }>();
  for (const payment of payments) {
    const key = payment.paymentType;
    const current = byType.get(key) || {
      paymentType: payment.paymentType,
      bankName: payment.bankName,
      turnover: 0,
      commission: 0,
      netAmount: 0,
      paymentCount: 0,
      payments: [],
    };
    current.turnover = roundMoney(current.turnover + payment.amount);
    current.commission = roundMoney(current.commission + payment.commission);
    current.netAmount = roundMoney(current.netAmount + payment.netAmount);
    current.paymentCount += 1;
    current.payments.push(payment);
    byType.set(key, current);
  }

  const totals = payments.reduce((sum, payment) => ({
    turnover: roundMoney(sum.turnover + payment.amount),
    commission: roundMoney(sum.commission + payment.commission),
    netAmount: roundMoney(sum.netAmount + payment.netAmount),
    paymentCount: sum.paymentCount + 1,
  }), { turnover: 0, commission: 0, netAmount: 0, paymentCount: 0 });
  const rows = [...byType.values()].map((row) => ({
    ...row,
    averageRate: row.turnover > 0 ? roundMoney(row.commission / row.turnover * 100) : 0,
    shareOfTotalCommission: totals.commission > 0 ? roundMoney(row.commission / totals.commission * 100) : 0,
  })).sort((left, right) => right.commission - left.commission);
  return {
    rows,
    bankOptions: [...new Set(payments.map((payment) => payment.bankName).filter(Boolean))],
    paymentTypeOptions: [...new Set(payments.map((payment) => payment.paymentType).filter(Boolean))],
    totals: {
      ...totals,
      averageRate: totals.turnover > 0 ? roundMoney(totals.commission / totals.turnover * 100) : 0,
      topCommissionBank: rows[0] ? { paymentType: rows[0].paymentType, bankName: rows[0].bankName } : null,
    },
  };
}

async function getMoySkladReconciliation(url: URL) {
  const limit = Math.max(20, Math.min(100, Number(url.searchParams.get("limit")) || 60));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const customerType = url.searchParams.get("customerType") || "";
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const dateFrom = normalizeReportDate(url.searchParams.get("dateFrom") || "2020-01-01", "from");
  const dateTo = normalizeReportDate(url.searchParams.get("dateTo") || new Date().toISOString().slice(0, 10), "to");
  const cacheKey = buildReconciliationCacheKey({ dateFrom, dateTo, customerType, search });
  const desiredCount = offset + limit;
  const state = await ensureReconciliationScanState(cacheKey, { dateFrom, dateTo, customerType, search }, desiredCount);
  const allDebtors = getSortedReconciliationDebtors(state);
  const debtors = allDebtors.slice(offset, offset + limit).map(mapReconciliationDebtorAggregate);
  const totals = allDebtors.reduce((sum, debtor) => ({
    debt: roundMoney(sum.debt + debtor.debt),
    paid: roundMoney(sum.paid + debtor.paid),
    debtors: sum.debtors + 1,
    documents: sum.documents + debtor.documentCount,
  }), { debt: 0, paid: 0, debtors: 0, documents: 0 });
  return {
    debtors,
    totals,
    loadedAt: state.loadedAt,
    truncated: state.truncated,
    partial: state.partial,
    page: {
      offset,
      limit,
      nextOffset: offset + limit,
      hasMore: state.completed ? offset + limit < allDebtors.length : true,
    },
  };
}

function buildReconciliationCacheKey(input: { dateFrom: string; dateTo: string; customerType: string; search: string }) {
  return [input.dateFrom, input.dateTo, input.customerType, input.search].join("|");
}

function getFreshReconciliationScanState(cacheKey: string) {
  const cached = reconciliationListCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > RECONCILIATION_LIST_CACHE_TTL_MS) {
    reconciliationListCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function createReconciliationScanState(): ReconciliationScanState {
  return {
    createdAt: Date.now(),
    loadedAt: new Date().toISOString(),
    debtorsByKey: new Map(),
    scannedOffsets: { retaildemand: 0, demand: 0 },
    completed: false,
    partial: true,
    truncated: true,
  };
}

function matchesReconciliationDocument(document: ReconciliationDocument, filters: { customerType: string; search: string }) {
  if (document.unpaid <= 0) return false;
  if (filters.customerType && document.customerType !== filters.customerType) return false;
  if (!filters.search) return true;
  return [document.customerName, document.customerPhone, document.customerInn, document.name]
    .join(" ")
    .toLowerCase()
    .includes(filters.search);
}

function addReconciliationDocumentsToState(state: ReconciliationScanState, documents: ReconciliationDocument[]) {
  for (const document of documents) {
    const key = document.customerHref || document.customerId || document.customerName;
    const existing = state.debtorsByKey.get(key) || {
      id: document.customerId || key,
      href: document.customerHref,
      name: document.customerName || "Без имени",
      customerType: document.customerType,
      customerTypeLabel: document.customerTypeLabel,
      phone: document.customerPhone,
      inn: document.customerInn,
      actualAddress: document.customerAddress,
      lastDocumentName: "",
      lastMoment: "",
      documentCount: 0,
      paid: 0,
      debt: 0,
      amount: 0,
    };
    existing.documentCount += 1;
    existing.paid = roundMoney(existing.paid + document.paid);
    existing.debt = roundMoney(existing.debt + document.unpaid);
    existing.amount = roundMoney(existing.amount + document.amount);
    if (!existing.lastMoment || new Date(document.moment) > new Date(existing.lastMoment)) {
      existing.lastMoment = document.moment;
      existing.lastDocumentName = document.name;
    }
    state.debtorsByKey.set(key, existing);
  }
}

function getSortedReconciliationDebtors(state: ReconciliationScanState) {
  return [...state.debtorsByKey.values()].sort((left, right) =>
    right.debt - left.debt
    || new Date(right.lastMoment).getTime() - new Date(left.lastMoment).getTime()
    || left.name.localeCompare(right.name, "ru")
  );
}

function mapReconciliationDebtorAggregate(debtor: ReconciliationDebtorAggregate) {
  return {
    id: debtor.id,
    href: debtor.href,
    name: debtor.name,
    customerType: debtor.customerType,
    customerTypeLabel: debtor.customerTypeLabel,
    phone: debtor.phone,
    inn: debtor.inn,
    actualAddress: debtor.actualAddress,
    lastDocumentName: debtor.lastDocumentName,
    lastMoment: debtor.lastMoment,
    documentCount: debtor.documentCount,
    amount: debtor.amount,
    paid: debtor.paid,
    debt: debtor.debt,
  };
}

async function ensureReconciliationScanState(
  cacheKey: string,
  filters: { dateFrom: string; dateTo: string; customerType: string; search: string },
  desiredCount: number,
) {
  const state = getFreshReconciliationScanState(cacheKey) || createReconciliationScanState();
  if (!reconciliationListCache.has(cacheKey)) {
    reconciliationListCache.set(cacheKey, state);
  }
  while (!state.completed && getSortedReconciliationDebtors(state).length < desiredCount) {
    const [retailRows, demandRows] = await Promise.all([
      loadMoySkladDocuments("retaildemand", filters.dateFrom, filters.dateTo, {
        offset: state.scannedOffsets.retaildemand,
        limit: RECONCILIATION_BATCH_SIZE,
        maxRows: RECONCILIATION_BATCH_SIZE,
      }),
      loadMoySkladDocuments("demand", filters.dateFrom, filters.dateTo, {
        offset: state.scannedOffsets.demand,
        limit: RECONCILIATION_BATCH_SIZE,
        maxRows: RECONCILIATION_BATCH_SIZE,
      }),
    ]);
    state.scannedOffsets.retaildemand += retailRows.length;
    state.scannedOffsets.demand += demandRows.length;
    const mapped = [
      ...retailRows.map((row) => mapMoySkladReportDocument(row, "retaildemand")),
      ...demandRows.map((row) => mapMoySkladReportDocument(row, "demand")),
    ].filter((document) => matchesReconciliationDocument(document, filters));
    addReconciliationDocumentsToState(state, mapped);
    state.loadedAt = new Date().toISOString();
    if (retailRows.length < RECONCILIATION_BATCH_SIZE && demandRows.length < RECONCILIATION_BATCH_SIZE) {
      state.completed = true;
      state.truncated = false;
    }
  }
  return state;
}

function mapReconciliationPayment(value: unknown) {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name),
    moment: normalizeApiMoment(row.moment ?? row.created),
    amount: fromMoySkladPrice(row.sum),
    organizationName: asString(asRecord(row.organization).name),
    agentHref: asString(asRecord(asRecord(row.agent).meta).href),
    description: asString(row.description),
    webUrl: `https://online.moysklad.ru/app/#paymentin/edit?id=${encodeURIComponent(asString(row.id))}`,
  };
}

function applyPaymentsToDebtDocuments(documents: Array<ReturnType<typeof mapMoySkladReportDocument>>, payments: Array<ReturnType<typeof mapReconciliationPayment>>) {
  const sortedDocuments = documents
    .map((document) => ({
      ...document,
      debt: roundMoney(asNumber(document.unpaid)),
      originalDebt: roundMoney(asNumber(document.unpaid)),
      appliedPayments: [] as Array<{ id: string; name: string; amount: number; moment: string }>,
    }))
    .sort((left, right) => new Date(left.moment).getTime() - new Date(right.moment).getTime());

  const sortedPayments = [...payments].sort((left, right) => new Date(left.moment).getTime() - new Date(right.moment).getTime());

  for (const payment of sortedPayments) {
    let remaining = roundMoney(payment.amount);
    for (const document of sortedDocuments) {
      if (remaining <= 0 || document.debt <= 0) continue;
      const applied = roundMoney(Math.min(document.debt, remaining));
      if (applied <= 0) continue;
      document.debt = roundMoney(document.debt - applied);
      document.paid = roundMoney(asNumber(document.paid) + applied);
      document.appliedPayments.push({
        id: payment.id,
        name: payment.name,
        amount: applied,
        moment: payment.moment,
      });
      remaining = roundMoney(remaining - applied);
    }
  }

  return sortedDocuments
    .filter((document) => document.debt > 0)
    .sort((left, right) => new Date(right.moment).getTime() - new Date(left.moment).getTime());
}

function buildReconciliationAct(
  customerName: string,
  documents: Array<ReturnType<typeof mapMoySkladReportDocument>>,
  payments: Array<ReturnType<typeof mapReconciliationPayment>>,
) {
  const documentRows = documents.map((document) => ({
    id: `doc:${document.id}`,
    moment: document.moment,
    operation: `${document.typeLabel} (${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(new Date(document.moment))}, № ${document.name})`,
    debit: roundMoney(document.amount),
    credit: 0,
  }));
  const paymentRows = payments.map((payment) => ({
    id: `payment:${payment.id}`,
    moment: payment.moment,
    operation: `Входящий платёж (${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(new Date(payment.moment))}, № ${payment.name})`,
    debit: 0,
    credit: roundMoney(payment.amount),
  }));
  const rows = [...documentRows, ...paymentRows].sort((left, right) => new Date(left.moment).getTime() - new Date(right.moment).getTime());
  const totals = rows.reduce((sum, row) => ({
    debit: roundMoney(sum.debit + row.debit),
    credit: roundMoney(sum.credit + row.credit),
  }), { debit: 0, credit: 0 });
  return {
    customerName,
    date: new Intl.DateTimeFormat("ru-RU", { dateStyle: "short" }).format(new Date()),
    rows,
    totals: {
      ...totals,
      saldo: roundMoney(totals.debit - totals.credit),
    },
  };
}

async function getReconciliationDebtorDetails(id: string, url: URL) {
  const dateFrom = normalizeReportDate(url.searchParams.get("dateFrom") || "2020-01-01", "from");
  const dateTo = normalizeReportDate(url.searchParams.get("dateTo") || new Date().toISOString().slice(0, 10), "to");
  const cacheKey = [id, dateFrom, dateTo].join("|");
  const cached = reconciliationDetailsCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt <= RECONCILIATION_DETAILS_CACHE_TTL_MS) {
    return cached.value;
  }
  const customerHref = `${MOYSKLAD_BASE_URL}/entity/counterparty/${encodeURIComponent(id)}`;
  const groups = await Promise.all(["retaildemand", "demand"].map((type) => loadMoySkladDocuments(type, dateFrom, dateTo, {
    filterAgentHref: customerHref,
  })));
  const documents = groups.flatMap((group, index) => group.map((row) => mapMoySkladReportDocument(row, index === 0 ? "retaildemand" : "demand")));
  const debtorDocuments = documents.filter((document) => document.unpaid > 0);
  if (!debtorDocuments.length) throw new Response("Должник не найден", { status: 404 });

  const paymentRows = await moyskladRows("/entity/paymentin", {
    limit: "100",
    order: "moment,desc",
    filter: customerHref ? `agent=${customerHref}` : "",
    expand: "agent,organization",
  }).catch(() => []);
  const payments = paymentRows.map(mapReconciliationPayment);
  const adjustedDocuments = applyPaymentsToDebtDocuments(debtorDocuments, payments);
  const debtor = {
    id,
    href: customerHref,
    name: debtorDocuments[0].customerName || "Без имени",
    customerType: debtorDocuments[0].customerType,
    customerTypeLabel: debtorDocuments[0].customerTypeLabel,
    phone: debtorDocuments[0].customerPhone,
    inn: debtorDocuments[0].customerInn,
    actualAddress: debtorDocuments[0].customerAddress,
    lastDocumentName: debtorDocuments[0].name,
    lastMoment: debtorDocuments[0].moment,
    documentCount: adjustedDocuments.length,
    amount: roundMoney(debtorDocuments.reduce((sum, document) => sum + document.amount, 0)),
    paid: roundMoney(adjustedDocuments.reduce((sum, document) => sum + asNumber(document.paid), 0)),
    debt: roundMoney(adjustedDocuments.reduce((sum, document) => sum + asNumber(document.debt), 0)),
  };
  const result = {
    debtor,
    totals: {
      debt: debtor.debt,
      amount: debtor.amount,
      paid: debtor.paid,
      documents: adjustedDocuments.length,
    },
    documents: adjustedDocuments.map((document) => ({
      id: document.id,
      name: document.name,
      type: document.type,
      typeLabel: document.typeLabel,
      moment: document.moment,
      organizationName: document.organizationName,
      storeName: document.storeName,
      amount: document.amount,
      paid: document.paid,
      debt: document.debt,
      originalDebt: document.originalDebt,
      paymentType: document.paymentType,
      comment: document.comment,
      customerId: document.customerId,
      customerHref: document.customerHref,
      customerName: document.customerName,
      customerPhone: document.customerPhone,
      customerInn: document.customerInn,
      customerAddress: document.customerAddress,
      webUrl: document.webUrl,
      appliedPayments: document.appliedPayments,
    })),
    payments,
    act: buildReconciliationAct(debtor.name, debtorDocuments, payments),
  };
  reconciliationDetailsCache.set(cacheKey, { createdAt: Date.now(), value: result });
  return result;
}

function mapPriceType(value: unknown) {
  const row = asRecord(value);
  return { id: asString(row.id), name: asString(row.name), href: asString(asRecord(row.meta).href) };
}

function parseMarkedJsonFromDescription(description: unknown, startMarker: string, endMarker: string) {
  const text = String(description || "");
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) return null;
  try {
    const encoded = text.slice(startIndex + startMarker.length, endIndex).trim();
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function setMarkedJsonInDescription(description: unknown, startMarker: string, endMarker: string, value: unknown) {
  const text = String(description || "");
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  const clean = startIndex >= 0 && endIndex > startIndex
    ? `${text.slice(0, startIndex)}${text.slice(endIndex + endMarker.length)}`.trim()
    : text.trim();
  if (!value) return clean;
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [clean, `${startMarker}\n${encoded}\n${endMarker}`].filter(Boolean).join("\n\n");
}

function parsePriceFormulaTemplate(description: unknown) {
  return parseMarkedJsonFromDescription(description, PRICE_FORMULA_TEMPLATE_START, PRICE_FORMULA_TEMPLATE_END);
}

async function getMoySkladPriceTypes() {
  const token = getMoySkladToken();
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/context/companysettings/pricetype`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Response(getMoySkladError(payload, "Не удалось загрузить типы цен."), { status: response.status });
  return Array.isArray(payload) ? payload.map(mapPriceType).filter((item) => item.href) : [];
}

async function getMoySkladProductFolders() {
  const rows = await moyskladRows("/entity/productfolder", { limit: "100", order: "pathName,asc" });
  return rows.map((value) => {
    const row = asRecord(value);
    return {
      id: asString(row.id),
      href: asString(asRecord(row.meta).href),
      name: asString(row.name),
      pathName: asString(row.pathName),
      template: parsePriceFormulaTemplate(row.description),
    };
  });
}

function mapAccountingProduct(value: unknown) {
  const row = asRecord(value);
  const salePrices = Array.isArray(row.salePrices) ? row.salePrices.map(asRecord) : [];
  const folder = asRecord(row.productFolder);
  const buyPrice = asRecord(row.buyPrice);
  const buyPriceCurrency = asRecord(buyPrice.currency);
  const minPrice = asRecord(row.minPrice);
  const minPriceCurrency = asRecord(minPrice.currency);
  return {
    id: asString(row.id),
    href: asString(asRecord(row.meta).href),
    type: asString(asRecord(row.meta).type, "product"),
    name: asString(row.name),
    code: asString(row.code),
    article: asString(row.article),
    archived: row.archived === true,
    folder: asString(asRecord(folder.meta).href) ? {
      href: asString(asRecord(folder.meta).href),
      name: asString(folder.name),
      pathName: asString(folder.pathName),
      template: parsePriceFormulaTemplate(folder.description),
    } : null,
    buyPrice: {
      value: fromMoySkladPrice(buyPrice.value),
      currencyHref: asString(asRecord(buyPriceCurrency.meta).href),
      currencyIsoCode: asString(buyPriceCurrency.isoCode),
      currencyName: asString(buyPriceCurrency.name || buyPriceCurrency.fullName),
    },
    minPrice: {
      value: fromMoySkladPrice(minPrice.value),
      currencyHref: asString(asRecord(minPriceCurrency.meta).href),
      currencyIsoCode: asString(minPriceCurrency.isoCode),
      currencyName: asString(minPriceCurrency.name || minPriceCurrency.fullName),
    },
    prices: salePrices.map((price) => ({
      value: fromMoySkladPrice(price.value),
      priceTypeHref: asString(asRecord(asRecord(price.priceType).meta).href),
      priceTypeName: asString(asRecord(price.priceType).name),
      currencyHref: asString(asRecord(asRecord(price.currency).meta).href),
      currencyIsoCode: asString(asRecord(price.currency).isoCode),
      currencyName: asString(asRecord(price.currency).name),
    })),
  };
}

async function updateAccountingFolderPriceTemplate(input: JsonRecord) {
  const folderHref = asString(input.folderHref);
  const folderId = getIdFromHref(folderHref);
  if (!folderId) throw new Response("Выберите группу товаров.", { status: 400 });
  const token = getMoySkladToken();
  const currentResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/productfolder/${encodeURIComponent(folderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const current = asRecord(await currentResponse.json().catch(() => null));
  if (!currentResponse.ok) throw new Response("Не удалось загрузить группу товаров.", { status: currentResponse.status });
  const description = setMarkedJsonInDescription(current.description, PRICE_FORMULA_TEMPLATE_START, PRICE_FORMULA_TEMPLATE_END, input.template || null);
  const updateResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/productfolder/${encodeURIComponent(folderId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify({ description }),
  });
  const updated = asRecord(await updateResponse.json().catch(() => null));
  if (!updateResponse.ok) throw new Response("Не удалось сохранить шаблон группы.", { status: updateResponse.status });
  return {
    id: asString(updated.id),
    href: asString(asRecord(updated.meta).href),
    name: asString(updated.name),
    pathName: asString(updated.pathName),
    template: parsePriceFormulaTemplate(updated.description),
  };
}

function upsertSalePrice(salePrices: JsonRecord[], priceType: JsonRecord, value: number, currency: JsonRecord) {
  const priceTypeHref = asString(priceType.href);
  const next = {
    value: toMoySkladPrice(value),
    currency,
    priceType: meta(priceTypeHref, "pricetype"),
  };
  for (let index = salePrices.length - 1; index >= 0; index -= 1) {
    if (asString(asRecord(asRecord(salePrices[index].priceType).meta).href) === priceTypeHref) salePrices.splice(index, 1);
  }
  salePrices.push(next);
}

async function updateAccountingFormulaPrices(input: JsonRecord) {
  const changes = Array.isArray(input.changes) ? input.changes.map(asRecord) : [];
  if (!changes.length) throw new Response("Нет цен для сохранения.", { status: 400 });
  if (changes.length > 200) throw new Response("За один раз можно изменить не более 200 товаров.", { status: 400 });
  const priceTypes = await getMoySkladPriceTypes();
  const priceType36 = priceTypes.find((item) => item.href === asString(input.priceType36Href));
  const priceType912 = priceTypes.find((item) => item.href === asString(input.priceType912Href));
  const priceTypeWholesale = priceTypes.find((item) => item.href === asString(input.priceTypeWholesaleHref));
  if (!priceTypeWholesale) throw new Response("Выберите тип цены «Оптовая цена».", { status: 400 });
  const token = getMoySkladToken();
  const results = await Promise.all(changes.map(async (change) => {
    const productId = asString(change.productId);
    try {
      const currentResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/product/${encodeURIComponent(productId)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
      });
      const product = asRecord(await currentResponse.json().catch(() => null));
      if (!currentResponse.ok) throw new Error("Не удалось загрузить товар перед обновлением.");
      const salePrices = Array.isArray(product.salePrices) ? product.salePrices.map(asRecord) : [];
      const salePriceCurrency = asRecord(salePrices.find((price) => asString(asRecord(asRecord(price.currency).meta).href))?.currency);
      const minPriceCurrency = asRecord(asRecord(product.minPrice).currency);
      const buyPriceCurrency = asRecord(asRecord(product.buyPrice).currency);
      const fallbackCurrency = asString(asRecord(salePriceCurrency.meta).href)
        ? salePriceCurrency
        : asString(asRecord(minPriceCurrency.meta).href)
          ? minPriceCurrency
          : buyPriceCurrency;
      if (!asString(asRecord(fallbackCurrency.meta).href)) throw new Error("У товара не найдена валюта цены.");
      const wholesaleCurrency = asString(change.wholesaleCurrencyHref) ? meta(asString(change.wholesaleCurrencyHref), "currency") : fallbackCurrency;
      upsertSalePrice(salePrices, priceTypeWholesale, asNumber(change.wholesalePrice), wholesaleCurrency);
      if (priceType36 && change.price36 !== null && change.price36 !== undefined) upsertSalePrice(salePrices, priceType36, asNumber(change.price36), fallbackCurrency);
      if (priceType912 && change.price912 !== null && change.price912 !== undefined) upsertSalePrice(salePrices, priceType912, asNumber(change.price912), fallbackCurrency);
      const bodyPayload: JsonRecord = { salePrices };
      if (Number.isFinite(Number(change.minPrice))) bodyPayload.minPrice = { value: toMoySkladPrice(asNumber(change.minPrice)), currency: fallbackCurrency };
      const updateResponse = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/product/${encodeURIComponent(productId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify(bodyPayload),
      });
      if (!updateResponse.ok) {
        const payload = await updateResponse.json().catch(() => null);
        throw new Error(getMoySkladError(payload, "Не удалось обновить цену товара."));
      }
      return { productId, ok: true };
    } catch (caught) {
      return { productId, ok: false, error: caught instanceof Error ? caught.message : "Ошибка обновления цены" };
    }
  }));
  return { updated: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}

async function getAccountingSupplyProducts(query: string) {
  const normalized = query.trim();
  if (!normalized) throw new Response("Введите номер или ссылку приемки.", { status: 400 });
  const token = getMoySkladToken();
  const supplyId = normalized.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
  let supply: JsonRecord | null = null;
  if (supplyId) {
    const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/supply/${encodeURIComponent(supplyId)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
    });
    supply = asRecord(await response.json().catch(() => null));
    if (!response.ok) throw new Response("Приемка не найдена.", { status: response.status });
  } else {
    const found = await moysklad("/entity/supply", { limit: "10", search: normalized, order: "moment,desc" });
    supply = asRecord(Array.isArray(found.rows) ? found.rows[0] : null);
  }
  if (!supply?.id) throw new Response("Приемка не найдена.", { status: 404 });
  const positions = await moyskladRows(`/entity/supply/${encodeURIComponent(asString(supply.id))}/positions`, {
    limit: "1000",
    expand: "assortment",
  });
  return {
    id: asString(supply.id),
    name: asString(supply.name),
    products: positions.map((positionValue) => {
      const position = asRecord(positionValue);
      const assortment = asRecord(position.assortment);
      return {
        id: asString(assortment.id) || getIdFromHref(asString(asRecord(assortment.meta).href)),
        href: asString(asRecord(assortment.meta).href),
        type: asString(asRecord(assortment.meta).type),
        name: asString(assortment.name || position.name),
        code: asString(assortment.code),
        article: asString(assortment.article),
        quantity: asNumber(position.quantity),
      };
    }).filter((product) => product.href && product.type === "product"),
  };
}

function normalizePayrollConfig(value: unknown) {
  const row = asRecord(value);
  const scheme = ["salary", "percent", "salary_percent", "category_bonus", "salary_category_bonus"].includes(asString(row.scheme))
    ? asString(row.scheme)
    : "salary_percent";
  return {
    enabled: row.enabled !== false,
    position: asString(row.position, "seller"),
    customPosition: asString(row.customPosition),
    scheme,
    monthlySalary: asNumber(row.monthlySalary),
    percent: asNumber(row.percent),
    percentBase: asString(row.percentBase) === "profit" ? "profit" : "revenue",
  };
}

function parsePayrollConfig(description: unknown) {
  return normalizePayrollConfig(parseMarkedJsonFromDescription(description, PAYROLL_CONFIG_START, PAYROLL_CONFIG_END) || { enabled: false });
}

function setPayrollConfig(description: unknown, payroll: unknown) {
  return setMarkedJsonInDescription(description, PAYROLL_CONFIG_START, PAYROLL_CONFIG_END, normalizePayrollConfig(payroll));
}

async function getMoySkladEmployeesForPayroll() {
  const entityId = String(process.env.MOYSKLAD_EMPLOYEE_CUSTOM_ENTITY_ID || "").trim();
  if (!entityId) return [];
  const rows = await moyskladRows(`/entity/customentity/${entityId}`, { limit: "100" });
  return rows.map((value) => {
    const row = asRecord(value);
    return {
      id: asString(row.id) || getIdFromHref(asString(asRecord(row.meta).href)),
      href: asString(asRecord(row.meta).href),
      name: asString(row.name),
      payroll: parsePayrollConfig(row.description),
    };
  }).filter((employee) => employee.href);
}

async function getCrmUsersForPayroll(data: AppData) {
  if (isSupabaseCrmEnabled()) {
    try {
      const rows = await supabaseGet("/rest/v1/crm_users", {
        select: "id,login,name,position,salary,role,branches,permissions,active,password_hash",
        active: "eq.true",
        order: "name.asc",
      }) as JsonRecord[];
      return rows.map(sanitizeSupabaseUser);
    } catch {
      return data.users.filter((user) => user.active).map(publicUser);
    }
  }
  return data.users.filter((user) => user.active).map(publicUser);
}

function mergePayrollEmployeeMeta(
  employee: { id: string; href: string; name: string; payroll: Record<string, unknown> },
  crmUsers: Array<{ name: string; login: string; position: string; salary: number }>,
) {
  const crmUser = crmUsers.find((user) => normalizeEmployeeKey(user.name) === normalizeEmployeeKey(employee.name) || normalizeEmployeeKey(user.login) === normalizeEmployeeKey(employee.name));
  const payroll = normalizePayrollConfig(employee.payroll);
  return {
    ...employee,
    payroll: {
      ...payroll,
      customPosition: asString(crmUser?.position).trim() || payroll.customPosition,
      monthlySalary: Number.isFinite(Number(crmUser?.salary)) ? Number(crmUser?.salary) : payroll.monthlySalary,
    },
  };
}

function normalizeEmployeeKey(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function payrollMatchesEmployee(row: Record<string, unknown>, employee: { href: string; name: string }) {
  const name = normalizeEmployeeKey(asString(row.employeeName));
  const employeeName = normalizeEmployeeKey(employee.name);
  return Boolean(name && employeeName && (name === employeeName || name.includes(employeeName) || employeeName.includes(name)));
}

function calculateProratedMonthlySalary(monthlySalary: number, dateFrom: string, dateTo: string) {
  const salary = Number(monthlySalary || 0);
  if (salary <= 0) return 0;
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let current = new Date(start);
  let total = 0;
  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    total += salary / daysInMonth;
    current = new Date(Date.UTC(year, month, current.getUTCDate() + 1));
  }
  return roundMoney(total);
}

async function getPayrollEmployeesReport(url: URL, data: AppData) {
  const dateFrom = url.searchParams.get("dateFrom") || new Date().toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("dateTo") || dateFrom;
  const [employees, crmUsers] = await Promise.all([
    getMoySkladEmployeesForPayroll(),
    getCrmUsersForPayroll(data),
  ]);
  const mergedEmployees = employees.map((employee) => mergePayrollEmployeeMeta(employee, crmUsers));
  const rows = mergedEmployees.map((employee) => {
    const payroll = normalizePayrollConfig(employee.payroll);
    const fixedSalary = payroll.enabled && ["salary", "salary_percent", "salary_category_bonus"].includes(payroll.scheme)
      ? calculateProratedMonthlySalary(payroll.monthlySalary, dateFrom, dateTo)
      : 0;
    return {
      id: employee.id,
      href: employee.href,
      name: employee.name,
      payroll,
      documents: 0,
      revenue: 0,
      profit: 0,
      categoryBonus: 0,
      sales: [],
      fixedSalary,
      commission: 0,
      totalSalary: roundMoney(fixedSalary),
      loadingSales: true,
    };
  });
  const totals = rows.reduce((sum, row) => ({
    employees: sum.employees + (row.payroll.enabled ? 1 : 0),
    documents: 0,
    revenue: 0,
    profit: 0,
    fixedSalary: roundMoney(sum.fixedSalary + row.fixedSalary),
    commission: 0,
    totalSalary: roundMoney(sum.totalSalary + row.totalSalary),
    unassignedDocuments: 0,
    unassignedRevenue: 0,
  }), { employees: 0, documents: 0, revenue: 0, profit: 0, fixedSalary: 0, commission: 0, totalSalary: 0, unassignedDocuments: 0, unassignedRevenue: 0 });
  return { dateFrom, dateTo, partial: true, rows, totals };
}

async function getPayrollReport(url: URL, data?: AppData) {
  const dateFrom = url.searchParams.get("dateFrom") || new Date().toISOString().slice(0, 10);
  const dateTo = url.searchParams.get("dateTo") || dateFrom;
  const fallbackData = data ?? seedData();
  const [employees, report, crmUsers] = await Promise.all([
    getMoySkladEmployeesForPayroll(),
    getMoySkladSalesReport(url),
    getCrmUsersForPayroll(fallbackData),
  ]);
  const rows = employees.map((employee) => {
    const mergedEmployee = mergePayrollEmployeeMeta(employee, crmUsers);
    const payroll = normalizePayrollConfig(mergedEmployee.payroll);
    const sales = report.rows.filter((row) => payrollMatchesEmployee(row, mergedEmployee));
    const revenue = roundMoney(sales.reduce((sum, sale) => sum + asNumber(sale.amount), 0));
    const profit = roundMoney(sales.reduce((sum, sale) => sum + asNumber(sale.netProfit), 0));
    const fixedSalary = payroll.enabled && ["salary", "salary_percent", "salary_category_bonus"].includes(payroll.scheme)
      ? calculateProratedMonthlySalary(payroll.monthlySalary, dateFrom, dateTo)
      : 0;
    const percentSource = payroll.percentBase === "profit" ? Math.max(0, profit) : Math.max(0, revenue);
    const commission = payroll.enabled && ["percent", "salary_percent"].includes(payroll.scheme)
      ? roundMoney(percentSource * payroll.percent / 100)
      : 0;
    return {
      id: mergedEmployee.id,
      href: mergedEmployee.href,
      name: mergedEmployee.name,
      payroll,
      documents: sales.length,
      revenue,
      profit,
      categoryBonus: 0,
      sales: sales.map((sale) => ({
        id: sale.id,
        name: sale.name,
        typeLabel: sale.typeLabel,
        moment: sale.moment,
        amount: sale.amount,
        netProfit: sale.netProfit,
        webUrl: sale.webUrl,
        customerName: sale.customerName,
        products: sale.products,
      })),
      fixedSalary,
      commission,
      totalSalary: roundMoney(fixedSalary + commission),
      loadingSales: false,
    };
  });
  const totals = rows.reduce((sum, row) => ({
    employees: sum.employees + (row.payroll.enabled ? 1 : 0),
    documents: sum.documents + row.documents,
    revenue: roundMoney(sum.revenue + row.revenue),
    profit: roundMoney(sum.profit + row.profit),
    fixedSalary: roundMoney(sum.fixedSalary + row.fixedSalary),
    commission: roundMoney(sum.commission + row.commission),
    totalSalary: roundMoney(sum.totalSalary + row.totalSalary),
    unassignedDocuments: sum.unassignedDocuments,
    unassignedRevenue: sum.unassignedRevenue,
  }), { employees: 0, documents: 0, revenue: 0, profit: 0, fixedSalary: 0, commission: 0, totalSalary: 0, unassignedDocuments: 0, unassignedRevenue: 0 });
  return { dateFrom, dateTo, rows, totals };
}

async function savePayrollConfigs(input: JsonRecord) {
  const entries = Array.isArray(input.employees) ? input.employees.map(asRecord) : [input];
  if (!entries.length) throw new Response("Нет сотрудников для сохранения.", { status: 400 });
  const token = getMoySkladToken();
  const results = await Promise.all(entries.map(async (entry) => {
    const href = asString(entry.employeeHref);
    if (!href) return { ok: false, error: "Не выбран сотрудник." };
    try {
      const currentResponse = await moyskladFetch(href, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
      });
      const current = asRecord(await currentResponse.json().catch(() => null));
      if (!currentResponse.ok) throw new Error("Не удалось загрузить сотрудника.");
      const description = setPayrollConfig(current.description, entry.payroll);
      const updateResponse = await moyskladFetch(href, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8", "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify({ description }),
      });
      const updated = asRecord(await updateResponse.json().catch(() => null));
      if (!updateResponse.ok) throw new Error("Не удалось сохранить настройки зарплаты.");
      return {
        ok: true,
        employee: {
          id: asString(updated.id),
          href: asString(asRecord(updated.meta).href),
          name: asString(updated.name),
          payroll: parsePayrollConfig(updated.description),
        },
      };
    } catch (caught) {
      return { ok: false, error: caught instanceof Error ? caught.message : "Ошибка сохранения зарплаты." };
    }
  }));
  return { employees: results.map((item) => asRecord(item).employee).filter(Boolean), results };
}

async function getAccountingPriceCatalog(url: URL) {
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
  const [productPage, priceTypes, folders] = await Promise.all([
    moysklad("/entity/product", { limit: String(limit), offset: String(offset), order: "name,asc", expand: "productFolder" }),
    url.searchParams.get("includePriceTypes") === "false" ? Promise.resolve([]) : getMoySkladPriceTypes(),
    url.searchParams.get("includePriceTypes") === "false" ? Promise.resolve([]) : getMoySkladProductFolders(),
  ]);
  const rows = Array.isArray(productPage.rows) ? productPage.rows : [];
  const total = asNumber(asRecord(productPage.meta).size, offset + rows.length);
  return {
    priceTypes,
    folders,
    products: rows.map(mapAccountingProduct),
    total,
    offset,
    limit,
    nextOffset: offset + rows.length,
    hasMore: offset + rows.length < total,
  };
}

function minutesBetween(start: string, end: string) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, Math.round(diff / 60000));
}

function currentAttendanceRecord(record: AttendanceRecord) {
  if (record.status === "open") {
    return { ...record, currentWorkMinutes: minutesBetween(record.checkInTime, new Date().toISOString()) };
  }
  return record;
}

function attendanceStoreScheduleKey(store?: AttendanceStore | null) {
  if (!store) return "";
  return slugifyAttendanceBranch(store.id || store.branch || store.name);
}

function getAttendanceStoreSchedule(schedule: AttendanceSchedule, store?: AttendanceStore | null) {
  const key = attendanceStoreScheduleKey(store);
  const branchSchedule = schedule.branches.find((item) => slugifyAttendanceBranch(item.key) === key || slugifyAttendanceBranch(item.label) === key);
  return branchSchedule || {
    key: key || "default",
    label: store?.name || "По умолчанию",
    workStartsAt: schedule.workStartsAt,
    workEndsAt: schedule.workEndsAt,
  };
}

function combineAttendanceDateTime(source: string, clock: string) {
  const date = new Date(source);
  const [hours, minutes] = String(clock || "00:00").split(":").map((value) => Number(value) || 0);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function getAttendanceLateMinutes(record: AttendanceRecord, schedule: AttendanceSchedule, store?: AttendanceStore | null) {
  const startAt = combineAttendanceDateTime(record.checkInTime, getAttendanceStoreSchedule(schedule, store).workStartsAt);
  const checkIn = new Date(record.checkInTime);
  return Math.max(0, Math.round((checkIn.getTime() - startAt.getTime()) / 60000));
}

function autoCloseAttendanceRecords(data: AppData) {
  const now = new Date();
  let changed = false;
  for (const record of data.attendanceRecords) {
    if (record.status !== "open") continue;
    const store = data.attendanceStores.find((item) => item.id === record.storeId) || null;
    const endAt = combineAttendanceDateTime(record.checkInTime, getAttendanceStoreSchedule(data.attendanceSchedule, store).workEndsAt);
    if (now.getTime() < endAt.getTime()) continue;
    record.status = "closed";
    record.checkOutTime = endAt.toISOString();
    record.totalWorkMinutes = minutesBetween(record.checkInTime, record.checkOutTime);
    record.currentWorkMinutes = record.totalWorkMinutes;
    record.checkOutDistanceMeters = 0;
    changed = true;
  }
  return changed;
}

function getDefaultAttendanceBranches(schedule: AttendanceSchedule): AttendanceStore[] {
  const fallbackBranches = schedule.branches.length
    ? schedule.branches
    : [
        { key: "ayu-grand", label: "Аю-Гранд", workStartsAt: "09:00", workEndsAt: "18:00" },
        { key: "besh-sary", label: "Беш-Сары", workStartsAt: "09:00", workEndsAt: "19:00" },
      ];

  return fallbackBranches.map((branch) => ({
    id: branch.key,
    name: branch.label,
    branch: branch.label,
    address: branch.label,
    latitude: 0,
    longitude: 0,
    allowedRadiusMeters: 0,
  }));
}

function getAttendanceBranches(data: AppData) {
  return data.attendanceStores.length ? data.attendanceStores : getDefaultAttendanceBranches(data.attendanceSchedule);
}

function resolveAttendanceBranch(data: AppData, storeId: string) {
  const branches = getAttendanceBranches(data);
  return branches.find((item) => item.id === storeId || item.name === storeId || slugifyAttendanceBranch(item.name) === slugifyAttendanceBranch(storeId))
    || branches[0]
    || null;
}

function getLoyaltyConfig() {
  const configured = String(process.env.LOYALTY_ENABLED || "").toLowerCase();
  const enabled = configured ? ["1", "true", "yes", "on"].includes(configured) : Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const accrualPercent = Number(process.env.LOYALTY_ACCRUAL_PERCENT || process.env.LOYALTY_DEFAULT_PERCENT || 3);
  const maxRedeemPercent = Number(process.env.LOYALTY_MAX_REDEEM_PERCENT || 30);
  return {
    enabled: enabled && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    accrualPercent: Number.isFinite(accrualPercent) ? accrualPercent : 3,
    maxRedeemPercent: Number.isFinite(maxRedeemPercent) ? maxRedeemPercent : 30,
  };
}

function rpcLoyaltyCustomer(row: JsonRecord) {
  return {
    id: row.customer_id,
    phone: row.phone,
    name: row.name,
    bonus_balance: row.bonus_balance,
  };
}

async function applyLoyalty(calculation: JsonRecord, input: JsonRecord, document: JsonRecord) {
  const config = getLoyaltyConfig();
  if (!config.enabled || input.customerMode === "retail") return null;
  const phone = normalizePhone(input.customerPhone);
  if (!phone) return null;
  const saleId = [document.type, document.id].filter(Boolean).join(":");
  const result: JsonRecord = { enabled: true, redeemed: 0, accrued: 0, balance: null, customer: null };
  const redemption = asNumber(calculation.loyaltyRedemption);
  if (redemption > 0) {
    const rows = await supabaseRpc("loyalty_redeem", {
      p_phone: phone,
      p_sale_id: saleId,
      p_amount: Math.round(redemption),
      p_comment: `Списание по документу ${asString(document.name) || saleId}`,
    });
    const row = asRecord(rows[0]);
    result.redeemed = row.transaction_amount || Math.round(redemption);
    result.balance = row.bonus_balance ?? result.balance;
    result.customer = Object.keys(row).length ? rpcLoyaltyCustomer(row) : result.customer;
  } else {
    const accrueBase = Math.round(asNumber(calculation.finalTotal));
    if (accrueBase > 0 && config.accrualPercent > 0) {
      const rows = await supabaseRpc("loyalty_accrue", {
        p_phone: phone,
        p_name: asString(input.customerName).trim(),
        p_sale_id: saleId,
        p_sale_amount: accrueBase,
        p_percent: config.accrualPercent,
        p_comment: `Начисление по документу ${asString(document.name) || saleId}`,
      });
      const row = asRecord(rows[0]);
      result.accrued = row.transaction_amount || 0;
      result.balance = row.bonus_balance ?? result.balance;
      result.customer = Object.keys(row).length ? rpcLoyaltyCustomer(row) : result.customer;
    }
  }
  return result;
}

async function applyLoyaltySafely(calculation: JsonRecord, input: JsonRecord, document: JsonRecord) {
  try {
    return await applyLoyalty(calculation, input, document);
  } catch (caught) {
    return { enabled: getLoyaltyConfig().enabled, error: caught instanceof Error ? caught.message : "Не удалось выполнить бонусную операцию." };
  }
}

function validateTelegramReceiptInput(receiptPhoto: JsonRecord) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_RECEIPT_CHAT_ID) throw new Response("Заполните TELEGRAM_BOT_TOKEN и TELEGRAM_RECEIPT_CHAT_ID.", { status: 500 });
  const data = asString(receiptPhoto.data);
  const mimeType = asString(receiptPhoto.mimeType);
  if (!data || !/^image\/(jpeg|png|webp)$/i.test(mimeType)) throw new Response("Добавьте корректную фотографию чека.", { status: 400 });
  if (data.length > 7 * 1024 * 1024) throw new Response("Обработанное фото чека слишком большое.", { status: 413 });
}

function buildTelegramReceiptCaption(calculation: JsonRecord, input: JsonRecord, document: JsonRecord) {
  const items = Array.isArray(calculation.items) ? calculation.items.map(asRecord) : [];
  const products = items.map((item) => `• ${asString(item.productName ?? item.name, "Товар")} x ${asNumber(item.quantity, 1)}${item.isGift ? " — ПОДАРОК" : ""}`).join("\n");
  return [
    `Чек: ${asString(document.type) === "retaildemand" ? "Продажа" : "Отгрузка"} №${asString(document.name)}`,
    `Сумма: ${asNumber(calculation.finalTotal)} сом`,
    `Филиал: ${asString(input.branchName ?? input.retailStoreName, "-")}`,
    `Сотрудник: ${asString(input.employeeName, "-")}`,
    `Клиент: ${asString(input.customerName, "Розничный покупатель")}`,
    `Телефон: ${asString(input.customerPhone, "-")}`,
    `Оплата: ${asString(calculation.paymentLabel ?? input.paymentTypeName, "-")}`,
    "",
    products,
  ].join("\n").slice(0, 1024);
}

async function sendTelegramPhoto(token: string, chatId: string, buffer: Buffer, receiptPhoto: JsonRecord, caption: string) {
  const form = new FormData();
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  form.set("chat_id", chatId);
  form.set("photo", new Blob([arrayBuffer], { type: asString(receiptPhoto.mimeType, "image/jpeg") }), asString(receiptPhoto.name, "receipt.jpg"));
  form.set("caption", caption);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  const payload = await response.json().catch(() => null) as unknown;
  return { response, payload: asRecord(payload) };
}

async function sendTelegramReceiptSafely(receiptPhoto: JsonRecord, calculation: JsonRecord, input: JsonRecord, document: JsonRecord) {
  try {
    validateTelegramReceiptInput(receiptPhoto);
    const token = String(process.env.TELEGRAM_BOT_TOKEN || "");
    const chatId = String(process.env.TELEGRAM_RECEIPT_CHAT_ID || "");
    const buffer = Buffer.from(asString(receiptPhoto.data), "base64");
    const caption = buildTelegramReceiptCaption(calculation, input, document);
    const { response, payload } = await sendTelegramPhoto(token, chatId, buffer, receiptPhoto, caption);
    if (!response.ok || payload.ok !== true) throw new Error(asString(payload.description, `Telegram вернул ${response.status}`));
    return { sent: true, messageId: asRecord(payload.result).message_id || null };
  } catch (caught) {
    return { sent: false, error: caught instanceof Error ? caught.message : "Не удалось отправить фото в Telegram." };
  }
}

function textFile(content: string, contentType: string, filename: string) {
  return new NextResponse(content, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

function requireBotApiKey(request: NextRequest) {
  const configured = String(process.env.BOT_API_KEY || "").trim();
  if (!configured) return;
  const headerKey = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (headerKey !== configured) throw new Response("Неверный BOT_API_KEY", { status: 401 });
}

function getMoySkladMonitorStats() {
  return {
    tokenConfigured: Boolean(process.env.MOYSKLAD_TOKEN),
    documentType: process.env.MOYSKLAD_DOCUMENT_TYPE || "auto",
    organizationConfigured: Boolean(process.env.MOYSKLAD_ORGANIZATION_HREF),
    agentConfigured: Boolean(process.env.MOYSKLAD_AGENT_HREF),
    storeConfigured: Boolean(process.env.MOYSKLAD_STORE_HREF),
    retailStoreConfigured: Boolean(process.env.MOYSKLAD_RETAIL_STORE_HREF),
  };
}

async function getRetailShiftsForApi(url: URL) {
  const retailStoreHref = url.searchParams.get("retailStoreHref") || "";
  if (!retailStoreHref) return { retailShifts: [] };
  const token = getMoySkladToken();
  const rows = await moyskladRows("/entity/retailshift", {
    limit: "20",
    filter: `retailStore=${retailStoreHref}`,
    order: "moment,desc",
  });
  return {
    retailShifts: rows.map((value) => {
      const row = asRecord(value);
      return {
        id: asString(row.id),
        name: asString(row.name),
        href: asString(asRecord(row.meta).href),
        moment: normalizeApiMoment(row.moment),
        closeDate: asString(row.closeDate),
        closeMoment: normalizeApiMoment(row.closeMoment),
        closed: row.closed === true,
        tokenConfigured: Boolean(token),
      };
    }),
  };
}

async function getRetailFiscalStatusLite(url: URL) {
  const documentId = url.searchParams.get("documentId") || "";
  if (!documentId) return error(400, "Укажите documentId.");
  const token = getMoySkladToken();
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/retaildemand/${encodeURIComponent(documentId)}?expand=retailStore,retailShift,store,agent`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const row = asRecord(await response.json().catch(() => null));
  if (!response.ok) throw new Response("Не удалось проверить фискальный статус документа.", { status: response.status });
  const checks = {
    retailDemand: asString(asRecord(row.meta).type) === "retaildemand",
    retailStore: Boolean(asString(asRecord(asRecord(row.retailStore).meta).href)),
    retailShift: Boolean(asString(asRecord(asRecord(row.retailShift).meta).href)),
    store: Boolean(asString(asRecord(asRecord(row.store).meta).href)),
    amount: asNumber(row.sum) > 0,
    paymentSplit: asNumber(row.cashSum) > 0 || asNumber(row.noCashSum) > 0,
  };
  return json({
    ready: Object.values(checks).every(Boolean),
    checks,
    document: {
      id: asString(row.id),
      name: asString(row.name),
      sum: asNumber(row.sum) / 100,
      cashSum: asNumber(row.cashSum) / 100,
      noCashSum: asNumber(row.noCashSum) / 100,
      retailStoreName: asString(asRecord(row.retailStore).name),
      retailShiftName: asString(asRecord(row.retailShift).name),
      storeName: asString(asRecord(row.store).name),
      customerName: asString(asRecord(row.agent).name),
      webUrl: `https://online.moysklad.ru/app/#retaildemand/edit?id=${encodeURIComponent(asString(row.id))}`,
    },
  });
}

async function getRetailDemandById(documentId: string) {
  const token = getMoySkladToken();
  const response = await moyskladFetch(`${MOYSKLAD_BASE_URL}/entity/retaildemand/${encodeURIComponent(documentId)}?expand=retailStore,retailShift,store,agent`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json;charset=utf-8" },
  });
  const row = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    throw new Response(getMoySkladError(row, "Не удалось загрузить розничную продажу для фискализации."), { status: response.status });
  }
  return {
    type: "retaildemand",
    id: asString(row.id) || documentId,
    name: asString(row.name),
    sum: fromMoySkladPrice(row.sum),
    cashSum: fromMoySkladPrice(row.cashSum),
    noCashSum: fromMoySkladPrice(row.noCashSum),
    retailStoreHref: asString(asRecord(asRecord(row.retailStore).meta).href),
    retailShiftHref: asString(asRecord(asRecord(row.retailShift).meta).href),
    storeHref: asString(asRecord(asRecord(row.store).meta).href),
    retailStoreName: asString(asRecord(row.retailStore).name),
    retailShiftName: asString(asRecord(row.retailShift).name),
    storeName: asString(asRecord(row.store).name),
    customerName: asString(asRecord(row.agent).name),
    moment: normalizeApiMoment(row.moment),
    webUrl: `https://online.moysklad.ru/app/#retaildemand/edit?id=${encodeURIComponent(asString(row.id) || documentId)}`,
  };
}

async function triggerRetailFiscalizationSafely(document: JsonRecord) {
  try {
    return await triggerRetailFiscalization(document);
  } catch (caught) {
    return {
      attempted: true,
      success: false,
      error: caught instanceof Error ? caught.message : "Не удалось отправить документ на фискализацию.",
    };
  }
}

async function triggerRetailFiscalization(document: JsonRecord) {
  const mode = String(process.env.MOYSKLAD_FISCALIZE_MODE || "").trim().toLowerCase();
  if (mode === "web-rpc") {
    return triggerRetailFiscalizationViaWebRpc(document);
  }

  const endpointTemplate = String(process.env.MOYSKLAD_FISCALIZE_ENDPOINT_TEMPLATE || "").trim();
  if (!endpointTemplate) {
    return {
      attempted: false,
      skipped: true,
      reason: "Не настроен MOYSKLAD_FISCALIZE_ENDPOINT_TEMPLATE",
    };
  }

  const token = getMoySkladToken();
  const documentId = asString(document.id).trim();
  if (!documentId) {
    return {
      attempted: false,
      skipped: true,
      reason: "Нет document.id для фискализации",
    };
  }

  const endpoint = endpointTemplate
    .replaceAll("{documentId}", encodeURIComponent(documentId))
    .replaceAll("{retailStoreHref}", encodeURIComponent(asString(document.retailStoreHref)))
    .replaceAll("{storeHref}", encodeURIComponent(asString(document.storeHref)))
    .replaceAll("{retailShiftHref}", encodeURIComponent(asString(document.retailShiftHref)));
  const method = String(process.env.MOYSKLAD_FISCALIZE_METHOD || "POST").trim().toUpperCase();
  const bodyTemplate = String(process.env.MOYSKLAD_FISCALIZE_BODY || "").trim();
  const requestBody = bodyTemplate
    ? bodyTemplate
        .replaceAll("{documentId}", documentId)
        .replaceAll("{retailStoreHref}", asString(document.retailStoreHref))
        .replaceAll("{storeHref}", asString(document.storeHref))
        .replaceAll("{retailShiftHref}", asString(document.retailShiftHref))
    : "";

  const response = await moyskladFetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;charset=utf-8",
      ...(requestBody ? { "Content-Type": "application/json;charset=utf-8" } : {}),
    },
    ...(requestBody ? { body: requestBody } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Response(getMoySkladError(payload, "МойСклад не принял запрос на автофискализацию."), { status: response.status });
  }

  return {
    attempted: true,
    success: true,
    endpoint,
    method,
    response: payload,
  };
}

async function triggerRetailFiscalizationViaWebRpc(document: JsonRecord) {
  const documentId = asString(document.id).trim();
  if (!documentId) {
    return {
      attempted: false,
      skipped: true,
      reason: "Нет document.id для фискализации",
    };
  }

  const serviceUrl = String(process.env.MOYSKLAD_WEB_FISCAL_SERVICE_URL || "https://online.moysklad.ru/app/services/r1687/FiscalQueueService").trim();
  const moduleBase = String(process.env.MOYSKLAD_WEB_FISCAL_GWT_BASE || "https://cdn-static.moysklad.ru/app/cdn/r1687/").trim();
  const strongName = String(process.env.MOYSKLAD_WEB_FISCAL_GWT_STRONG_NAME || "").trim();
  const cookie = String(process.env.MOYSKLAD_WEB_COOKIE || "").trim();

  if (!strongName || !cookie) {
    return {
      attempted: false,
      skipped: true,
      reason: "Заполните MOYSKLAD_WEB_COOKIE и MOYSKLAD_WEB_FISCAL_GWT_STRONG_NAME",
    };
  }

  const rpcBody = [
    "7", "0", "6",
    moduleBase,
    strongName,
    "com.lognex.sklad.face.common.client.module.fiscal.FiscalQueueService",
    "add",
    "java.util.UUID/2940008275",
    documentId,
    "1", "2", "3", "4", "1", "5", "5", "6",
  ].join("|") + "|";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
        "X-GWT-Module-Base": moduleBase,
        "X-GWT-Permutation": strongName,
        Origin: "https://online.moysklad.ru",
        Referer: `https://online.moysklad.ru/app/#retaildemand/edit?id=${encodeURIComponent(documentId)}`,
        Cookie: cookie,
      },
      body: rpcBody,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Response("Web-RPC МойСклад не принял запрос на фискализацию.", {
        status: response.status,
        statusText: text.slice(0, 2000),
      });
    }
    if (!String(text).startsWith("//OK")) {
      throw new Response("МойСклад вернул ошибку web-RPC при фискализации.", {
        status: 502,
        statusText: text.slice(0, 2000),
      });
    }
    return {
      attempted: true,
      success: true,
      mode: "web-rpc",
      serviceUrl,
      responseText: text.slice(0, 2000),
    };
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") {
      throw new Response("Web-RPC МойСклад слишком долго отвечает.", { status: 504 });
    }
    throw caught;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleDeliveries(request: NextRequest, parts: string[], data: AppData) {
  const user = requireUser(request, data);
  const id = parts[1] || "";
  if (!id && request.method === "GET") {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "";
    const dateFrom = url.searchParams.get("dateFrom") || "";
    const dateTo = url.searchParams.get("dateTo") || "";
    const debug = url.searchParams.get("__debug") === "1";
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseGet("/rest/v1/business_deliveries", {
        select: "id,document_id,document_type,document_name,document_url,branch_name,customer_name,customer_phone,delivery_address,scheduled_at,employee_name,items,status,notes,created_by,created_at,updated_at",
        order: "scheduled_at.desc,created_at.desc",
        limit: "500",
      }).catch(async (caught) => {
        if (debug) {
          if (caught instanceof Response) {
            return [{ __debugError: await caught.text(), __debugStatus: caught.status }];
          }
          return [{ __debugError: caught instanceof Error ? caught.message : String(caught) }];
        }
        throw caught;
      }) as JsonRecord[] | null;
      if (rows) {
        const debugError = asString(asRecord(rows[0]).__debugError);
        if (debug && debugError) {
          return json({
            deliveries: [],
            debug: {
              supabaseConfigured: true,
              error: debugError,
              filters: { status, dateFrom, dateTo },
            },
          });
        }
        const normalized = rows.map(normalizeDeliveryRow);
        const deliveries = normalized.filter((delivery) => {
          if (status && delivery.status !== status) return false;
          const scheduledAt = delivery.scheduledAt || delivery.createdAt || "";
          if (!scheduledAt) return true;
          const scheduledDate = toLocalDateInput(new Date(scheduledAt));
          if (dateFrom && scheduledDate < dateFrom) return false;
          if (dateTo && scheduledDate > dateTo) return false;
          return true;
        });
        if (debug) {
          return json({
            deliveries,
            debug: {
              supabaseConfigured: true,
              totalRows: rows.length,
              normalizedRows: normalized.slice(0, 5),
              filters: { status, dateFrom, dateTo },
            },
          });
        }
        return json({ deliveries });
      }
    }
    const filtered = data.deliveries.filter((delivery) => {
      if (status && delivery.status !== status) return false;
      const scheduledAt = delivery.scheduledAt || delivery.createdAt || "";
      if (!scheduledAt) return true;
      const scheduledDate = toLocalDateInput(new Date(scheduledAt));
      if (dateFrom && scheduledDate < dateFrom) return false;
      if (dateTo && scheduledDate > dateTo) return false;
      return true;
    });
    return json({ deliveries: filtered });
  }
  if (!id && request.method === "POST") {
    const payload = await body(request);
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch("/rest/v1/business_deliveries?select=id,document_id,document_type,document_name,document_url,branch_name,customer_name,customer_phone,delivery_address,scheduled_at,employee_name,items,status,notes,created_by,created_at,updated_at", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(deliveryPayload(payload, user)),
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.[0]) return json({ delivery: normalizeDeliveryRow(rows[0]) }, 201);
    }
    const delivery: Delivery = {
      id: randomUUID(),
      documentId: asString(payload.documentId),
      documentType: asString(payload.documentType),
      documentName: asString(payload.documentName),
      documentUrl: asString(payload.documentUrl),
      scheduledAt: normalizeApiMoment(payload.scheduledAt),
      createdAt: new Date().toISOString(),
      customerName: asString(payload.customerName),
      customerPhone: asString(payload.customerPhone),
      deliveryAddress: asString(payload.address ?? payload.deliveryAddress),
      branchName: asString(payload.branchName),
      employeeName: asString(payload.employeeName),
      items: Array.isArray(payload.items) ? payload.items.map((item) => ({ name: asString(asRecord(item).name), quantity: asNumber(asRecord(item).quantity, 1) })) : [],
      status: asString(payload.status, "new"),
      amount: asNumber(payload.amount),
      notes: asString(payload.comment ?? payload.notes),
    };
    data.deliveries.unshift(delivery);
    await writeData(data);
    return json({ delivery }, 201);
  }
  const index = data.deliveries.findIndex((item) => item.id === id);
  if (request.method === "PATCH" || request.method === "PUT") {
    const payload = await body(request);
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch(`/rest/v1/business_deliveries?id=eq.${encodeURIComponent(id)}&select=id,document_id,document_type,document_name,document_url,branch_name,customer_name,customer_phone,delivery_address,scheduled_at,employee_name,items,status,notes,created_by,created_at,updated_at`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(deliveryUpdatePayload(payload)),
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.[0]) return json({ delivery: normalizeDeliveryRow(rows[0]) });
    }
    if (index < 0) return error(404, "Доставка не найдена");
    data.deliveries[index] = { ...data.deliveries[index], ...payload };
    await writeData(data);
    return json({ delivery: data.deliveries[index] });
  }
  if (request.method === "DELETE") {
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch(`/rest/v1/business_deliveries?id=eq.${encodeURIComponent(id)}&select=id`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.length) return json({ ok: true });
    }
    if (index < 0) return error(404, "Доставка не найдена");
    data.deliveries.splice(index, 1);
    await writeData(data);
    return json({ ok: true });
  }
  return error(405, "Метод не поддерживается");
}

function buildSalesExport(data: AppData) {
  const rows = data.orders.map((order) => [
    order.moment,
    order.type,
    order.name,
    order.customerName,
    order.customerPhone,
    order.amount,
    order.paid,
    order.unpaid,
    order.netProfit,
    order.products.map((item) => `${item.name} x ${item.quantity}`).join("; "),
  ]);
  return [["Дата", "Тип", "Документ", "Клиент", "Телефон", "Сумма", "Оплачено", "Долг", "Прибыль", "Товары"], ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatInvoiceNumber(value: unknown) {
  const text = asString(value).trim();
  if (text) return text;
  return String(new Date().getTime()).slice(-4);
}

function formatInvoiceDate(value: unknown) {
  const text = asString(value).trim();
  if (text) return text;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function numberToRussianSomText(value: number) {
  const unitsMale = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const unitsFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const groups = [
    { one: "сом", two: "сома", five: "сом", female: false },
    { one: "тысяча", two: "тысячи", five: "тысяч", female: true },
    { one: "миллион", two: "миллиона", five: "миллионов", female: false },
    { one: "миллиард", two: "миллиарда", five: "миллиардов", female: false },
  ];

  const morph = (num: number, one: string, two: string, five: string) => {
    const n = Math.abs(num) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return five;
    if (n1 > 1 && n1 < 5) return two;
    if (n1 === 1) return one;
    return five;
  };

  const tripletToWords = (num: number, female: boolean) => {
    if (!num) return "";
    const unitWords = female ? unitsFemale : unitsMale;
    const parts: string[] = [];
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const u = num % 10;
    if (h) parts.push(hundreds[h]);
    if (t === 1) {
      parts.push(teens[u]);
    } else {
      if (t > 1) parts.push(tens[t]);
      if (u > 0) parts.push(unitWords[u]);
    }
    return parts.join(" ");
  };

  const amount = Math.max(0, Math.round(Number(value || 0) * 100) / 100);
  const whole = Math.floor(amount);
  const tyiyn = Math.round((amount - whole) * 100);

  if (!whole) {
    return `Ноль сом ${String(tyiyn).padStart(2, "0")} тыйын`;
  }

  const chunks: string[] = [];
  let current = whole;
  let groupIndex = 0;
  while (current > 0 && groupIndex < groups.length) {
    const triplet = current % 1000;
    if (triplet) {
      const group = groups[groupIndex];
      const words = tripletToWords(triplet, group.female);
      chunks.unshift([words, morph(triplet, group.one, group.two, group.five)].filter(Boolean).join(" "));
    }
    current = Math.floor(current / 1000);
    groupIndex += 1;
  }

  const result = `${chunks.join(" ")} ${String(tyiyn).padStart(2, "0")} тыйын`.trim();
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function buildCommercialInvoice(payload: JsonRecord) {
  const items = Array.isArray(payload.items) ? payload.items.map(asRecord) : [];
  const total = roundMoney(items.reduce((sum, item) => sum + asNumber(item.quantity, 1) * asNumber(item.price ?? item.productPrice), 0));
  const invoiceNumber = formatInvoiceNumber(payload.invoiceNumber ?? payload.documentNumber);
  const invoiceDate = formatInvoiceDate(payload.invoiceDate ?? payload.date);
  const sellerLine = asString(
    payload.sellerLine
      || payload.organizationDetails
      || process.env.INVOICE_SELLER_LINE
      || "ИП Матаев Женишбек Камилович, ИНН 20305197500183, г.Бишкек, Ленинский район, ж/м, ул.20-я, дом №14, р/c 1280156055213894, Банк: ЗАО «Кыргызский Инвестиционно-Кредитный Банк», БИК 128015",
  );
  const directorName = asString(payload.directorName || process.env.INVOICE_DIRECTOR_NAME || "Матаев Ж.К");
  const customerName = asString(payload.customerName, "Контрагент");
  const customerInn = asString(payload.customerInn);
  const customerOkpo = asString(payload.customerOkpo);
  const customerBik = asString(payload.customerBik);
  const customerBank = asString(payload.customerBank);
  const customerSettlementAccount = asString(payload.customerSettlementAccount);
  const customerAddress = asString(payload.customerAddress);
  const customerPhone = asString(payload.customerPhone);
  const customerEmail = asString(payload.customerEmail);
  const rows = items.map((item, index) => {
    const name = asString(item.name ?? item.productName);
    const quantity = asNumber(item.quantity, 1);
    const price = asNumber(item.price ?? item.productPrice);
    const sum = roundMoney(quantity * price);
    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td class="center">шт</td>
        <td class="center">${escapeHtml(String(quantity))}</td>
        <td class="right">${escapeHtml(formatMoney(price))}</td>
        <td class="right">${escapeHtml(formatMoney(sum))}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Счет на оплату</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 28px; font-size: 14px; }
    .title { text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 20px; }
    .block { margin-bottom: 12px; line-height: 1.45; }
    .label { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border: 1px solid #222; padding: 8px 10px; vertical-align: top; }
    th { text-align: center; font-weight: 700; }
    .center { text-align: center; }
    .right { text-align: right; }
    .totals { width: 280px; margin-left: auto; margin-top: 14px; }
    .totals td { border: none; padding: 3px 0; }
    .summary { margin-top: 12px; line-height: 1.5; }
    .signature { margin-top: 34px; }
    .signature-line { display: inline-block; min-width: 220px; border-bottom: 1px solid #222; height: 18px; vertical-align: middle; }
    .muted { color: #555; font-size: 12px; }
  </style>
</head>
<body>
  <div class="title">Счет на оплату №${escapeHtml(invoiceNumber)} от ${escapeHtml(invoiceDate)} г.</div>

  <div class="block"><span class="label">Организация:</span> ${escapeHtml(sellerLine)}</div>

  <div class="block">
    <span class="label">Покупатель:</span><br>
    ${escapeHtml(customerName)}
    ${customerInn ? `<br>ИНН ${escapeHtml(customerInn)}` : ""}
    ${customerOkpo ? `<br>ОКПО ${escapeHtml(customerOkpo)}` : ""}
    ${customerBik ? `<br>БИК ${escapeHtml(customerBik)}${customerBank ? ` ${escapeHtml(customerBank)}` : ""}` : customerBank ? `<br>${escapeHtml(customerBank)}` : ""}
    ${customerSettlementAccount ? `<br>p/c ${escapeHtml(customerSettlementAccount)}` : ""}
    ${customerAddress ? `<br>Адрес: ${escapeHtml(customerAddress)}` : ""}
    ${(customerPhone || customerEmail) ? `<br>${escapeHtml([customerPhone, customerEmail].filter(Boolean).join(". "))}` : ""}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 6%">№</th>
        <th>Наименование</th>
        <th style="width: 10%">Ед.</th>
        <th style="width: 12%">Количество</th>
        <th style="width: 16%">Цена</th>
        <th style="width: 18%">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <table class="totals">
    <tr><td class="label">Всего:</td><td class="right">${escapeHtml(formatMoney(total))}</td></tr>
    <tr><td class="label">К оплате:</td><td class="right">${escapeHtml(formatMoney(total))}</td></tr>
  </table>

  <div class="summary">
    <div>в том числе НДС: 0,00</div>
    <div>в том числе НСП: 0,00</div>
    <div>Всего наименований ${items.length}, на сумму ${escapeHtml(formatMoney(total))} KGS</div>
    <div>${escapeHtml(numberToRussianSomText(total))}</div>
  </div>

  <div class="signature">
    <div><span class="label">Руководитель</span> <span class="signature-line"></span> ${escapeHtml(directorName)}</div>
    <div class="muted">подпись / расшифровка подписи</div>
  </div>
</body>
</html>`;
}

async function renderHtmlToPdf(html: string) {
  const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const workdir = await mkdtemp(path.join(tmpdir(), "ordo-commercial-invoice-"));
  const htmlPath = path.join(workdir, "invoice.html");
  const pdfPath = path.join(workdir, "invoice.pdf");

  try {
    await writeFile(htmlPath, html, "utf8");
    await execFileAsync(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        htmlPath,
      ],
      { timeout: 30000 },
    );
    return await readFile(pdfPath);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Не удалось сформировать PDF-счет.";
    throw new Response(`Не удалось сформировать PDF-счет. ${message}`, { status: 500 });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleCrm(request: NextRequest, parts: string[], data: AppData) {
  const id = parts[2] || "";
  if (parts[1] === "moysklad-monitor" && request.method === "GET") {
    requireAdmin(request, data);
    return json({ stats: getMoySkladMonitorStats() });
  }
  if (parts[1] === "login-users" && request.method === "GET") {
    return json({ users: await getCrmLoginUsers(data) });
  }
  if (parts[1] === "session" && request.method === "GET") {
    const user = getUserByRequest(request, data);
    return json({ user: user ? publicUser(user) : null });
  }
  if (parts[1] === "login" && request.method === "POST") {
    const payload = await body(request);
    const user = await authenticateCrmUser(asString(payload.login), asString(payload.password), data);
    if (!user) return error(401, "Неверный логин или пароль");
    const sessionId = randomUUID();
    upsertSessionUser(data, user);
    data.sessions[sessionId] = user.id;
    await writeData(data);
    return json({ user }, 200, { name: "ordo_crm_session", value: sessionId, maxAge: 60 * 60 * 24 * 30 });
  }
  if (parts[1] === "logout" && request.method === "POST") {
    const sessionId = request.cookies.get("ordo_crm_session")?.value || "";
    delete data.sessions[sessionId];
    await writeData(data);
    return json({ ok: true }, 200, { name: "ordo_crm_session", value: "", maxAge: 0 });
  }
  if (parts[1] === "ui-settings") {
    const user = requireUser(request, data);
    if (request.method === "GET") return json({ settings: await getUserUiSettings(user, data) });
    if (request.method === "PUT") {
      return json({ settings: await updateUserUiSettings(user, await body(request), data) });
    }
  }
  if (parts[1] === "users") {
    const actor = requireAdmin(request, data);
    if (!id && request.method === "GET") return json({ users: await getManagedCrmUsers(data) });
    if (request.method === "PUT") {
      const payload = await body(request);
      return json({ user: await updateManagedCrmUser(id, payload, data, actor) });
    }
    if (request.method === "DELETE") {
      return json(await deleteManagedCrmUser(id, data, actor));
    }
  }
  return error(404, "CRM endpoint не найден");
}

async function handleExpenses(request: NextRequest, parts: string[], data: AppData) {
  const user = requireUser(request, data);
  const id = parts[1] || "";
  if (!id && request.method === "GET") {
    const url = new URL(request.url);
    const category = url.searchParams.get("category") || "";
    if (isSupabaseCrmEnabled()) {
      const params: Record<string, string> = {
        select: "id,expense_date,category,subcategory,amount,branch_name,payment_method,description,created_by,created_at,updated_at",
        order: "expense_date.desc,created_at.desc",
      };
      if (category) params.category = `eq.${category}`;
      if (url.searchParams.get("dateFrom")) params.expense_date = `gte.${url.searchParams.get("dateFrom")}`;
      const rows = await supabaseGet("/rest/v1/business_expenses", params).catch(() => null) as JsonRecord[] | null;
      if (rows) return json({ expenses: rows.map(normalizeExpenseRow) });
    }
    return json({ expenses: data.expenses.filter((item) => !category || item.category === category) });
  }
  if (!id && request.method === "POST") {
    const payload = await body(request);
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch("/rest/v1/business_expenses?select=id,expense_date,category,subcategory,amount,branch_name,payment_method,description,created_by,created_at,updated_at", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(expensePayload(payload, user)),
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.[0]) return json({ expense: normalizeExpenseRow(rows[0]) }, 201);
    }
    const expense: Expense = {
      id: randomUUID(),
      expenseDate: asString(payload.expenseDate, new Date().toISOString().slice(0, 10)),
      category: asString(payload.category, "operational"),
      subcategory: asString(payload.subcategory),
      amount: asNumber(payload.amount),
      branchName: asString(payload.branchName),
      paymentMethod: asString(payload.paymentMethod, "Наличными"),
      description: asString(payload.description),
      createdBy: user.name,
    };
    data.expenses.unshift(expense);
    await writeData(data);
    return json({ expense }, 201);
  }
  const index = data.expenses.findIndex((item) => item.id === id);
  if (request.method === "PUT") {
    const payload = await body(request);
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch(`/rest/v1/business_expenses?id=eq.${encodeURIComponent(id)}&select=id,expense_date,category,subcategory,amount,branch_name,payment_method,description,created_by,created_at,updated_at`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(expensePayload(payload, user)),
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.[0]) return json({ expense: normalizeExpenseRow(rows[0]) });
    }
    if (index < 0) return error(404, "Расход не найден");
    data.expenses[index] = { ...data.expenses[index], ...payload };
    await writeData(data);
    return json({ expense: data.expenses[index] });
  }
  if (request.method === "DELETE") {
    if (isSupabaseCrmEnabled()) {
      const rows = await supabaseFetch(`/rest/v1/business_expenses?id=eq.${encodeURIComponent(id)}&select=id`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" },
      }).catch(() => null) as JsonRecord[] | null;
      if (rows?.length) return json({ ok: true });
    }
    if (index < 0) return error(404, "Расход не найден");
    data.expenses.splice(index, 1);
    await writeData(data);
    return json({ ok: true });
  }
  return error(405, "Метод не поддерживается");
}

async function handleAttendance(request: NextRequest, parts: string[], data: AppData) {
  const user = requireUser(request, data);
  if (autoCloseAttendanceRecords(data)) {
    await writeData(data);
  }
  if (parts[1] === "status" && request.method === "GET") {
    const openRecord = data.attendanceRecords.find((record) => record.userId === user.id && record.status === "open");
    return json({ status: openRecord ? "working" : "not_working", openRecord: openRecord ? currentAttendanceRecord(openRecord) : null, now: new Date().toISOString() });
  }
  if (parts[1] === "reports" && request.method === "GET") {
    const managedUsers = uniqueManagedUsers(await getManagedCrmUsers(data));
    const attendanceBranches = getAttendanceBranches(data);
    const url = new URL(request.url);
    const dateFrom = url.searchParams.get("date_from") || url.searchParams.get("dateFrom") || "";
    const dateTo = url.searchParams.get("date_to") || url.searchParams.get("dateTo") || "";
    const userId = url.searchParams.get("user_id") || url.searchParams.get("userId") || "";
    const storeId = url.searchParams.get("store_id") || url.searchParams.get("storeId") || "";
    const rows = data.attendanceRecords
      .map(currentAttendanceRecord)
      .filter((row) => {
        if (userId && row.userId !== userId) return false;
        if (storeId && row.storeId !== storeId) return false;
        const rowDate = row.checkInTime.slice(0, 10);
        if (dateFrom && rowDate < dateFrom) return false;
        if (dateTo && rowDate > dateTo) return false;
        return true;
      });
    return json({
      rows,
      events: [],
      stores: attendanceBranches,
      users: managedUsers,
      totals: {
        records: rows.length,
        open: rows.filter((row) => row.status === "open").length,
        failedAttempts: 0,
        totalWorkMinutes: rows.reduce((sum, row) => sum + row.currentWorkMinutes, 0),
        lateMinutes: rows.reduce((sum, row) => sum + row.lateMinutes, 0),
      },
      schedule: data.attendanceSchedule,
    });
  }
  if (parts[1] === "manual" && request.method === "POST") {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return error(403, "Только менеджер или выше может отмечать сотрудников вручную");
    }
    const payload = await body(request);
    const managedUsers = uniqueManagedUsers(await getManagedCrmUsers(data));
    const targetUser = managedUsers.find((item) => item.id === payload.userId);
    if (!targetUser) return error(404, "Сотрудник не найден");
    const store = resolveAttendanceBranch(data, asString(payload.storeId));
    if (!store) return error(400, "Не найден филиал для отметки");
    const action = asString(payload.action, "check_in");
    const timestamp = asString(payload.timestamp, new Date().toISOString());

    if (action === "check_in") {
      const existingOpen = data.attendanceRecords.find((item) => item.userId === targetUser.id && item.status === "open");
      if (existingOpen) return error(400, "У сотрудника уже есть открытая запись");
      const record: AttendanceRecord = {
        id: randomUUID(),
        userId: targetUser.id,
        userName: targetUser.name,
        storeId: store.id,
        storeName: store.name,
        checkInTime: timestamp,
        checkOutTime: "",
        checkInDistanceMeters: null,
        checkOutDistanceMeters: null,
        totalWorkMinutes: 0,
        currentWorkMinutes: 0,
        lateMinutes: 0,
        status: "open",
        source: "admin",
      };
      record.lateMinutes = getAttendanceLateMinutes(record, data.attendanceSchedule, store);
      data.attendanceRecords.unshift(record);
      await writeData(data);
      return json({ ok: true, action: "check_in", message: "Приход отмечен", status: "working", record, store, distanceMeters: 0 });
    }

    const record = data.attendanceRecords.find((item) => item.userId === targetUser.id && item.status === "open");
    if (!record) return error(400, "У сотрудника нет открытой записи");
    record.status = "closed";
    record.checkOutTime = timestamp;
    record.totalWorkMinutes = minutesBetween(record.checkInTime, record.checkOutTime);
    record.currentWorkMinutes = record.totalWorkMinutes;
    record.checkOutDistanceMeters = null;
    await writeData(data);
    return json({ ok: true, action: "check_out", message: "Уход отмечен", status: "not_working", record, store, distanceMeters: 0 });
  }
  if (parts[1] === "stores") {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return error(403, "Нет доступа к рабочим точкам");
    }
    const id = parts[2] || "";
    if (!id && request.method === "GET") return json({ stores: getAttendanceBranches(data) });
    if (!id && request.method === "POST") {
      const payload = await body(request);
      const store: AttendanceStore = {
        id: randomUUID(),
        name: asString(payload.name),
        branch: asString(payload.branch),
        address: asString(payload.address),
        latitude: asNumber(payload.latitude),
        longitude: asNumber(payload.longitude),
        allowedRadiusMeters: asNumber(payload.allowedRadiusMeters, 100),
      };
      data.attendanceStores.unshift(store);
      await writeData(data);
      return json({ store }, 201);
    }
    const index = data.attendanceStores.findIndex((store) => store.id === id);
    if (index < 0) return error(404, "Точка не найдена");
    if (parts[3] === "generate-qr" && request.method === "POST") return json({ store: data.attendanceStores[index] });
    if (parts[3] === "qr" && request.method === "DELETE") return json({ store: data.attendanceStores[index] });
    if (request.method === "PUT") {
      data.attendanceStores[index] = { ...data.attendanceStores[index], ...(await body(request)) };
      await writeData(data);
      return json({ store: data.attendanceStores[index] });
    }
    if (request.method === "DELETE") {
      const [store] = data.attendanceStores.splice(index, 1);
      await writeData(data);
      return json({ ok: true, store });
    }
  }
  if ((parts[1] === "scan" || parts[1] === "open" || parts[1] === "admin-open") && request.method === "POST") {
    if (parts[1] === "admin-open" && !["admin", "owner", "manager"].includes(user.role)) {
      return error(403, "Нет доступа");
    }
    const payload = await body(request);
    const targetUser = parts[1] === "admin-open" ? data.users.find((item) => item.id === payload.userId) || user : user;
    const store = resolveAttendanceBranch(data, asString(payload.storeId));
    if (!store) return error(400, "Не найден филиал для отметки");
    const record: AttendanceRecord = {
      id: randomUUID(),
      userId: targetUser.id,
      userName: targetUser.name,
      storeId: store.id,
      storeName: store.name,
      checkInTime: new Date().toISOString(),
      checkOutTime: "",
      checkInDistanceMeters: 0,
      checkOutDistanceMeters: null,
      totalWorkMinutes: 0,
      currentWorkMinutes: 0,
      lateMinutes: 0,
      status: "open",
      source: parts[1] === "admin-open" ? "admin" : "geo",
    };
    record.lateMinutes = getAttendanceLateMinutes(record, data.attendanceSchedule, store);
    data.attendanceRecords.unshift(record);
    await writeData(data);
    return json({ ok: true, action: "check_in", message: "Смена открыта", status: "working", record, store, distanceMeters: 0 });
  }
  if (parts[1] === "close" && request.method === "POST") {
    const record = data.attendanceRecords.find((item) => item.userId === user.id && item.status === "open");
    if (!record) return error(400, "Открытой смены нет");
    record.status = "closed";
    record.checkOutTime = new Date().toISOString();
    record.totalWorkMinutes = minutesBetween(record.checkInTime, record.checkOutTime);
    record.currentWorkMinutes = record.totalWorkMinutes;
    record.checkOutDistanceMeters = 0;
    await writeData(data);
    const store = resolveAttendanceBranch(data, record.storeId);
    return json({ ok: true, action: "check_out", message: "Смена закрыта", status: "not_working", record, store, distanceMeters: 0 });
  }
  if (parts[1] === "schedule" && request.method === "PUT") {
    if (!["admin", "owner", "manager"].includes(user.role)) {
      return error(403, "Нет доступа к графику");
    }
    const payload = await body(request);
    data.attendanceSchedule = normalizeAttendanceSchedule({
      workStartsAt: asString(payload.workStartsAt, data.attendanceSchedule.workStartsAt || "09:00"),
      workEndsAt: asString(payload.workEndsAt, data.attendanceSchedule.workEndsAt || "18:00"),
      branches: Array.isArray(payload.branches)
        ? payload.branches.map((branch) => ({
            key: asString(branch?.key || branch?.label),
            label: asString(branch?.label || branch?.key),
            workStartsAt: asString(branch?.workStartsAt, data.attendanceSchedule.workStartsAt || "09:00"),
            workEndsAt: asString(branch?.workEndsAt, data.attendanceSchedule.workEndsAt || "18:00"),
          }))
        : data.attendanceSchedule.branches,
    });
    await writeData(data);
    return json({ schedule: data.attendanceSchedule });
  }
  return error(404, "Attendance endpoint не найден");
}

async function handleLoyalty(request: NextRequest, parts: string[]) {
  const defaultPercent = asNumber(process.env.LOYALTY_DEFAULT_PERCENT, 3);
  if (parts[1] === "health" && request.method === "GET") {
    return json({ ok: true, supabaseConfigured: Boolean(getSupabaseUrl() && getSupabaseKey()), defaultPercent });
  }
  if (parts[1] === "config" && request.method === "GET") {
    return json({ defaultPercent });
  }
  if ((parts[1] === "customers" || parts[1] === "customer") && request.method === "GET") {
    const url = new URL(request.url);
    const phone = normalizePhone(url.searchParams.get("phone") || "");
    if (!phone) return error(400, "Введите телефон клиента");
    const rows = await supabaseGet("/rest/v1/loyalty_customers", {
      phone: `eq.${phone}`,
      select: "id,phone,name,bonus_balance,created_at,updated_at",
      limit: "1",
    }) as JsonRecord[];
    const customer = rows[0] || null;
    const transactions = customer ? await supabaseGet("/rest/v1/loyalty_transactions", {
      customer_id: `eq.${customer.id}`,
      select: "id,type,amount,balance_after,sale_id,comment,created_at",
      order: "created_at.desc",
      limit: "30",
    }) : [];
    return json({ customer, transactions });
  }
  if (parts[1] === "customers" && request.method === "POST") {
    const payload = await body(request);
    const phone = normalizePhone(payload.phone);
    const name = asString(payload.name).trim();
    if (!phone) return error(400, "Введите телефон клиента");
    if (!name) return error(400, "Введите ФИО клиента");
    const rows = await supabaseFetch("/rest/v1/loyalty_customers?select=id,phone,name,bonus_balance,created_at,updated_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ phone, name }),
    });
    return json({ customer: Array.isArray(rows) ? rows[0] : null }, 201);
  }
  if (parts[1] === "transactions" && parts[2] === "accrue" && request.method === "POST") {
    const payload = await body(request);
    const rows = await supabaseRpc("loyalty_accrue", {
      p_phone: normalizePhone(payload.phone),
      p_name: asString(payload.name).trim(),
      p_sale_id: asString(payload.saleId).trim(),
      p_sale_amount: Math.round(asNumber(payload.saleAmount)),
      p_percent: Number.isFinite(Number(payload.percent)) ? Number(payload.percent) : defaultPercent,
      p_comment: asString(payload.comment).trim(),
    }) as JsonRecord[];
    return json({ transaction: rows[0] || null });
  }
  if (parts[1] === "transactions" && parts[2] === "redeem" && request.method === "POST") {
    const payload = await body(request);
    const rows = await supabaseRpc("loyalty_redeem", {
      p_phone: normalizePhone(payload.phone),
      p_sale_id: asString(payload.saleId).trim(),
      p_amount: Math.round(asNumber(payload.amount)),
      p_comment: asString(payload.comment).trim(),
    }) as JsonRecord[];
    return json({ transaction: rows[0] || null });
  }
  return error(404, "Loyalty endpoint не найден");
}

async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const params = await context.params;
  const parts = params.path || [];
  const root = parts[0] || "";

  if (shouldUseLegacyBackend(request, parts)) {
    return proxyLegacyBackend(request, parts);
  }

  const data = await readData();
  const url = new URL(request.url);

  try {
    if (root === "status") return json({ ok: true, service: "ordo-crm-next" });
    if (root === "crm") return handleCrm(request, parts, data);
    if (root === "bot" && parts[1] === "products" && request.method === "GET") {
      requireBotApiKey(request);
      return json({
        products: (
          await getProducts(
            url.searchParams.get("search") || "",
            url.searchParams.get("storeHref") || "",
          )
        ).slice(0, Math.max(1, Math.min(10, Number(url.searchParams.get("limit")) || 5))),
      });
    }
    if (root === "audit" && request.method === "GET") {
      requireAdmin(request, data);
      return json({ rows: [] });
    }
    if (root === "config") return json({ branches, filials: branches });
    if (root === "employees") {
      const remote = await getAllMoySkladEmployeesRemote().catch(() => []);
      return json({
        employees: remote.length
          ? remote.map((item) => ({
              id: item.href || item.id,
              href: item.href || item.id,
              name: item.name,
              branchKey: item.branchIds[0] || "",
              branches: item.branchIds,
            }))
          : data.users.filter((user) => user.active).map((user) => ({
              id: user.id,
              name: user.name,
              href: user.id,
              branchKey: user.branches[0] || "",
              branches: user.branches,
            })),
      });
    }
    if (root === "retail-stores" || root === "stores") {
      const remote = await getMoySkladRetailStores();
      return json({ retailStores: remote.length ? remote : data.attendanceStores.map((store) => ({ id: store.id, href: store.id, name: store.name, storeHref: store.id, storeName: store.name })) });
    }
    if (root === "retail-shifts" && request.method === "GET") return json(await getRetailShiftsForApi(url));
    if (root === "retail-fiscal-status" && request.method === "GET") return getRetailFiscalStatusLite(url);
    if (root === "retail-fiscalize" && request.method === "POST") {
      const payload = await body(request);
      const documentId = asString(payload.documentId || payload.id || url.searchParams.get("documentId")).trim();
      if (!documentId) return error(400, 'Укажите documentId.');
      const document = await getRetailDemandById(documentId);
      return json(await triggerRetailFiscalizationSafely(document));
    }
    if (root === "payment-types") return json({ paymentTypes: await getMoySkladCustomEntityOptions(String(process.env.MOYSKLAD_PAYMENT_TYPE_CUSTOM_ENTITY_ID || "").trim(), paymentTypes) });
    if (root === "products") {
      return json({
        products: await getProducts(
          url.searchParams.get("search") || "",
          url.searchParams.get("storeHref") || "",
        ),
      });
    }
    if (root === "customers") return json({ customers: await getCustomers(url.searchParams.get("search") || "") });
    if (root === "calculate" && request.method === "POST") return json(calculateDraft(await body(request)));
    if (root === "orders" && request.method === "POST") {
      requireUser(request, data);
      const payload = await body(request);
      const calculation = calculateDraft(payload);
      const document = await createMoySkladDocument(calculation, payload);
      const loyalty = await applyLoyaltySafely(calculation, payload, document);
      const fiscalization = document.type === "retaildemand"
        ? await triggerRetailFiscalizationSafely(document)
        : { attempted: false, skipped: true, reason: "Документ не является розничной продажей." };
      const telegramReceipt = payload.receiptPhoto ? await sendTelegramReceiptSafely(asRecord(payload.receiptPhoto), calculation, payload, document) : null;
      const order = orderFromDraft({ ...payload, documentType: document.type }, data);
      order.id = asString(document.id, order.id);
      order.name = asString(document.name, order.name);
      order.type = document.type === "demand" ? "demand" : "retaildemand";
      data.orders.unshift(order);
      await writeData(data);
      return json({ ok: true, order, document, calculation, loyalty, fiscalization, telegramReceipt }, 201);
    }
    if (root === "reports" && parts[1] === "sales") {
      const user = requireUser(request, data);
      return json(await getMoySkladSalesReport(url, user));
    }
    if (root === "reports" && parts[1] === "bank-commissions" && parts[2] === "export.xls") {
      const analytics = await getBankCommissionAnalytics(url);
      const rows = [
        ["Банк", "Тип оплаты", "Оборот", "Комиссия", "Чистыми", "Платежей"],
        ...analytics.rows.map((row) => [row.bankName, row.paymentType, row.turnover, row.commission, row.netAmount, row.paymentCount]),
      ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
      return textFile(rows, "application/vnd.ms-excel; charset=utf-8", "bank-commissions.xls");
    }
    if (root === "reports" && parts[1] === "bank-commissions" && parts[2] === "export.pdf") {
      const analytics = await getBankCommissionAnalytics(url);
      return textFile(`<html><body><h1>Банковские комиссии</h1><pre>${JSON.stringify(analytics, null, 2)}</pre></body></html>`, "text/html; charset=utf-8", "bank-commissions.html");
    }
    if (root === "reports" && parts[1] === "bank-commissions") return json(await getBankCommissionAnalytics(url));
    if (root === "reports" && parts[1] === "returns" && request.method === "POST") {
      requireUser(request, data);
      return json(await createReportReturn(await body(request)), 201);
    }
    if (root === "report" && parts[1] === "session" && request.method === "GET") return json({ authenticated: Boolean(getUserByRequest(request, data)), user: getUserByRequest(request, data) ? publicUser(getUserByRequest(request, data) as CrmUser) : null });
    if (root === "report" && parts[1] === "login" && request.method === "POST") return json({ ok: true, authenticated: true });
    if (root === "report" && parts[1] === "logout" && request.method === "POST") return json({ ok: true });
    if (root === "expenses") return handleExpenses(request, parts, data);
    if (root === "deliveries") return handleDeliveries(request, parts, data);
    if (root === "attendance") return handleAttendance(request, parts, data);
    if (root === "loyalty") return handleLoyalty(request, parts);
    if (root === "reconciliation" && parts[1] === "debtors") {
      requireUser(request, data);
      const report = await getMoySkladReconciliation(url);
      if (parts[2]) {
        return json(await getReconciliationDebtorDetails(parts[2], url));
      }
      return json({ debtors: report.debtors, totals: report.totals, loadedAt: report.loadedAt, truncated: report.truncated, partial: report.partial, page: report.page });
    }
    if (root === "payroll" && parts[1] === "employees" && parts[2] === "config" && request.method === "POST") return json(await savePayrollConfigs(await body(request)));
    if (root === "payroll" && parts[1] === "employees" && request.method === "GET") return json(await getPayrollEmployeesReport(url, data));
    if (root === "payroll") return json(await getPayrollReport(url, data));
    if (root === "whatsapp" && parts[1] === "customers") return json({ customers: await getCustomers(url.searchParams.get("search") || "") });
    if (root === "customs-calculator" && parts[1] === "history") {
      const user = requireUser(request, data);
      const customsHistoryFilter = (user.role === "owner" || user.role === "admin")
        ? undefined
        : `eq.${asString(user.id)}`;
      if (parts[2] && request.method === "GET") {
        if (isSupabaseCrmEnabled()) {
          const rows = await supabaseGet(`/rest/v1/${CUSTOMS_HISTORY_TABLE}`, {
            id: `eq.${parts[2]}`,
            ...(customsHistoryFilter ? { user_id: customsHistoryFilter } : {}),
            select: "id,user_id,title,payload,created_at,updated_at",
            limit: "1",
          }).catch(() => null) as JsonRecord[] | null;
          if (rows?.[0]) return json({ row: normalizeCustomsHistoryRow(rows[0]) });
        }
        const row = data.customsHistory.find((item) => asString(asRecord(item).id) === parts[2]);
        if (!row) return error(404, "Расчет не найден");
        return json({ row });
      }
      if (parts[2] && request.method === "DELETE") {
        if (isSupabaseCrmEnabled()) {
          const params = new URLSearchParams({
            id: `eq.${parts[2]}`,
            select: "id",
          });
          if (customsHistoryFilter) params.set("user_id", customsHistoryFilter);
          const rows = await supabaseFetch(`/rest/v1/${CUSTOMS_HISTORY_TABLE}?${params.toString()}`, {
            method: "DELETE",
            headers: { Prefer: "return=representation" },
          }).catch(() => null) as JsonRecord[] | null;
          if (rows?.length) return json({ deleted: true });
        }
        data.customsHistory = data.customsHistory.filter((item) => asString(asRecord(item).id) !== parts[2]);
        await writeData(data);
        return json({ deleted: true });
      }
      if (request.method === "GET") {
        if (isSupabaseCrmEnabled()) {
          const rows = await supabaseGet(`/rest/v1/${CUSTOMS_HISTORY_TABLE}`, {
            ...(customsHistoryFilter ? { user_id: customsHistoryFilter } : {}),
            select: "id,user_id,title,payload,created_at,updated_at",
            order: "updated_at.desc,created_at.desc",
          }).catch(() => null) as JsonRecord[] | null;
          if (rows) return json({ rows: rows.map(normalizeCustomsHistoryRow) });
        }
        return json({ rows: data.customsHistory });
      }
      if (request.method === "POST") {
        const payload = await body(request);
        if (isSupabaseCrmEnabled()) {
          const rows = await supabaseFetch(`/rest/v1/${CUSTOMS_HISTORY_TABLE}?select=id,user_id,title,payload,created_at,updated_at`, {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(customsHistoryPayload(payload, user)),
          }).catch(() => null) as JsonRecord[] | null;
          if (rows?.[0]) return json({ row: normalizeCustomsHistoryRow(rows[0]) }, 201);
        }
        const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...payload };
        data.customsHistory.unshift(item);
        await writeData(data);
        return json({ row: item }, 201);
      }
      if (request.method === "DELETE") {
        if (isSupabaseCrmEnabled()) {
          const query = customsHistoryFilter
            ? `/rest/v1/${CUSTOMS_HISTORY_TABLE}?user_id=${encodeURIComponent(customsHistoryFilter)}`
            : `/rest/v1/${CUSTOMS_HISTORY_TABLE}`;
          await supabaseFetch(query, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" },
          }).catch(() => null);
        }
        data.customsHistory = [];
        await writeData(data);
        return json({ ok: true });
      }
    }
    if (root === "accounting" && parts[1] === "prices" && parts[2] === "update" && request.method === "POST") return json(await updateAccountingFormulaPrices(await body(request)));
    if (root === "accounting" && parts[1] === "prices" && parts[2] === "formula-update" && request.method === "POST") return json(await updateAccountingFormulaPrices(await body(request)));
    if (root === "accounting" && parts[1] === "price-formula" && parts[2] === "folder-template" && request.method === "POST") return json(await updateAccountingFolderPriceTemplate(await body(request)));
    if (root === "accounting" && parts[1] === "prices") return json(await getAccountingPriceCatalog(url));
    if (root === "accounting" && parts[1] === "supply-products") return json(await getAccountingSupplyProducts(url.searchParams.get("query") || url.searchParams.get("search") || ""));
    if (root === "accounting" && parts[1] === "price-formula") return json({ ok: true, updated: 0, failed: 0, results: [] });
    if (root === "commercial-documents" && parts[1] === "word" && request.method === "POST") {
      return textFile(buildCommercialInvoice(await body(request)), "application/msword; charset=utf-8", "schet-na-oplatu.doc");
    }
    if (root === "commercial-documents" && parts[1] === "pdf" && request.method === "POST") {
      const payload = await body(request);
      const content = await renderHtmlToPdf(buildCommercialInvoice(payload));
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("schet-na-oplatu.pdf")}`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (root === "commercial-documents") return json({ ok: true, id: randomUUID(), document: { id: randomUUID(), type: "customerorder" } });
  } catch (caught) {
    if (caught instanceof Response) return error(caught.status, await caught.text());
    return error(500, caught instanceof Error ? caught.message : "Internal server error");
  }

  return error(404, "API endpoint не найден");
}

export function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context);
}

export function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context);
}

export function PUT(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context);
}

export function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context);
}

export function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(request, context);
}
