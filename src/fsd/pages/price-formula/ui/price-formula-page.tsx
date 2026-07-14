"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Copy, PackageSearch, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  getAccountingPriceCatalog,
  getSupplyProducts,
  saveFolderTemplate,
  saveFormulaPrices,
  type FormulaChange,
  type PriceFormulaTemplate,
  type PriceProduct,
  type PriceTier,
  type PriceType,
  type ProductFolder,
  type TierCurrency,
} from "../api/price-formula-api";
import styles from "./price-formula-page.module.css";

const PAGE_SIZE = 100;
const SETTINGS_KEY = "ordoPriceFormulaPageV2React";
const defaultTiers: PriceTier[] = [
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

const formatNumber = (value: number) => new Intl.NumberFormat("ru-RU").format(value || 0);
const formatSom = (value: number) => `${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)} сом`;
const formatUsd = (value: number) => `$${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0)}`;
const roundMoney = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const roundBy = (value: number, rounding: number) => {
  const step = Number(rounding || 0);
  return step > 0 ? roundMoney(Math.round(value / step) * step) : roundMoney(value);
};
const normalizeSearch = (value: string) => value.trim().toLocaleLowerCase("ru-RU");
const getFolderName = (folder?: ProductFolder | null) => (folder ? [folder.pathName, folder.name].filter(Boolean).join(" / ") || folder.name : "Без группы");
const getPriceRecord = (product: PriceProduct, priceTypeHref: string) => product.prices.find((price) => price.priceTypeHref === priceTypeHref) || null;
const getPrice = (product: PriceProduct, priceTypeHref: string) => roundMoney(Number(getPriceRecord(product, priceTypeHref)?.value || 0));
const parseOptionalNumber = (value: string | number, fallback: number) => (String(value ?? "").trim() === "" ? fallback : Number(value));
const currencyOf = (money?: { currencyIsoCode?: string; currencyName?: string }) => {
  const currency = normalizeSearch(`${money?.currencyIsoCode || ""} ${money?.currencyName || ""}`);
  if (currency.includes("usd") || currency.includes("доллар")) return "usd";
  if (currency.includes("kgs") || currency.includes("сом")) return "kgs";
  return "unknown";
};
const findPriceType = (types: PriceType[], keys: string[]) => types.find((type) => keys.some((key) => normalizeSearch(type.name).includes(key)))?.href || "";
const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

function readSettings() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") as Partial<PriceFormulaTemplate> | null;
  } catch {
    return null;
  }
}

