import "server-only";

type PayrollProduct = {
  categoryName?: unknown;
  categoryPath?: unknown;
  quantity?: unknown;
};

type PayrollDocument = {
  type?: unknown;
  products?: unknown;
};

type CategoryBonusRule = {
  amount: number;
  categories: string[];
};

const CATEGORY_BONUS_RULES: CategoryBonusRule[] = [
  { amount: 300, categories: ["Встраиваемые варочные панели"] },
  { amount: 400, categories: ["Встраиваемые духовые шкафы"] },
  { amount: 300, categories: ["Встраиваемые микроволновые печи"] },
  { amount: 500, categories: ["Встраиваемые посудомоечные машины"] },
  { amount: 500, categories: ["Встраиваемые холодильники", "Встраиваемые холодильики"] },
  { amount: 300, categories: ["Кухонные вытяжки"] },
  { amount: 400, categories: ["Газовые и электрические плиты"] },
  { amount: 500, categories: ["Морозильники"] },
  { amount: 500, categories: ["Посудомоечные машины"] },
  { amount: 500, categories: ["Холодильники"] },
  { amount: 200, categories: ["Аэрогрили"] },
  { amount: 200, categories: ["Блендеры и Чопперы"] },
  { amount: 200, categories: ["Вафельницы"] },
  { amount: 300, categories: ["Духовые мини-печи"] },
  { amount: 200, categories: ["Кофемашины и Кофемолки"] },
  { amount: 300, categories: ["Микроволновые печи"] },
  { amount: 200, categories: ["Миксеры"] },
  { amount: 300, categories: ["Мультиварки"] },
  { amount: 300, categories: ["Мясорубки"] },
  { amount: 200, categories: ["Настольные плиты"] },
  { amount: 200, categories: ["Посуда"] },
  { amount: 200, categories: ["Соковыжималки"] },
  { amount: 200, categories: ["Хлебопечи"] },
  { amount: 200, categories: ["Электрические чайники и термопоты", "Электричесие чайники и термопоты"] },
  { amount: 150, categories: ["Гладильные доски"] },
  { amount: 200, categories: ["Отпариватели"] },
  { amount: 300, categories: ["Полуавтоматические стиральные машины", "Полуавтоматческие стиральные машины"] },
  { amount: 300, categories: ["Пылесосы"] },
  { amount: 500, categories: ["Стиральные машины"] },
  { amount: 150, categories: ["Сушилки для белья"] },
  { amount: 500, categories: ["Сушильные машины"] },
  { amount: 200, categories: ["Утюги"] },
  { amount: 200, categories: ["Вентиляторы"] },
  { amount: 300, categories: ["Водонагреватели"] },
  { amount: 500, categories: ["Кондиционеры"] },
  { amount: 200, categories: ["Обогреватели"] },
  { amount: 200, categories: ["Очистители воздуха"] },
  { amount: 200, categories: ["Увлажнители"] },
  { amount: 300, categories: ["Аудиотехника"] },
  { amount: 50, categories: ["Кронштейн", "Кронштейны"] },
  { amount: 500, categories: ["Телевизоры"] },
  { amount: 200, categories: ["Весы"] },
  { amount: 200, categories: ["Массажеры", "Массажёры"] },
  { amount: 200, categories: ["Плойки и утюжки для волос"] },
  { amount: 200, categories: ["Триммеры и машинки для волос"] },
  { amount: 200, categories: ["Фены"] },
  { amount: 200, categories: ["Электрические зубные щетки", "Электрические зубные щётки"] },
];

const RETURN_DOCUMENT_TYPES = new Set(["retailsalesreturn", "salesreturn"]);

function normalizeCategory(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

const bonusByCategory = new Map<string, number>();
for (const rule of CATEGORY_BONUS_RULES) {
  for (const category of rule.categories) bonusByCategory.set(normalizeCategory(category), rule.amount);
}

function asPositiveQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function getCategoryCandidates(product: PayrollProduct) {
  const candidates = [normalizeCategory(product.categoryName)];
  const pathParts = String(product.categoryPath || "").split("/").map(normalizeCategory).reverse();
  return [...new Set([...candidates, ...pathParts].filter(Boolean))];
}

export function getPayrollCategoryBonusForProduct(product: PayrollProduct) {
  const category = getCategoryCandidates(product).find((candidate) => bonusByCategory.has(candidate));
  return category ? (bonusByCategory.get(category) ?? 0) * asPositiveQuantity(product.quantity) : 0;
}

export function calculatePayrollCategoryBonus(documents: PayrollDocument[]) {
  return documents.reduce((total, document) => {
    const products = Array.isArray(document.products) ? document.products as PayrollProduct[] : [];
    const documentBonus = products.reduce((sum, product) => sum + getPayrollCategoryBonusForProduct(product), 0);
    const direction = RETURN_DOCUMENT_TYPES.has(String(document.type || "")) ? -1 : 1;
    return total + documentBonus * direction;
  }, 0);
}
