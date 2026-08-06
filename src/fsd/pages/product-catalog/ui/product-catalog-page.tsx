"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileDown,
  Images,
  LoaderCircle,
  PackageSearch,
  Search,
  Trash2,
} from "lucide-react";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { createProductCatalog, searchCatalogProducts } from "../api/product-catalog-api";
import {
  moveCatalogProduct,
  PRODUCT_CATALOG_MAX_PRODUCTS,
  type CatalogProduct,
  type ProductCatalogFile,
} from "../model/product-catalog-model";
import styles from "./product-catalog-page.module.css";

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value || 0);
}

function formatCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (currency === "KGS" || currency === "KGZ" || currency.includes("СОМ")) return "сом";
  if (currency === "USD" || currency.includes("ДОЛЛАР")) return "USD";
  return value || "сом";
}

function getCatalogPrice(product: CatalogProduct, priceTypeName: string) {
  const normalizedName = priceTypeName.trim().toLocaleLowerCase("ru-RU");
  const selected = normalizedName
    ? product.prices.find((price) => price.name.trim().toLocaleLowerCase("ru-RU") === normalizedName)
    : null;
  return selected || { name: "Цена по умолчанию", value: product.price, currency: "KGS" };
}

function openCatalogFile(file: ProductCatalogFile) {
  const objectUrl = URL.createObjectURL(file.blob);
  if (file.contentType.includes("application/pdf")) {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = file.fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  const frame = document.createElement("iframe");
  frame.title = "Печатный PDF-каталог";
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.onload = () => {
    window.setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }, 350);
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  };
  frame.src = objectUrl;
  document.body.append(frame);
}

