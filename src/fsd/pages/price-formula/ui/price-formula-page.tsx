"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Copy, PackageSearch, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  getAccountingPriceCatalogPage,
  getSupplyProducts,
  saveFolderTemplate,
  saveFormulaPrices,
  type FormulaChange,
  type PriceCatalogPage,
  type PriceFormulaTemplate,
  type PriceProduct,
  type PriceTier,
  type PriceType,
  type ProductFolder,
  type TierCurrency,
} from "../api/price-formula-api";
import styles from "./price-formula-page.module.css";

const PAGE_SIZE = 100;
const LOAD_BATCH_SIZE = 500;
const SETTINGS_KEY = "ordoPriceFormulaPageV2";
const DEFAULT_TIERS: PriceTier[] = [
  { from: 20, to: 40, amount: 1500, currency: "kgs" },
  { from: 40, to: 100, amount: 2000, currency: "kgs" },
];

type ParsedTier = { from: number; to: number; amount: number; currency: TierCurrency };
type FormulaSettings = {
  rate: number;
  tiers: ParsedTier[];
  wholesaleTiers: ParsedTier[];
  bank36: number;
  bank912: number;
  calculate36: boolean;
  calculate912: boolean;
  rounding: number;
  wholesaleRounding: number;
};
type TemplateOption = PriceFormulaTemplate & { id: string; folderHref: string; folderName: string };
type ProductCalculationResult = FormulaChange | { error: string };
type StoredSettings = Partial<PriceFormulaTemplate> & { bank36Percent?: number; bank912Percent?: number };
type SelectOption = { value: string; label: string };

const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU").format(Number(value || 0));
const formatMoney = (value: number, suffix: string) => `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))} ${suffix}`;
const roundMoney = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const roundBy = (value: number, rounding: number) => {
  const step = Number(rounding || 0);
  return step > 0 ? roundMoney(Math.round(value / step) * step) : roundMoney(value);
};
const normalizeSearch = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ru-RU");
const getFolderDisplayName = (folder?: ProductFolder | null) => {
  if (!folder) return "Без группы";
  const label = [folder.pathName, folder.name].filter(Boolean).join(" / ").trim();
  if (label) return label;
  const fallbackId = folder.href.split("/").filter(Boolean).pop();
  return fallbackId ? `Группа ${fallbackId.slice(0, 8)}` : "Группа без названия";
};
const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

function mergeProducts(current: PriceProduct[], incoming: PriceProduct[]): PriceProduct[] {
  const products = new Map(current.map((product) => [product.id, product]));
  for (const product of incoming) products.set(product.id, product);
  return [...products.values()];
}

function normalizeTiers(tiers?: PriceTier[]) {
  return Array.isArray(tiers) && tiers.length ? tiers : DEFAULT_TIERS;
}

function parseOptionalNumber(value: string | number, fallback: number) {
  return String(value ?? "").trim() === "" ? fallback : Number(value);
}

function parseTiers(tiers: PriceTier[]): ParsedTier[] {
  return normalizeTiers(tiers)
    .map((tier) => ({
      from: parseOptionalNumber(tier.from, 0),
      to: parseOptionalNumber(tier.to, Infinity),
      amount: Number(tier.amount),
      currency: (tier.currency === "usd" ? "usd" : "kgs") as TierCurrency,
    }))
    .filter((tier) => Number.isFinite(tier.from) && tier.to > tier.from && Number.isFinite(tier.amount) && tier.amount >= 0)
    .sort((left, right) => left.from - right.from);
}

function getBuyPriceCurrency(buyPrice?: { currencyIsoCode?: string; currencyName?: string }): "usd" | "kgs" | "unknown" {
  const currency = normalizeSearch(`${buyPrice?.currencyIsoCode || ""} ${buyPrice?.currencyName || ""}`);
  if (currency.includes("usd") || currency.includes("доллар")) return "usd";
  if (currency.includes("kgs") || currency.includes("kgz") || currency.includes("сом")) return "kgs";
  return "unknown";
}

function getPriceRecord(product: PriceProduct, priceTypeHref: string) {
  return product.prices.find((price) => price.priceTypeHref === priceTypeHref) || null;
}

function getPrice(product: PriceProduct, priceTypeHref: string) {
  return roundMoney(Number(getPriceRecord(product, priceTypeHref)?.value || 0));
}

function formatWholesale(product: PriceProduct, priceTypeHref: string) {
  const price = getPriceRecord(product, priceTypeHref);
  const currency = price?.currencyIsoCode || price?.currencyName || product.buyPrice?.currencyIsoCode || product.buyPrice?.currencyName || "USD";
  return formatMoney(Number(price?.value || 0), currency);
}

function findPriceType(types: PriceType[], keys: string[]) {
  return types.find((type) => keys.some((key) => normalizeSearch(type.name).includes(key)))?.href || "";
}