function normalizeTiers(tiers?: PriceTier[]) {
  return tiers?.length ? tiers : defaultTiers;
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

function getAllowedFolderHrefs(folderHref: string, folders: ProductFolder[]) {
  if (!folderHref) return new Set<string>();
  const folder = folders.find((item) => item.href === folderHref);
  if (!folder) return new Set([folderHref]);
  const base = getFolderName(folder);
  return new Set(folders.filter((item) => item.href === folderHref || getFolderName(item).startsWith(`${base} / `)).map((item) => item.href));
}

function getWholesaleCurrencyHref(product: PriceProduct, wholesaleHref: string) {
  const wholesalePrice = getPriceRecord(product, wholesaleHref);
  const wholesaleCurrency = currencyOf(wholesalePrice || undefined);
  if (wholesaleCurrency === "usd") return wholesalePrice?.currencyHref || "";
  return currencyOf(product.buyPrice) === "usd" ? product.buyPrice?.currencyHref || "" : "";
}

function calculateProduct(product: PriceProduct, settings: FormulaSettings, wholesaleHref: string): FormulaChange | { error: string } {
  const buyPrice = Number(product.buyPrice?.value || 0);
  if (buyPrice <= 0) return { error: "Нет закупочной цены" };
  const buyCurrency = currencyOf(product.buyPrice);
  if (buyCurrency === "unknown") return { error: "Валюта закупки не USD и не KGS" };

  const buyUsd = buyCurrency === "kgs" ? buyPrice / settings.rate : buyPrice;
  const baseKgs = buyCurrency === "kgs" ? buyPrice : buyPrice * settings.rate;
  const minTier = settings.tiers.find((tier) => buyUsd >= tier.from && buyUsd < tier.to);
  if (!minTier) return { error: "Закупочная цена вне диапазонов минимальной цены" };
  const wholesaleTier = settings.wholesaleTiers.find((tier) => buyUsd >= tier.from && buyUsd < tier.to);
  if (!wholesaleTier) return { error: "Закупочная цена вне диапазонов оптовой цены" };

  const minMarkup = minTier.currency === "usd" ? minTier.amount * settings.rate : minTier.amount;
  const wholesaleMarkupUsd = wholesaleTier.currency === "usd" ? wholesaleTier.amount : wholesaleTier.amount / settings.rate;
  const minPrice = roundBy(baseKgs + minMarkup, settings.rounding);
  const wholesalePrice = roundBy(buyUsd + wholesaleMarkupUsd, settings.wholesaleRounding);

  return {
    productId: product.id,
    wholesaleCurrencyHref: getWholesaleCurrencyHref(product, wholesaleHref),
    wholesalePrice: Math.max(0, roundMoney(wholesalePrice)),
    minPrice: Math.max(0, roundMoney(minPrice)),
    price36: settings.calculate36 ? Math.max(0, roundMoney(roundBy(minPrice * (1 + settings.bank36 / 100), settings.rounding))) : null,
    price912: settings.calculate912 ? Math.max(0, roundMoney(roundBy(minPrice * (1 + settings.bank912 / 100), settings.rounding))) : null,
  };
}

export function PriceFormulaPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const saved = readSettings();
  const [search, setSearch] = useState("");
  const [folderHref, setFolderHref] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [calculated, setCalculated] = useState<Map<string, FormulaChange>>(new Map());
  const [skipped, setSkipped] = useState<Map<string, string>>(new Map());
  const [page, setPage] = useState(1);
  const [supplyFilter, setSupplyFilter] = useState<Set<string> | null>(null);
  const [supplyName, setSupplyName] = useState("");
  const [status, setStatus] = useState("Загрузка каталога...");
  const [type36, setType36] = useState("");
  const [type912, setType912] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [usdRate, setUsdRate] = useState(saved?.usdRate ?? 89);
  const [bank36, setBank36] = useState(saved?.bank36 ?? 10);
  const [bank912, setBank912] = useState(saved?.bank912 ?? 20);
  const [calculate36, setCalculate36] = useState(saved?.calculate36 ?? true);
  const [calculate912, setCalculate912] = useState(saved?.calculate912 ?? true);
  const [rounding, setRounding] = useState(saved?.rounding ?? 10);
  const [wholesaleRounding, setWholesaleRounding] = useState(saved?.wholesaleRounding ?? 0.1);
  const [tiers, setTiers] = useState<PriceTier[]>(normalizeTiers(saved?.tiers as PriceTier[] | undefined));
  const [wholesaleTiers, setWholesaleTiers] = useState<PriceTier[]>(normalizeTiers((saved?.wholesaleTiers as PriceTier[] | undefined) || (saved?.tiers as PriceTier[] | undefined)));

  const catalogQuery = useQuery({ queryKey: ["price-formula-catalog"], queryFn: getAccountingPriceCatalog });

  const products = useMemo(() => catalogQuery.data?.products ?? [], [catalogQuery.data?.products]);
  const types = useMemo(() => catalogQuery.data?.priceTypes ?? [], [catalogQuery.data?.priceTypes]);
  const folders = useMemo(() => {
    const byHref = new Map<string, ProductFolder>();
    for (const folder of catalogQuery.data?.folders ?? []) byHref.set(folder.href, folder);
    for (const product of products) if (product.folder?.href) byHref.set(product.folder.href, product.folder);
    return [...byHref.values()].sort((left, right) => getFolderName(left).localeCompare(getFolderName(right), "ru"));
  }, [catalogQuery.data?.folders, products]);

  const templates = useMemo<TemplateOption[]>(() => folders.filter((folder) => folder.template).map((folder) => ({ ...folder.template!, id: folder.href, folderHref: folder.href, folderName: getFolderName(folder) })), [folders]);

  const effectiveType36 = type36 || findPriceType(types, ["3-6", "3 6", "3-6м", "3 6м"]);
  const effectiveType912 = type912 || findPriceType(types, ["9-12", "9 12", "9-12м", "9 12м"]);
  const effectiveWholesale = wholesale || findPriceType(types, ["оптов", "wholesale"]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ usdRate, tiers, wholesaleTiers, bank36, bank912, calculate36, calculate912, rounding, wholesaleRounding }));
  }, [bank36, bank912, calculate36, calculate912, rounding, tiers, usdRate, wholesaleRounding, wholesaleTiers]);

  const filteredProducts = useMemo(() => {
    const q = normalizeSearch(search);
    const allowedFolders = getAllowedFolderHrefs(folderHref, folders);
    return products.filter((product) => {
      if (supplyFilter && !supplyFilter.has(product.href)) return false;
      if (!supplyFilter && product.archived) return false;
      if (folderHref && !allowedFolders.has(product.folder?.href || "")) return false;
      if (!q) return true;
      return normalizeSearch([product.name, product.code, product.article].join(" ")).includes(q);
    });
  }, [folderHref, folders, products, search, supplyFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const pageProducts = filteredProducts.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE);
  const selectedChanges = [...selected].map((id) => calculated.get(id)).filter((change): change is FormulaChange => Boolean(change));
  const settings: FormulaSettings = { rate: Number(usdRate), tiers: parseTiers(tiers), wholesaleTiers: parseTiers(wholesaleTiers), bank36: Number(bank36), bank912: Number(bank912), calculate36, calculate912, rounding: Number(rounding), wholesaleRounding: Number(wholesaleRounding) };

  const templateMutation = useMutation({
    mutationFn: saveFolderTemplate,
    onSuccess: async (folder) => {
      showToast({ tone: "success", title: folder.template ? "Шаблон сохранен" : "Шаблон удален" });
      await queryClient.invalidateQueries({ queryKey: ["price-formula-catalog"] });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить шаблон", description: getErrorText(error) }),
  });

  const saveMutation = useMutation({
    mutationFn: saveFormulaPrices,
    onSuccess: async (result) => {
      const failed = (result.results ?? []).filter((item) => !item.ok);
      showToast({ tone: failed.length ? "error" : "success", title: failed.length ? `Обновлено: ${result.updated || 0}, ошибок: ${result.failed || 0}` : `Сохранено: ${result.updated || 0}` });
      setCalculated(new Map());
      setSkipped(new Map());
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["price-formula-catalog"] });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить цены", description: getErrorText(error) }),
  });

  const patchTier = (index: number, patch: Partial<PriceTier>, wholesaleMode = false) => {
    const setter = wholesaleMode ? setWholesaleTiers : setTiers;
    setter((current) => current.map((tier, itemIndex) => (itemIndex === index ? { ...tier, ...patch } : tier)));
    setCalculated(new Map());
    setSkipped(new Map());
  };

  const removeTier = (index: number, wholesaleMode = false) => {
    const setter = wholesaleMode ? setWholesaleTiers : setTiers;
    setter((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const validateSettings = () => {
    if (!Number.isFinite(settings.rate) || settings.rate <= 0) return "Введите корректный курс доллара.";
    if (!settings.tiers.length) return "Добавьте хотя бы один корректный диапазон минимальной цены.";
    if (!settings.wholesaleTiers.length) return "Добавьте хотя бы один корректный диапазон оптовой цены.";
    if (calculate36 && (!Number.isFinite(settings.bank36) || settings.bank36 < 0)) return "Введите корректный процент банка 3-6.";
    if (calculate912 && (!Number.isFinite(settings.bank912) || settings.bank912 < 0)) return "Введите корректный процент банка 9-12.";
    return "";
  };

  const calculateSelected = (ids = selected, customStatus?: (done: number, skippedCount: number) => string) => {
    if (!ids.size) return setStatus("Сначала выберите товары галочками.");
    const validation = validateSettings();
    if (validation) return setStatus(validation);
    const nextCalculated = new Map(calculated);
    const nextSkipped = new Map<string, string>();
    let done = 0;
    let fail = 0;
    for (const product of products.filter((item) => ids.has(item.id))) {
      const result = calculateProduct(product, settings, effectiveWholesale);
      if ("error" in result) {
        nextCalculated.delete(product.id);
        nextSkipped.set(product.id, result.error);
        fail += 1;
      } else {
        nextCalculated.set(product.id, result);
        done += 1;
      }
    }
    setCalculated(nextCalculated);
    setSkipped(nextSkipped);
    setStatus(customStatus ? customStatus(done, fail) : fail ? `Расчет готов: ${done}. Пропущено: ${fail}.` : `Расчет готов: ${done}. Проверьте цены перед сохранением.`);
  };

  const applyTemplate = (template: PriceFormulaTemplate) => {
    setTemplateName(template.name || "");
    setUsdRate(template.usdRate ?? 89);
    setTiers(normalizeTiers(template.tiers));
    setWholesaleTiers(normalizeTiers(template.wholesaleTiers || template.tiers));
    setBank36(template.bank36 ?? 10);
    setBank912(template.bank912 ?? 20);
    setCalculate36(template.calculate36 !== false);
    setCalculate912(template.calculate912 !== false);
    setRounding(template.rounding ?? 10);
    setWholesaleRounding(template.wholesaleRounding ?? 0.1);
    setCalculated(new Map());
    setSkipped(new Map());
  };

  const handleFolderChange = (value: string) => {
    setFolderHref(value);
    setPage(1);
    setSelected(new Set());
    setCalculated(new Map());
    setSkipped(new Map());
    const folder = folders.find((item) => item.href === value);
    if (folder?.template) {
      applyTemplate(folder.template);
      setSelectedTemplate(value);
      const allowed = getAllowedFolderHrefs(value, folders);
      const ids = new Set(products.filter((item) => allowed.has(item.folder?.href || "")).map((item) => item.id));
      setSelected(ids);
      setTimeout(() => calculateSelected(ids, (done, fail) => fail ? `Применен шаблон «${folder.template?.name}». Рассчитано: ${done}. Пропущено: ${fail}.` : `Применен шаблон «${folder.template?.name}». Рассчитано товаров: ${done}.`), 0);
    }
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
      setStatus(`Приемка ${data.name || queryValue.trim()}: выбрано ${ids.size} товаров.`);
    } catch (error) {
      showToast({ tone: "error", title: "Не удалось загрузить приемку", description: getErrorText(error) });
    }
  };

  const saveTemplate = () => {
    if (!folderHref) return setStatus("Сначала выберите группу или подгруппу для шаблона.");
    if (!templateName.trim()) return setStatus("Введите название шаблона.");
    templateMutation.mutate({ folderHref, template: { name: templateName.trim(), usdRate: Number(usdRate), tiers, wholesaleTiers, bank36: Number(bank36), bank912: Number(bank912), calculate36, calculate912, rounding: Number(rounding), wholesaleRounding: Number(wholesaleRounding) } });
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
    if (!selectedChanges.length) return;
    if (selectedChanges.length > 200) return setStatus("За один раз можно сохранить не более 200 товаров. Выберите меньше товаров.");
    const save36 = selectedChanges.some((change) => change.price36 !== null);
    const save912 = selectedChanges.some((change) => change.price912 !== null);
    if (!effectiveWholesale) return setStatus("Тип цены «Оптовая цена» не найден в МойСклад.");
    if (save36 && !effectiveType36) return setStatus("Тип цены 3-6 не найден в МойСклад.");
    if (save912 && !effectiveType912) return setStatus("Тип цены 9-12 не найден в МойСклад.");
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
  };

  const renderTierRows = (items: PriceTier[], wholesaleMode = false) => (
    <div className={styles.tierRows}>
      {items.map((tier, index) => (
        <div className={styles.tierRow} key={`${wholesaleMode ? "w" : "m"}-${index}`}>
          <input type="number" value={tier.from} placeholder="20" onChange={(event) => patchTier(index, { from: event.target.value }, wholesaleMode)} />
          <input type="number" value={tier.to} placeholder="40" onChange={(event) => patchTier(index, { to: event.target.value }, wholesaleMode)} />
          <input type="number" value={tier.amount} placeholder="1500" onChange={(event) => patchTier(index, { amount: event.target.value }, wholesaleMode)} />
          <select value={tier.currency} onChange={(event) => patchTier(index, { currency: event.target.value as TierCurrency }, wholesaleMode)}>
            <option value="kgs">сом</option>
            <option value="usd">USD</option>
          </select>
          <button type="button" onClick={() => removeTier(index, wholesaleMode)}><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Импорт и прайс-лист</p>
          <h1>Расчет цен</h1>
          <span>Группы, шаблоны, закупка в USD, оптовая цена и массовое сохранение в МойСклад.</span>
        </div>
        <button className={styles.secondaryButton} onClick={() => catalogQuery.refetch()} type="button"><RefreshCw size={17} /> Обновить каталог</button>
      </header>

      <section className={styles.templateCard}>
        <label><span>Группа / подгруппа</span><select value={folderHref} onChange={(event) => handleFolderChange(event.target.value)}><option value="">Все группы</option>{folders.map((folder) => <option key={folder.href} value={folder.href}>{getFolderName(folder)}</option>)}</select></label>
        <label><span>Шаблон из групп</span><select value={selectedTemplate} onChange={(event) => { const template = templates.find((item) => item.id === event.target.value); setSelectedTemplate(event.target.value); if (template) applyTemplate(template); }}><option value="">Выберите шаблон</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} - {template.folderName}</option>)}</select></label>
        <label><span>Название шаблона</span><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Например: Встройка стандарт" /></label>
        <button className={styles.primaryButton} onClick={saveTemplate} type="button"><Save size={16} /> Сохранить группу</button>
        <button className={styles.secondaryButton} onClick={assignTemplate} type="button"><Copy size={16} /> Скопировать</button>
        <button className={styles.dangerButton} onClick={deleteTemplate} type="button"><Trash2 size={16} /> Удалить</button>
      </section>

      <section className={styles.tiersGrid}>
        <article>
          <div className={styles.cardTitle}><div><p>Правила группы</p><h2>Минимальная цена</h2><span>К закупке в сомах добавляется наценка из выбранного диапазона.</span></div><button className={styles.secondaryButton} onClick={() => setTiers((value) => [...value, { from: "", to: "", amount: "", currency: "kgs" }])} type="button"><Plus size={16} /> Добавить диапазон</button></div>
          <div className={styles.tierHead}><span>От USD</span><span>До USD</span><span>Наценка</span><span>Валюта</span><span /></div>
          {renderTierRows(tiers)}
        </article>
        <article>
          <div className={styles.cardTitle}><div><p>Направление на закупочную цену</p><h2>Оптовая цена</h2><span>Оптовая цена считается отдельно по своим диапазонам и сохраняется в USD.</span></div><button className={styles.secondaryButton} onClick={() => setWholesaleTiers((value) => [...value, { from: "", to: "", amount: "", currency: "kgs" }])} type="button"><Plus size={16} /> Добавить диапазон</button></div>
          <div className={styles.tierHead}><span>От USD</span><span>До USD</span><span>Наценка</span><span>Валюта</span><span /></div>
          {renderTierRows(wholesaleTiers, true)}
        </article>
      </section>

      <section className={styles.controls}>
        <label><span>Тип 3-6</span><select value={effectiveType36} onChange={(event) => setType36(event.target.value)}><option value="">Не выбран</option>{types.map((type) => <option key={type.href} value={type.href}>{type.name}</option>)}</select></label>
        <label><span>Тип 9-12</span><select value={effectiveType912} onChange={(event) => setType912(event.target.value)}><option value="">Не выбран</option>{types.map((type) => <option key={type.href} value={type.href}>{type.name}</option>)}</select></label>
        <label><span>Оптовая</span><select value={effectiveWholesale} onChange={(event) => setWholesale(event.target.value)}><option value="">Не выбран</option>{types.map((type) => <option key={type.href} value={type.href}>{type.name}</option>)}</select></label>
        <label><span>Курс USD {"->"} KGS</span><input type="number" value={usdRate} onChange={(event) => setUsdRate(Number(event.target.value))} /></label>
        <label><span><input type="checkbox" checked={calculate36} onChange={(event) => setCalculate36(event.target.checked)} /> Считать 3-6 %</span><input type="number" value={bank36} onChange={(event) => setBank36(Number(event.target.value))} /></label>
        <label><span><input type="checkbox" checked={calculate912} onChange={(event) => setCalculate912(event.target.checked)} /> Считать 9-12 %</span><input type="number" value={bank912} onChange={(event) => setBank912(Number(event.target.value))} /></label>
        <label><span>Округление сом</span><select value={rounding} onChange={(event) => setRounding(Number(event.target.value))}><option value="0">Не округлять</option><option value="0.1">0,1</option><option value="0.5">0,5</option><option value="10">10</option><option value="100">100</option></select></label>
        <label><span>Округление опт. USD</span><select value={wholesaleRounding} onChange={(event) => setWholesaleRounding(Number(event.target.value))}><option value="0">Не округлять</option><option value="0.1">0,1 USD</option><option value="0.5">0,5 USD</option><option value="1">1 USD</option></select></label>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.search}><Calculator size={18} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Название, код или артикул" /></div>
        <button className={styles.secondaryButton} onClick={loadSupply} type="button"><PackageSearch size={16} /> Товары из приемки</button>
        <button className={styles.secondaryButton} onClick={selectFiltered} type="button">Выбрать фильтр</button>
        <button className={styles.primaryButton} onClick={() => calculateSelected()} type="button">Рассчитать</button>
        <button className={styles.primaryButton} onClick={save} disabled={!selectedChanges.length || saveMutation.isPending} type="button"><Save size={16} /> Сохранить цены</button>
      </section>

      <section className={styles.summary}>
        <article><span>Товаров загружено</span><strong>{catalogQuery.isLoading ? "..." : formatNumber(products.length)}</strong></article>
        <article><span>В группе / фильтре</span><strong>{formatNumber(filteredProducts.length)}</strong></article>
        <article><span>Выбрано</span><strong>{formatNumber(selected.size)}</strong></article>
        <article><span>Рассчитано</span><strong>{formatNumber(selectedChanges.length)}</strong></article>
        <article><span>Пропущено</span><strong>{formatNumber([...selected].filter((id) => skipped.has(id)).length)}</strong></article>
      </section>

      <section className={styles.table}>
        <div className={styles.tableTitle}><div><h2>Товары</h2><p>{supplyFilter ? `Приемка ${supplyName}. ` : ""}{catalogQuery.isError ? getErrorText(catalogQuery.error) : status || (catalogQuery.data ? `Каталог загружен: ${products.length} товаров.` : "Загрузка каталога...")}</p></div></div>
        <table>
          <thead><tr><th><input type="checkbox" checked={pageProducts.length > 0 && pageProducts.every((product) => selected.has(product.id))} onChange={(event) => selectPage(event.target.checked)} /></th><th>Код</th><th>Товар</th><th>Группа</th><th>Закупка</th><th>Опт. сейчас</th><th>Опт. новая</th><th>Мин. сейчас</th><th>Мин. новая</th><th>3-6</th><th>9-12</th></tr></thead>
          <tbody>
            {pageProducts.map((product) => {
              const next = calculated.get(product.id);
              const reason = skipped.get(product.id);
              return (
                <tr key={product.id} className={cx(reason && styles.skipped, next && styles.changed)}>
                  <td><input type="checkbox" checked={selected.has(product.id)} onChange={(event) => toggleProduct(product.id, event.target.checked)} /></td>
                  <td>{product.code || "-"}</td>
                  <td><strong>{product.name}</strong>{product.archived ? <small>Архив</small> : null}{reason ? <small>{reason}</small> : null}</td>
                  <td>{getFolderName(product.folder)}</td>
                  <td>{product.buyPrice?.value ? `${formatNumber(product.buyPrice.value)} ${product.buyPrice.currencyIsoCode || product.buyPrice.currencyName || ""}` : "нет закупки"}</td>
                  <td>{formatUsd(getPrice(product, effectiveWholesale))}</td>
                  <td>{next ? <input value={next.wholesalePrice} type="number" onChange={(event) => changeCalculated(product.id, "wholesalePrice", Number(event.target.value))} /> : "не рассчитано"}</td>
                  <td>{formatSom(product.minPrice?.value || 0)}</td>
                  <td>{next ? <input value={next.minPrice} type="number" onChange={(event) => changeCalculated(product.id, "minPrice", Number(event.target.value))} /> : "не рассчитано"}</td>
                  <td>{next?.price36 !== null && next?.price36 !== undefined ? <input value={next.price36} type="number" onChange={(event) => changeCalculated(product.id, "price36", Number(event.target.value))} /> : "не считать"}</td>
                  <td>{next?.price912 !== null && next?.price912 !== undefined ? <input value={next.price912} type="number" onChange={(event) => changeCalculated(product.id, "price912", Number(event.target.value))} /> : "не считать"}</td>
                </tr>
              );
            })}
            {!pageProducts.length ? <tr><td colSpan={11}>{catalogQuery.isLoading ? "Загрузка..." : "Товары не найдены."}</td></tr> : null}
          </tbody>
        </table>
        <footer className={styles.pagination}>
          <button className={styles.secondaryButton} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">Назад</button>
          <span>Страница {Math.min(page, pageCount)} из {pageCount}</span>
          <button className={styles.secondaryButton} disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">Вперед</button>
        </footer>
      </section>
    </section>
  );
}
