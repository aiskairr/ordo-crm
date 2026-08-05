import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MOYSKLAD_BASE_URL = "https://api.moysklad.ru/api/remap/1.2";
const CODE_LENGTH = 5;
const CODE_FORMAT = "00000";
const REQUEST_INTERVAL_MS = 650;
const PAGE_LIMIT = 1000;
const applyChanges = process.argv.includes("--apply");
const includeArchived = process.argv.includes("--include-archived");
const resumeArgument = process.argv.find((argument) => argument.startsWith("--resume="));
const resumePath = resumeArgument ? path.resolve(process.cwd(), resumeArgument.slice("--resume=".length)) : "";

function parseEnvLine(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  return [match[1], value];
}

async function loadLocalEnv() {
  try {
    const contents = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const entry = parseEnvLine(line);
      if (entry && process.env[entry[0]] === undefined) process.env[entry[0]] = entry[1];
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(payload, fallback) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.map((item) => item?.error || item?.message).filter(Boolean).join("; ")
    || payload?.error
    || payload?.message
    || fallback;
}

async function moySkladRequest(token, url, init = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json;charset=utf-8",
        ...(init.body ? { "Content-Type": "application/json;charset=utf-8" } : {}),
        ...init.headers,
      },
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return payload;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
      continue;
    }
    throw new Error(getErrorMessage(payload, `МойСклад вернул HTTP ${response.status}`));
  }
  throw new Error("МойСклад временно ограничил запросы.");
}

async function loadProductsByArchivedState(token, archived) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const url = new URL(`${MOYSKLAD_BASE_URL}/entity/product`);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("order", "name,asc");
    url.searchParams.set("filter", `archived=${archived}`);
    const page = await moySkladRequest(token, url);
    const pageRows = Array.isArray(page?.rows) ? page.rows : [];
    rows.push(...pageRows);
    process.stdout.write(`\rЗагружено товаров: ${rows.length}`);
    if (pageRows.length < PAGE_LIMIT) break;
    await sleep(REQUEST_INTERVAL_MS);
  }
  process.stdout.write("\n");
  return rows;
}

async function loadProducts(token) {
  const active = await loadProductsByArchivedState(token, false);
  if (!includeArchived) return active;
  const archived = await loadProductsByArchivedState(token, true);
  const byId = new Map([...active, ...archived].map((product) => [String(product.id), product]));
  return [...byId.values()];
}

function generateCode(index) {
  const code = String(index).padStart(CODE_LENGTH, "0");
  if (code.length > CODE_LENGTH) {
    throw new Error(`Для формата ${CODE_FORMAT} слишком много товаров: доступно не более 100 000 кодов.`);
  }
  return code;
}

function buildPlan(products) {
  const occupiedCodes = new Set(products.map((product) => String(product.code || "").trim().toUpperCase()).filter(Boolean));
  const assignedCodes = new Set();
  let sequence = 0;
  return products
    .slice()
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((product) => {
      let code = "";
      do {
        code = generateCode(sequence);
        sequence += 1;
      } while (occupiedCodes.has(code) || assignedCodes.has(code));
      assignedCodes.add(code);
      return {
        id: String(product.id),
        href: String(product?.meta?.href || `${MOYSKLAD_BASE_URL}/entity/product/${product.id}`),
        name: String(product.name || "Без названия"),
        archived: Boolean(product.archived),
        oldCode: String(product.code || ""),
        newCode: code,
        status: "pending",
        error: "",
      };
    });
}

async function saveReport(reportPath, report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  await loadLocalEnv();
  const token = String(process.env.MOYSKLAD_TOKEN || "").trim();
  if (!token) throw new Error("В .env.local не найден MOYSKLAD_TOKEN.");
  if (resumePath && !applyChanges) throw new Error("Для продолжения добавьте флаг --apply.");

  console.log(`Режим: ${applyChanges ? "ИЗМЕНЕНИЕ КОДОВ" : "ПРЕДПРОСМОТР"}`);
  console.log(`Архивные товары: ${includeArchived ? "включены" : "не изменяются"}`);
  let report;
  let reportPath;
  if (resumePath) {
    report = JSON.parse(await readFile(resumePath, "utf8"));
    if (!Array.isArray(report?.products) || !report.products.length) {
      throw new Error("Файл продолжения не содержит план товаров.");
    }
    if (report.format !== CODE_FORMAT) {
      throw new Error(`Этот отчёт использует старый формат «${report.format || "неизвестно"}». Создайте новый план с цифровыми кодами.`);
    }
    reportPath = resumePath;
    report.applied = true;
    report.failed = report.products.filter((product) => product.status === "failed").length;
    report.completed = report.products.filter((product) => product.status === "updated").length;
    console.log(`Продолжаю отчёт: ${reportPath}`);
  } else {
    const products = await loadProducts(token);
    if (!products.length) throw new Error("В МойСклад не найдены товары.");
    report = {
      createdAt: new Date().toISOString(),
      applied: applyChanges,
      includeArchived,
      format: CODE_FORMAT,
      total: products.length,
      completed: 0,
      failed: 0,
      products: buildPlan(products),
    };
    const reportDirectory = path.join(process.cwd(), ".ordo-data", "product-code-migrations");
    await mkdir(reportDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    reportPath = path.join(reportDirectory, `${applyChanges ? "applied" : "preview"}-${stamp}.json`);
    await saveReport(reportPath, report);
  }

  console.table(report.products.slice(0, 20).map(({ name, oldCode, newCode }) => ({ name, oldCode, newCode })));
  if (report.products.length > 20) console.log(`Показаны первые 20 из ${report.products.length} товаров.`);
  console.log(`Полный план сохранён: ${reportPath}`);

  if (!applyChanges) {
    console.log("Изменений не сделано. Для применения запустите команду с --apply.");
    return;
  }

  for (let index = 0; index < report.products.length; index += 1) {
    const product = report.products[index];
    if (product.status === "updated") continue;
    if (product.status === "failed") report.failed -= 1;
    try {
      await moySkladRequest(token, product.href, {
        method: "PUT",
        body: JSON.stringify({ code: product.newCode }),
      });
      product.status = "updated";
      report.completed += 1;
    } catch (error) {
      product.status = "failed";
      product.error = error instanceof Error ? error.message : String(error);
      report.failed += 1;
    }
    await saveReport(reportPath, report);
    process.stdout.write(`\rОбновлено: ${report.completed}/${report.total}; ошибок: ${report.failed}`);
    if (index < report.products.length - 1) await sleep(REQUEST_INTERVAL_MS);
  }
  process.stdout.write("\n");
  console.log(`Готово. Отчёт и старые коды сохранены: ${reportPath}`);
  if (report.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Ошибка: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