function getAllowedFolderHrefs(folderHref: string, folders: ProductFolder[]) {
  if (!folderHref) return new Set<string>();
  const folder = folders.find((item) => item.href === folderHref);
  if (!folder) return new Set([folderHref]);
  const basePath = getFolderDisplayName(folder);
  return new Set(folders.filter((item) => item.href === folderHref || getFolderDisplayName(item).startsWith(`${basePath} / `)).map((item) => item.href));
}

function hasFolderLabel(folder?: ProductFolder | null) {
  return Boolean(String(folder?.name || folder?.pathName || "").trim());
}

function pickBetterFolder(current: ProductFolder | undefined, incoming: ProductFolder) {
  if (!current) return incoming;
  if (!hasFolderLabel(current) && hasFolderLabel(incoming)) return incoming;
  if (current.template || !incoming.template) return current;
  return { ...current, template: incoming.template };
}

function getWholesaleCurrencyHref(product: PriceProduct, wholesaleHref: string) {
  const wholesalePrice = getPriceRecord(product, wholesaleHref);
  if (getBuyPriceCurrency(wholesalePrice || undefined) === "usd") return wholesalePrice?.currencyHref || "";
  return getBuyPriceCurrency(product.buyPrice) === "usd" ? product.buyPrice?.currencyHref || "" : "";
}

function calculateProductPrices(product: PriceProduct, settings: FormulaSettings, wholesaleHref: string): ProductCalculationResult {
  const buyPrice = Number(product.buyPrice?.value || 0);
  if (buyPrice <= 0) return { error: "Нет закупочной цены" };

  const buyCurrency = getBuyPriceCurrency(product.buyPrice);
  if (buyCurrency === "unknown") return { error: "Валюта закупки не USD и не KGS" };

  const buyPriceUsd = buyCurrency === "kgs" ? buyPrice / settings.rate : buyPrice;
  const baseKgs = buyCurrency === "kgs" ? buyPrice : buyPrice * settings.rate;
  const minTier = settings.tiers.find((tier) => buyPriceUsd >= tier.from && buyPriceUsd < tier.to);
  if (!minTier) return { error: "Закупочная цена вне диапазонов минимальной цены" };
  const wholesaleTier = settings.wholesaleTiers.find((tier) => buyPriceUsd >= tier.from && buyPriceUsd < tier.to);
  if (!wholesaleTier) return { error: "Закупочная цена вне диапазонов оптовой цены" };

  const minMarkupKgs = minTier.currency === "usd" ? minTier.amount * settings.rate : minTier.amount;
  const wholesaleMarkupUsd = wholesaleTier.currency === "usd" ? wholesaleTier.amount : wholesaleTier.amount / settings.rate;
  const minPrice = roundBy(baseKgs + minMarkupKgs, settings.rounding);
  const wholesalePrice = roundBy(buyPriceUsd + wholesaleMarkupUsd, settings.wholesaleRounding);

  return {
    productId: product.id,
    wholesaleCurrencyHref: getWholesaleCurrencyHref(product, wholesaleHref),
    wholesalePrice: Math.max(0, roundMoney(wholesalePrice)),
    minPrice: Math.max(0, roundMoney(minPrice)),
    price36: settings.calculate36 ? Math.max(0, roundMoney(roundBy(minPrice * (1 + settings.bank36 / 100), settings.rounding))) : null,
    price912: settings.calculate912 ? Math.max(0, roundMoney(roundBy(minPrice * (1 + settings.bank912 / 100), settings.rounding))) : null,
  };
}

function settingsFromTemplate(template: PriceFormulaTemplate): FormulaSettings {
  return {
    rate: Number(template.usdRate ?? 89),
    tiers: parseTiers(template.tiers),
    wholesaleTiers: parseTiers(template.wholesaleTiers || template.tiers),
    bank36: Number(template.bank36 ?? 10),
    bank912: Number(template.bank912 ?? 20),
    calculate36: template.calculate36 !== false,
    calculate912: template.calculate912 !== false,
    rounding: Number(template.rounding ?? 10),
    wholesaleRounding: Number(template.wholesaleRounding ?? 0.1),
  };
}

function validateFormulaSettings(settings: FormulaSettings) {
  if (!Number.isFinite(settings.rate) || settings.rate <= 0) return "Введите корректный курс доллара.";
  if (!settings.tiers.length) return "Добавьте хотя бы один корректный диапазон минимальной цены.";
  if (!settings.wholesaleTiers.length) return "Добавьте хотя бы один корректный диапазон оптовой цены.";
  if (settings.calculate36 && (!Number.isFinite(settings.bank36) || settings.bank36 < 0)) return "Введите корректный процент банка 3-6.";
  if (settings.calculate912 && (!Number.isFinite(settings.bank912) || settings.bank912 < 0)) return "Введите корректный процент банка 9-12.";
  return "";
}