export function ProductCatalogPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<CatalogProduct[]>([]);
  const [title, setTitle] = useState("Каталог техники");
  const [subtitle, setSubtitle] = useState("Техника для дома с актуальными фотографиями и ценами");
  const [showPrices, setShowPrices] = useState(true);
  const [priceTypeName, setPriceTypeName] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 450);
    return () => window.clearTimeout(timer);
  }, [search]);

  const productsQuery = useQuery({
    queryKey: ["product-catalog-search", debouncedSearch],
    queryFn: ({ signal }) => searchCatalogProducts(debouncedSearch, signal),
    enabled: debouncedSearch.length >= 2,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!productsQuery.error) return;
    showToast({
      tone: "error",
      title: "Поиск товаров недоступен",
      description: getErrorText(productsQuery.error),
    });
  }, [productsQuery.error, showToast]);

  const selectedHrefs = useMemo(() => new Set(selectedProducts.map((product) => product.href)), [selectedProducts]);
  const availablePriceTypes = useMemo(() => {
    const options = new Map<string, string>();
    for (const product of selectedProducts) {
      for (const price of product.prices) {
        const key = price.name.trim().toLocaleLowerCase("ru-RU");
        if (key && !options.has(key)) options.set(key, price.name);
      }
    }
    return [...options.values()];
  }, [selectedProducts]);
  const searchResults = productsQuery.data ?? [];

  const catalogMutation = useMutation({
    mutationFn: createProductCatalog,
    onSuccess: (file) => {
      openCatalogFile(file);
      showToast({
        tone: "success",
        title: file.contentType.includes("application/pdf") ? "PDF-каталог готов" : "Печатный каталог готов",
        description: file.contentType.includes("application/pdf")
          ? `${selectedProducts.length} товаров · файл загружен`
          : "Открылось окно печати. Выберите «Сохранить как PDF».",
      });
    },
    onError: (error) => showToast({
      tone: "error",
      title: "Каталог не создан",
      description: getErrorText(error),
    }),
  });

  const addProduct = (product: CatalogProduct) => {
    if (selectedHrefs.has(product.href)) return;
    if (selectedProducts.length >= PRODUCT_CATALOG_MAX_PRODUCTS) {
      showToast({ tone: "error", title: `Не более ${PRODUCT_CATALOG_MAX_PRODUCTS} товаров`, description: "Создайте несколько каталогов, если подборка больше." });
      return;
    }
    setSelectedProducts((current) => [...current, product]);
    setSearch("");
    setDebouncedSearch("");
  };

  const createCatalog = () => {
    if (!selectedProducts.length) {
      showToast({ tone: "error", title: "Добавьте хотя бы один товар" });
      return;
    }
    catalogMutation.mutate({
      title: title.trim() || "Каталог техники",
      subtitle: subtitle.trim(),
      showPrices,
      priceTypeName,
      items: selectedProducts,
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <span>Инструменты · PDF</span>
          <h1>Каталог товаров</h1>
          <p>Выберите товары — система загрузит все фотографии из МойСклад и соберёт фирменный красно-белый каталог A4.</p>
        </div>
        <div className={styles.brandPreview} aria-label="Логотипы каталога">
          <Image src="/belek-tehnika-logo.svg" alt="Белек Техника" width={260} height={96} priority />
          <i aria-hidden="true" />
          <Image src="/gifton-logo.svg" alt="GiftON" width={210} height={80} priority />
        </div>
      </header>

      <div className={styles.layout}>
        <main className={styles.builder}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span>Шаг 1</span>
                <h2>Оформление каталога</h2>
              </div>
              <div className={styles.palette}><b /><b /><small>Красный · белый</small></div>
            </div>
            <div className={styles.formGrid}>
              <label>
                <span>Название на обложке</span>
                <input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="Каталог техники" />
              </label>
              <label>
                <span>Подзаголовок</span>
                <input value={subtitle} maxLength={240} onChange={(event) => setSubtitle(event.target.value)} placeholder="Короткое описание подборки" />
              </label>
              <label>
                <span>Вид цены в каталоге</span>
                <select value={priceTypeName} onChange={(event) => setPriceTypeName(event.target.value)}>
                  <option value="">Цена по умолчанию</option>
                  {availablePriceTypes.map((priceName) => <option key={priceName} value={priceName}>{priceName}</option>)}
                </select>
              </label>
            </div>
            <label className={styles.switchRow}>
              <input type="checkbox" checked={showPrices} onChange={(event) => setShowPrices(event.target.checked)} />
              <span><strong>Показывать цены</strong><small>Берётся актуальная цена продажи из карточки товара МойСклад.</small></span>
            </label>
          </section>

          <section className={`${styles.card} ${styles.searchCard}`}>
            <div className={styles.cardHeader}>
              <div>
                <span>Шаг 2</span>
                <h2>Добавьте товары</h2>
              </div>
              <strong className={styles.count}>{selectedProducts.length} / {PRODUCT_CATALOG_MAX_PRODUCTS}</strong>
            </div>

            <div className={styles.searchBox}>
              <Search size={22} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Название, код, артикул или штрихкод"
                autoComplete="off"
              />
              {productsQuery.isFetching ? <LoaderCircle className={styles.spin} size={21} /> : null}
            </div>

            {debouncedSearch.length >= 2 ? (
              <div className={styles.searchResults}>
                {productsQuery.isLoading ? (
                  <div className={styles.resultState}><LoaderCircle className={styles.spin} /> Загружаю товары…</div>
                ) : searchResults.length ? searchResults.map((product) => {
                  const added = selectedHrefs.has(product.href);
                  return (
                    <button key={product.href} type="button" onClick={() => addProduct(product)} disabled={added}>
                      <span className={styles.resultIcon}>{added ? <Check size={20} /> : <PackageSearch size={20} />}</span>
                      <span className={styles.resultMain}>
                        <strong>{product.name}</strong>
                        <small>{[product.code && `Код ${product.code}`, product.article && `Арт. ${product.article}`].filter(Boolean).join(" · ") || "Без кода"}</small>
                      </span>
                      <span className={styles.resultPrice}>{formatMoney(product.price)} сом<small>Остаток: {formatMoney(product.stock)}</small></span>
                    </button>
                  );
                }) : (
                  <div className={styles.resultState}>По этому запросу товары не найдены.</div>
                )}
              </div>
            ) : search ? <div className={styles.searchHint}>Введите минимум 2 символа.</div> : null}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <span>Шаг 3</span>
                <h2>Порядок страниц</h2>
              </div>
              <Images size={24} />
            </div>

            {selectedProducts.length ? (
              <div className={styles.selectedList}>
                {selectedProducts.map((product, index) => (
                  <article key={product.href}>
                    <div className={styles.itemNumber}>{String(index + 1).padStart(2, "0")}</div>
                    <div className={styles.itemInfo}>
                      <strong>{product.name}</strong>
                      <span>{product.code ? `Код ${product.code}` : "Без кода"} · {formatMoney(getCatalogPrice(product, priceTypeName).value)} {formatCurrency(getCatalogPrice(product, priceTypeName).currency)}</span>
                    </div>
                    <div className={styles.itemActions}>
                      <button type="button" onClick={() => setSelectedProducts((current) => moveCatalogProduct(current, index, -1))} disabled={index === 0} aria-label="Поднять товар"><ArrowUp size={18} /></button>
                      <button type="button" onClick={() => setSelectedProducts((current) => moveCatalogProduct(current, index, 1))} disabled={index === selectedProducts.length - 1} aria-label="Опустить товар"><ArrowDown size={18} /></button>
                      <button className={styles.removeButton} type="button" onClick={() => setSelectedProducts((current) => current.filter((item) => item.href !== product.href))} aria-label="Удалить товар"><Trash2 size={18} /></button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <PackageSearch size={38} />
                <strong>Товары ещё не выбраны</strong>
                <span>Найдите товар выше и добавьте его в каталог.</span>
              </div>
            )}
          </section>
        </main>

        <aside className={styles.summary}>
          <div className={styles.summaryCover}>
            <div className={styles.summaryLogos}>
              <Image src="/belek-tehnika-logo.svg" alt="Белек Техника" width={180} height={68} />
              <Image src="/gifton-logo.svg" alt="GiftON" width={145} height={54} />
            </div>
            <div className={styles.coverTitle}>
              <span>Белек Техника × GiftON</span>
              <strong>{title.trim() || "Каталог техники"}</strong>
              {subtitle.trim() ? <small>{subtitle.trim()}</small> : null}
            </div>
            <div className={styles.coverCount}>{selectedProducts.length}<small>товаров</small></div>
          </div>

          <div className={styles.summaryInfo}>
            <div><span>Формат</span><strong>A4 · PDF</strong></div>
            <div><span>Фотографии</span><strong>Все из МойСклад</strong></div>
            <div><span>Цена</span><strong>{showPrices ? priceTypeName || "По умолчанию" : "Скрыть"}</strong></div>
          </div>

          <button className={styles.generateButton} type="button" onClick={createCatalog} disabled={!selectedProducts.length || catalogMutation.isPending}>
            {catalogMutation.isPending ? <LoaderCircle className={styles.spin} size={21} /> : <FileDown size={21} />}
            {catalogMutation.isPending ? "Загружаю фото и собираю…" : "Создать PDF-каталог"}
          </button>
          <p className={styles.summaryNote}>Во время создания система загрузит оригиналы всех фотографий выбранных позиций. Не закрывайте страницу.</p>
        </aside>
      </div>
    </div>
  );
}