export function PriceFormulaPage() {
  const { showToast } = useToast();
  const loadGeneration = useRef(0);
  const [products, setProducts] = useState<PriceProduct[]>([]);
  const [priceTypes, setPriceTypes] = useState<PriceType[]>([]);
  const [apiFolders, setApiFolders] = useState<ProductFolder[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [search, setSearch] = useState("");
  const [folderHref, setFolderHref] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [calculated, setCalculated] = useState<Map<string, FormulaChange>>(new Map());
  const [skipped, setSkipped] = useState<Map<string, string>>(new Map());
  const [productTemplates, setProductTemplates] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(1);
  const [supplyFilter, setSupplyFilter] = useState<Set<string> | null>(null);
  const [supplyName, setSupplyName] = useState("");
  const [status, setStatus] = useState("Загрузка каталога...");
  const [usdRate, setUsdRate] = useState(89);
  const [bank36, setBank36] = useState(10);
  const [bank912, setBank912] = useState(20);
  const [calculate36, setCalculate36] = useState(true);
  const [calculate912, setCalculate912] = useState(true);
  const [rounding, setRounding] = useState(10);
  const [wholesaleRounding, setWholesaleRounding] = useState(0.1);
  const [tiers, setTiers] = useState<PriceTier[]>(DEFAULT_TIERS);
  const [wholesaleTiers, setWholesaleTiers] = useState<PriceTier[]>(DEFAULT_TIERS);

  const folders = useMemo(() => {
    const byHref = new Map<string, ProductFolder>();
    for (const folder of apiFolders) byHref.set(folder.href, pickBetterFolder(byHref.get(folder.href), folder));
    for (const product of products) {
      if (product.folder?.href) byHref.set(product.folder.href, pickBetterFolder(byHref.get(product.folder.href), product.folder));
    }
    return [...byHref.values()]
      .filter(hasFolderLabel)
      .sort((left, right) => getFolderDisplayName(left).localeCompare(getFolderDisplayName(right), "ru"));
  }, [apiFolders, products]);

  const templates = useMemo<TemplateOption[]>(
    () => folders.filter((folder) => folder.template).map((folder) => ({ ...folder.template!, id: folder.href, folderHref: folder.href, folderName: getFolderDisplayName(folder) })),
    [folders],
  );

  const effectiveType36 = findPriceType(priceTypes, ["3-6", "3 6", "3-6м", "3 6м"]);
  const effectiveType912 = findPriceType(priceTypes, ["9-12", "9 12", "9-12м", "9 12м"]);
  const effectiveWholesale = findPriceType(priceTypes, ["оптов", "wholesale"]);
  const settings: FormulaSettings = useMemo(() => ({
    rate: Number(usdRate),
    tiers: parseTiers(tiers),
    wholesaleTiers: parseTiers(wholesaleTiers),
    bank36: Number(bank36),
    bank912: Number(bank912),
    calculate36,
    calculate912,
    rounding: Number(rounding),
    wholesaleRounding: Number(wholesaleRounding),
  }), [bank36, bank912, calculate36, calculate912, rounding, tiers, usdRate, wholesaleRounding, wholesaleTiers]);

  const filteredProducts = useMemo(() => {
    const query = normalizeSearch(search);
    const allowedFolders = getAllowedFolderHrefs(folderHref, folders);
    return products.filter((product) => {
      if (supplyFilter && !supplyFilter.has(product.href)) return false;
      if (!supplyFilter && product.archived) return false;
      if (folderHref && !allowedFolders.has(product.folder?.href || "")) return false;
      if (!query) return true;
      return normalizeSearch([product.name, product.code, product.article].join(" ")).includes(query);
    });
  }, [folderHref, folders, products, search, supplyFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const pageProducts = filteredProducts.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const selectedChanges = useMemo(() => [...selected].map((id) => calculated.get(id)).filter((change): change is FormulaChange => Boolean(change)), [calculated, selected]);

  const applyCatalogPage = useCallback((data: PriceCatalogPage, replace: boolean) => {
    setProducts((current) => (replace ? data.products : mergeProducts(current, data.products)));
    if (data.priceTypes.length) setPriceTypes(data.priceTypes);
    if (data.folders.length) setApiFolders((current) => (replace ? data.folders : mergeFolders(current, data.folders)));
    setTotal(data.total);
  }, []);

  const loadCatalog = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoadingCatalog(true);
    setStatus("Загрузка первой партии каталога...");
    setSelected(new Set());
    setCalculated(new Map());
    setSkipped(new Map());
    setProductTemplates(new Map());
    try {
      const first = await getAccountingPriceCatalogPage({ offset: 0, limit: LOAD_BATCH_SIZE });
      if (generation !== loadGeneration.current) return;
      applyCatalogPage(first, true);
      setStatus(first.hasMore ? `Загружено ${first.products.length} из ${first.total}. Остальное подтягивается в фоне...` : `Каталог загружен: ${first.products.length} товаров.`);

      let offset = first.nextOffset;
      while (generation === loadGeneration.current && first.total > offset && first.hasMore) {
        const batch = await getAccountingPriceCatalogPage({ offset, limit: LOAD_BATCH_SIZE, includePriceTypes: false });
        if (generation !== loadGeneration.current) return;
        applyCatalogPage(batch, false);
        offset = batch.nextOffset || offset + LOAD_BATCH_SIZE;
        setStatus(batch.hasMore ? `Загружаю каталог: ${Math.min(offset, first.total)} из ${first.total}...` : `Каталог загружен: ${first.total} товаров.`);
        if (!batch.hasMore) break;
      }
    } catch (error) {
      if (generation === loadGeneration.current) {
        setStatus(`API не отвечает: ${getErrorText(error)}`);
        showToast({ tone: "error", title: "Не удалось загрузить каталог", description: getErrorText(error) });
      }
    } finally {
      if (generation === loadGeneration.current) setLoadingCatalog(false);
    }
  }, [applyCatalogPage, showToast]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as StoredSettings;
        setUsdRate(Number(saved.usdRate ?? 89));
        setTiers(normalizeTiers(saved.tiers));
        setWholesaleTiers(normalizeTiers(saved.wholesaleTiers || saved.tiers));
        setBank36(Number(saved.bank36 ?? saved.bank36Percent ?? 10));
        setBank912(Number(saved.bank912 ?? saved.bank912Percent ?? 20));
        setCalculate36(saved.calculate36 !== false);
        setCalculate912(saved.calculate912 !== false);
        setRounding(Number(saved.rounding ?? 10));
        setWholesaleRounding(Number(saved.wholesaleRounding ?? 0.1));
      } catch {
        localStorage.removeItem(SETTINGS_KEY);
      }
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadCatalog());
  }, [loadCatalog]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      usdRate,
      tiers,
      wholesaleTiers,
      bank36,
      bank36Percent: bank36,
      bank912,
      bank912Percent: bank912,
      calculate36,
      calculate912,
      rounding,
      wholesaleRounding,
    }));
  }, [bank36, bank912, calculate36, calculate912, rounding, tiers, usdRate, wholesaleRounding, wholesaleTiers]);

  const templateMutation = useMutation({
    mutationFn: saveFolderTemplate,
    onSuccess: async (folder) => {
      setApiFolders((current) => mergeFolders(current, [folder]));
      setProducts((current) => current.map((product) => (product.folder?.href === folder.href ? { ...product, folder } : product)));
      setSelectedTemplate(folder.template ? folder.href : "");
      showToast({ tone: "success", title: folder.template ? "Шаблон сохранен" : "Шаблон удален" });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить шаблон", description: getErrorText(error) }),
  });

  const saveMutation = useMutation({
    mutationFn: saveFormulaPrices,
    onSuccess: async (result) => {
      const failed = (result.results ?? []).filter((item) => !item.ok);
      showToast({
        tone: failed.length ? "error" : "success",
        title: failed.length ? `Обновлено: ${result.updated || 0}, ошибок: ${result.failed || 0}` : `Сохранено: ${result.updated || 0}`,
        description: failed[0]?.error || "",
      });
      setCalculated(new Map());
      setSkipped(new Map());
      setSelected(new Set());
      await loadCatalog();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить цены", description: getErrorText(error) }),
  });

  const clearCalculated = () => {
    setCalculated(new Map());
    setSkipped(new Map());
  };

  const patchTier = (index: number, patch: Partial<PriceTier>, wholesaleMode = false) => {
    const setter = wholesaleMode ? setWholesaleTiers : setTiers;
    setter((current) => current.map((tier, itemIndex) => (itemIndex === index ? { ...tier, ...patch } : tier)));
    clearCalculated();
  };

  const removeTier = (index: number, wholesaleMode = false) => {
    const setter = wholesaleMode ? setWholesaleTiers : setTiers;
    setter((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : DEFAULT_TIERS;
    });
    clearCalculated();
  };

  const applyTemplate = (template: PriceFormulaTemplate) => {
    setTemplateName(template.name || "");
    setUsdRate(Number(template.usdRate ?? 89));
    setTiers(normalizeTiers(template.tiers));
    setWholesaleTiers(normalizeTiers(template.wholesaleTiers || template.tiers));
    setBank36(Number(template.bank36 ?? 10));
    setBank912(Number(template.bank912 ?? 20));
    setCalculate36(template.calculate36 !== false);
    setCalculate912(template.calculate912 !== false);
    setRounding(Number(template.rounding ?? 10));
    setWholesaleRounding(Number(template.wholesaleRounding ?? 0.1));
    clearCalculated();
  };

  const calculateProducts = (ids: Set<string>, nextSettings = settings) => {
    const validation = validateFormulaSettings(nextSettings);
    if (validation) {
      setStatus(validation);
      return { calculatedCount: 0, skippedCount: ids.size };
    }
    const nextCalculated = new Map(calculated);
    const nextSkipped = new Map<string, string>();
    let calculatedCount = 0;
    let skippedCount = 0;
    for (const product of products.filter((item) => ids.has(item.id))) {
      const result = calculateProductPrices(product, nextSettings, effectiveWholesale);
      if ("error" in result) {
        nextCalculated.delete(product.id);
        nextSkipped.set(product.id, result.error);
        skippedCount += 1;
      } else {
        nextCalculated.set(product.id, result);
        calculatedCount += 1;
      }
    }
    setCalculated(nextCalculated);
    setSkipped(nextSkipped);
    return { calculatedCount, skippedCount };
  };

  const handleFolderChange = (value: string) => {
    setFolderHref(value);
    setPage(1);
    setSelected(new Set());
    clearCalculated();
    const folder = folders.find((item) => item.href === value);
    if (!folder?.template) return;

    applyTemplate(folder.template);
    setSelectedTemplate(value);
    const allowed = getAllowedFolderHrefs(value, folders);
    const ids = new Set(products.filter((item) => allowed.has(item.folder?.href || "")).map((item) => item.id));
    setSelected(ids);
    const result = calculateProducts(ids, settingsFromTemplate(folder.template));
    setStatus(result.skippedCount
      ? `Применен шаблон «${folder.template.name}». Рассчитано: ${result.calculatedCount}. Пропущено: ${result.skippedCount}.`
      : `Применен шаблон «${folder.template.name}». Рассчитано товаров: ${result.calculatedCount}.`);
  };

  const applyTemplateToProductFolder = (product: PriceProduct, templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    if (template.folderHref !== product.folder?.href) {
      setStatus("Шаблон можно применить только к своей подгруппе товара.");
      return;
    }
    const ids = new Set(filteredProducts.filter((item) => item.folder?.href === product.folder?.href).map((item) => item.id));
    setSelected((current) => new Set([...current, ...ids]));
    setProductTemplates((current) => {
      const next = new Map(current);
      for (const id of ids) next.set(id, templateId);
      return next;
    });
    const result = calculateProducts(ids, settingsFromTemplate(template));
    setStatus(result.skippedCount
      ? `Шаблон «${template.name}» применен к подгруппе: ${result.calculatedCount}. Пропущено: ${result.skippedCount}.`
      : `Шаблон «${template.name}» применен к товарам этой подгруппы: ${result.calculatedCount}.`);
  };

  const toggleProduct = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectPage = (checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const product of pageProducts) {
        if (checked) next.add(product.id);
        else next.delete(product.id);
      }
      return next;
    });
  };

  const selectFiltered = () => {
    const ids = new Set(filteredProducts.map((product) => product.id));
    setSelected(ids);
    setStatus(`Выбрано товаров в группе/фильтре: ${ids.size}.`);
  };

  const loadSupply = async () => {
    const queryValue = window.prompt("Введите номер приемки или вставьте ссылку на приемку из МойСклад");
    if (!queryValue?.trim()) return;
    try {
      const data = await getSupplyProducts(queryValue.trim());
      const hrefs = new Set(data.products.map((product) => product.href));
      setSupplyFilter(hrefs);
      setSupplyName(data.name || queryValue.trim());
      const ids = new Set(products.filter((product) => hrefs.has(product.href)).map((product) => product.id));
      setSelected(ids);
      setPage(1);
      clearCalculated();
      setStatus(`Приемка ${data.name || queryValue.trim()}: выбрано ${ids.size} товаров.`);
    } catch (error) {
      showToast({ tone: "error", title: "Не удалось загрузить приемку", description: getErrorText(error) });
    }
  };

  const saveTemplate = () => {
    if (!folderHref) return setStatus("Сначала выберите группу или подгруппу для шаблона.");
    if (!templateName.trim()) return setStatus("Введите название шаблона.");
    templateMutation.mutate({
      folderHref,
      template: { name: templateName.trim(), usdRate: Number(usdRate), tiers, wholesaleTiers, bank36: Number(bank36), bank912: Number(bank912), calculate36, calculate912, rounding: Number(rounding), wholesaleRounding: Number(wholesaleRounding) },
    });
  };

  const deleteTemplate = () => {
    const target = selectedTemplate || folderHref;
    if (!target) return setStatus("Выберите группу или шаблон для удаления.");
    templateMutation.mutate({ folderHref: target, template: null });
  };

  const assignTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplate);
    if (!folderHref) return setStatus("Сначала выберите группу или подгруппу.");
    if (!template) return setStatus("Выберите готовый шаблон, который нужно скопировать.");
    templateMutation.mutate({ folderHref, template: { ...template, name: template.name } });
  };

  const save = () => {
    if (!selectedChanges.length) return setStatus("Нет рассчитанных изменений для сохранения.");
    if (selectedChanges.length > 200) return setStatus("За один раз можно сохранить не более 200 товаров. Выберите меньше товаров.");
    const save36 = selectedChanges.some((change) => change.price36 !== null && change.price36 !== undefined);
    const save912 = selectedChanges.some((change) => change.price912 !== null && change.price912 !== undefined);
    if (!effectiveWholesale) return setStatus("Тип цены «Оптовая цена» не найден в МойСклад.");
    if (save36 && !effectiveType36) return setStatus("Тип цены 3-6 не найден в МойСклад.");
    if (save912 && !effectiveType912) return setStatus("Тип цены 9-12 не найден в МойСклад.");
    const priceNames = ["минимальную цену", "«Оптовая цена»"];
    if (save36) priceNames.push("«3-6»");
    if (save912) priceNames.push("«9-12»");
    if (!window.confirm(`Сохранить ${priceNames.join(", ")} для ${selectedChanges.length} товаров?`)) return;
    saveMutation.mutate({ priceType36Href: save36 ? effectiveType36 : "", priceType912Href: save912 ? effectiveType912 : "", priceTypeWholesaleHref: effectiveWholesale, changes: selectedChanges });
  };

  const changeCalculated = (productId: string, field: keyof FormulaChange, value: number) => {
    setCalculated((current) => {
      const next = new Map(current);
      const product = products.find((item) => item.id === productId);
      const existing = next.get(productId) || { productId, wholesaleCurrencyHref: product ? getWholesaleCurrencyHref(product, effectiveWholesale) : "", wholesalePrice: 0, minPrice: 0, price36: null, price912: null };
      next.set(productId, { ...existing, [field]: roundMoney(value) });
      return next;
    });
    setSelected((current) => new Set(current).add(productId));
    setSkipped((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
  };

  const addTier = (wholesaleMode = false) => {
    const setter = wholesaleMode ? setWholesaleTiers : setTiers;
    setter((current) => [...current, { from: "", to: "", amount: "", currency: "kgs" }]);
    clearCalculated();
  };

  const renderTierRows = (items: PriceTier[], wholesaleMode = false) => (
    <div className={styles.tierRows}>
      {items.map((tier, index) => (
        <div className={styles.tierRow} key={`${wholesaleMode ? "w" : "m"}-${index}`}>
          <input type="number" min="0" step="0.01" value={tier.from} placeholder="20" onChange={(event) => patchTier(index, { from: event.target.value }, wholesaleMode)} />
          <input type="number" min="0" step="0.01" value={tier.to} placeholder="40" onChange={(event) => patchTier(index, { to: event.target.value }, wholesaleMode)} />
          <input type="number" min="0" step="0.01" value={tier.amount} placeholder="1500" onChange={(event) => patchTier(index, { amount: event.target.value }, wholesaleMode)} />
          <select value={tier.currency} onChange={(event) => patchTier(index, { currency: event.target.value as TierCurrency }, wholesaleMode)}>
            <option value="kgs">сом</option>
            <option value="usd">USD</option>
          </select>
          <button type="button" onClick={() => removeTier(index, wholesaleMode)} aria-label="Удалить диапазон"><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>МойСклад / Импорт и себестоимость</p>
          <h1>Расчет цен</h1>
          <span>Шаблоны групп, наценки по диапазонам закупки и массовое сохранение цен в МойСклад.</span>
        </div>
        <button className={styles.secondaryButton} onClick={() => void loadCatalog()} disabled={loadingCatalog} type="button"><RefreshCw size={17} /> Обновить каталог</button>
      </header>

      <section className={styles.templateCard}>
        <div className={styles.field}>
          <span>Группа / подгруппа</span>
          <select value={folderHref} onChange={(event) => handleFolderChange(event.target.value)} className={styles.folderSelect}>
            <option value="">Все группы</option>
            {folders.map((folder) => (
              <option key={folder.href} value={folder.href}>
                {getFolderDisplayName(folder)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span>Шаблон из групп</span>
          <CompactSelect
            value={selectedTemplate}
            options={[{ value: "", label: "Выберите готовый шаблон" }, ...templates.map((template) => ({ value: template.id, label: `${template.name} - ${template.folderName}` }))]}
            onChange={(value) => {
              const template = templates.find((item) => item.id === value);
              setSelectedTemplate(value);
              if (template) applyTemplate(template);
            }}
          />
        </div>
        <label><span>Название шаблона</span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Например: Встройка стандарт" /></label>
        <button className={styles.primaryButton} onClick={saveTemplate} disabled={templateMutation.isPending} type="button"><Save size={16} /> Сохранить шаблон</button>
        <button className={styles.secondaryButton} onClick={assignTemplate} disabled={templateMutation.isPending} type="button"><Copy size={16} /> Скопировать</button>
        <button className={styles.dangerButton} onClick={deleteTemplate} disabled={templateMutation.isPending} type="button"><Trash2 size={16} /> Удалить</button>
      </section>

      <section className={styles.tiersGrid}>
        <article>
          <div className={styles.cardTitle}><div><p>Диапазоны</p><h2>Минимальная цена</h2><span>Наценка добавляется к закупке в сомах после перевода валюты.</span></div><button className={styles.secondaryButton} onClick={() => addTier(false)} type="button"><Plus size={16} /> Добавить диапазон</button></div>
          <div className={styles.tierHead}><span>От USD</span><span>До USD</span><span>Наценка</span><span>Валюта</span><span /></div>
          {renderTierRows(tiers)}
        </article>
        <article>
          <div className={styles.cardTitle}><div><p>Диапазоны</p><h2>Оптовая цена</h2><span>Считается отдельно по своим диапазонам и сохраняется в USD.</span></div><button className={styles.secondaryButton} onClick={() => addTier(true)} type="button"><Plus size={16} /> Добавить диапазон</button></div>
          <div className={styles.tierHead}><span>От USD</span><span>До USD</span><span>Наценка</span><span>Валюта</span><span /></div>
          {renderTierRows(wholesaleTiers, true)}
        </article>
      </section>

      <section className={styles.controls}>
        <label>
          <span>Курс USD -&gt; KGS</span>
          <input type="number" value={usdRate} onChange={(event) => { setUsdRate(Number(event.target.value)); clearCalculated(); }} />
        </label>
        <label>
          <span className={styles.checkLabel}>
            <input type="checkbox" checked={calculate36} onChange={(event) => { setCalculate36(event.target.checked); clearCalculated(); }} />
            Считать 3-6
          </span>
          <input type="number" value={bank36} onChange={(event) => { setBank36(Number(event.target.value)); clearCalculated(); }} />
        </label>
        <label>
          <span className={styles.checkLabel}>
            <input type="checkbox" checked={calculate912} onChange={(event) => { setCalculate912(event.target.checked); clearCalculated(); }} />
            Считать 9-12
          </span>
          <input type="number" value={bank912} onChange={(event) => { setBank912(Number(event.target.value)); clearCalculated(); }} />
        </label>
        <label>
          <span>Округление минимальной и банковских цен</span>
          <select value={rounding} onChange={(event) => { setRounding(Number(event.target.value)); clearCalculated(); }}>
            <option value="0">Не округлять</option>
            <option value="0.1">До 0,1 сом</option>
            <option value="0.5">До 0,5 сом</option>
            <option value="10">До 10 сом</option>
            <option value="100">До 100 сом</option>
          </select>
        </label>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.search}><Calculator size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Название, код или артикул" /></div>
        <button className={styles.secondaryButton} onClick={loadSupply} type="button"><PackageSearch size={16} /> Товары из приемки</button>
        <button className={styles.secondaryButton} onClick={selectFiltered} type="button">Выбрать фильтр</button>
        {supplyFilter ? <button className={styles.secondaryButton} onClick={() => { setSupplyFilter(null); setSupplyName(""); setPage(1); }} type="button">Сбросить приемку</button> : null}
        <button className={styles.primaryButton} onClick={() => { if (!selected.size) { setStatus("Сначала выберите товары галочками."); return; } const result = calculateProducts(selected); setStatus(result.skippedCount ? `Расчет готов: ${result.calculatedCount}. Пропущено: ${result.skippedCount}.` : `Расчет готов: ${result.calculatedCount}. Проверьте цены перед сохранением.`); }} type="button">Рассчитать</button>
        <button className={styles.primaryButton} onClick={save} disabled={!selectedChanges.length || saveMutation.isPending} type="button"><Save size={16} /> Сохранить цены</button>
      </section>

      <section className={styles.summary}>
        <article><span>Загружено</span><strong>{loadingCatalog && !products.length ? "..." : formatNumber(products.length)}</strong></article>
        <article><span>Всего в МойСклад</span><strong>{formatNumber(total || products.length)}</strong></article>
        <article><span>В фильтре</span><strong>{formatNumber(filteredProducts.length)}</strong></article>
        <article><span>Выбрано</span><strong>{formatNumber(selected.size)}</strong></article>
        <article><span>Изменено</span><strong>{formatNumber(selectedChanges.length)}</strong></article>
        <article><span>Пропущено</span><strong>{formatNumber([...selected].filter((id) => skipped.has(id)).length)}</strong></article>
      </section>

      <section className={styles.table}>
        <div className={styles.tableTitle}>
          <div><h2>Товары</h2><p>{supplyFilter ? `Приемка ${supplyName}. ` : ""}{status}</p></div>
        </div>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={pageProducts.length > 0 && pageProducts.every((product) => selected.has(product.id))} onChange={(event) => selectPage(event.target.checked)} /></th>
                <th>Код</th>
                <th>Наименование</th>
                <th>Шаблон группы</th>
                <th>Закупка</th>
                <th>Опт. сейчас</th>
                <th>Опт. новая USD</th>
                <th>Мин. сейчас</th>
                <th>Мин. новая</th>
                <th>3-6 сейчас</th>
                <th>3-6 новая</th>
                <th>9-12 сейчас</th>
                <th>9-12 новая</th>
              </tr>
            </thead>
            <tbody>
              {pageProducts.map((product) => {
                const next = calculated.get(product.id);
                const reason = skipped.get(product.id);
                const currentTemplateId = productTemplates.get(product.id) || (product.folder?.template ? product.folder.href : "");
                const applicableTemplates = templates.filter((template) => template.folderHref === product.folder?.href);
                return (
                  <tr key={product.id} className={cx(next && styles.changed, reason && styles.skipped, product.archived && styles.archived)}>
                    <td><input type="checkbox" checked={selected.has(product.id)} onChange={(event) => toggleProduct(product.id, event.target.checked)} /></td>
                    <td>{product.code || "-"}</td>
                    <td><strong>{product.name}</strong>{product.article ? <small>Арт: {product.article}</small> : null}{product.archived ? <small>Архив</small> : null}{reason ? <small>{reason}</small> : null}</td>
                    <td>
                      <select className={styles.rowSelect} value={currentTemplateId} disabled={!applicableTemplates.length} onChange={(event) => applyTemplateToProductFolder(product, event.target.value)}>
                        <option value="">{product.folder?.template ? "Шаблон подгруппы" : "Выберите шаблон"}</option>
                        {applicableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} - {template.folderName}</option>)}
                      </select>
                    </td>
                    <td>{product.buyPrice?.value ? `${formatNumber(product.buyPrice.value)} ${product.buyPrice.currencyIsoCode || product.buyPrice.currencyName || ""}` : "нет закупки"}</td>
                    <td>{formatWholesale(product, effectiveWholesale)}</td>
                    <td>{next ? <><input value={next.wholesalePrice} type="number" onChange={(event) => changeCalculated(product.id, "wholesalePrice", Number(event.target.value))} /><span className={styles.priceCurrency}>USD</span></> : <span className={styles.muted}>не рассчитано</span>}</td>
                    <td>{formatMoney(product.minPrice?.value || 0, "сом")}</td>
                    <td>{next ? <input value={next.minPrice} type="number" onChange={(event) => changeCalculated(product.id, "minPrice", Number(event.target.value))} /> : <span className={styles.muted}>не рассчитано</span>}</td>
                    <td>{formatMoney(getPrice(product, effectiveType36), "сом")}</td>
                    <td>{next?.price36 !== null && next?.price36 !== undefined ? <input value={next.price36} type="number" onChange={(event) => changeCalculated(product.id, "price36", Number(event.target.value))} /> : <span className={styles.muted}>не считать</span>}</td>
                    <td>{formatMoney(getPrice(product, effectiveType912), "сом")}</td>
                    <td>{next?.price912 !== null && next?.price912 !== undefined ? <input value={next.price912} type="number" onChange={(event) => changeCalculated(product.id, "price912", Number(event.target.value))} /> : <span className={styles.muted}>не считать</span>}</td>
                  </tr>
                );
              })}
              {!pageProducts.length ? <tr><td colSpan={13}>{loadingCatalog ? "Загрузка..." : "Товары не найдены."}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className={styles.pagination}>
          <button className={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Назад</button>
          <span>Страница {activePage} из {pageCount}</span>
          <button className={styles.secondaryButton} disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Вперед</button>
        </footer>
      </section>
    </section>
  );
}

function mergeFolders(current: ProductFolder[], incoming: ProductFolder[]) {
  const folders = new Map(current.map((folder) => [folder.href, folder]));
  for (const folder of incoming) folders.set(folder.href, pickBetterFolder(folders.get(folder.href), folder));
  return [...folders.values()];
}

function CompactSelect({ value, options, onChange }: { value: string; options: SelectOption[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value) || options[0];
  const visibleOptions = useMemo(() => {
    const normalized = normalizeSearch(query);
    return normalized ? options.filter((option) => normalizeSearch(option.label).includes(normalized)) : options;
  }, [options, query]);

  return (
    <div className={styles.compactSelect} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button type="button" className={styles.compactSelectButton} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label || "Выберите"}</span>
        <b>⌄</b>
      </button>
      {open ? (
        <div className={styles.compactSelectMenu}>
          <input
            className={styles.compactSelectSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск группы"
          />
          {visibleOptions.map((option) => (
            <div
              key={option.value || "__all__"}
              role="option"
              aria-selected={option.value === value}
              tabIndex={0}
              className={cx(option.value === value && styles.compactSelectActive)}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(option.value);
                setOpen(false);
                setQuery("");
              }}
            >
              <b>{option.value === value ? "✓" : ""}</b>
              <span>{option.label}</span>
            </div>
          ))}
          {!visibleOptions.length ? <div className={styles.compactSelectEmpty}>Ничего не найдено</div> : null}
        </div>
      ) : null}
    </div>
  );
}
