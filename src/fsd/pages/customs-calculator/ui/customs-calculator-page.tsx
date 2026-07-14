"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, PackageSearch, Plus, Save, Trash2 } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  deleteCustomsHistory,
  getCustomsHistory,
  getCustomsHistoryItem,
  getCustomsProducts,
  saveCustomsHistory,
  type CustomsProduct,
} from "../api/customs-calculator-api";
import styles from "./customs-calculator-page.module.css";

type BoxVariant = "single" | "master";
type PaymentType = "cashless" | "cash";
type DistributionMode = "weight" | "volume";

type Row = {
  id: string;
  productId: string;
  name: string;
  code: string;
  article: string;
  boxVariant: BoxVariant;
  quantity: number;
  boxesCount: number;
  unitsPerBox: number;
  boxSize: number;
  masterBoxVolume: number;
  packageWeightKg: number;
  buyPriceValue: number;
  buyPriceCurrency: "USD" | "KGS";
  paymentType: PaymentType;
  profitPerUnitUsd: number;
  otherPerUnitUsd: number;
  specification: string;
};

type PartyExpenses = {
  customsClearance: number;
  temporaryStorage: number;
  declaration: number;
  processing: number;
  seal: number;
  escort: number;
  utilityFee: number;
  deliveryUsd: number;
  distributionMode: DistributionMode;
};

type RowCalculation = {
  quantity: number;
  buyUnitUsd: number;
  buyTotalUsd: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  sharedRateUsd: number;
  sharedTotalUsd: number;
  sharedPerUnitUsd: number;
  profitTotalUsd: number;
  otherTotalUsd: number;
  landedPerUnitUsd: number;
  taxRateLabel: string;
  taxPerUnitUsd: number;
  taxTotalUsd: number;
  finalPerUnitUsd: number;
  finalTotalUsd: number;
};

const SETTINGS_KEY = "ordoCustomsCalculatorSettingsReact";
const DRAFT_KEY = "ordoCustomsCalculatorDraftReact";

const defaultExpenses: PartyExpenses = {
  customsClearance: 0,
  temporaryStorage: 0,
  declaration: 0,
  processing: 0,
  seal: 0,
  escort: 0,
  utilityFee: 0,
  deliveryUsd: 0,
  distributionMode: "weight",
};

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const roundMoney = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const roundMeasure = (value: number) =>
  Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
const normalizeSearch = (value: string) =>
  value.trim().toLocaleLowerCase("ru-RU");
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random()}`;

const money = (value: number, currency = "USD") =>
  `${moneyFormatter.format(value || 0)} ${currency}`;
const formatUsd = (value: number) => money(value, "USD");
const formatSom = (value: number) => money(value, "сом");
const measure = (value: number, unit: string) =>
  `${
    new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: value > 0 && value < 1 ? 3 : 0,
      maximumFractionDigits: 3,
    }).format(value || 0)
  } ${unit}`;
const formatDateTime = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

function normalizeBuyPrice(product?: CustomsProduct | null) {
  const buyPrice = product?.buyPrice;
  const currencySource = normalizeSearch(
    `${buyPrice?.currencyIsoCode || ""} ${buyPrice?.currencyName || ""}`,
  );
  const currency = currencySource.includes("сом") || currencySource.includes("kgs")
    ? "KGS"
    : "USD";
  return {
    value: Number(buyPrice?.value || 0),
    currency: currency as "USD" | "KGS",
  };
}

function makeRow(product?: CustomsProduct | null): Row {
  const buy = normalizeBuyPrice(product);
  return {
    id: uid(),
    productId: product?.id || "",
    name: product?.name || "",
    code: product?.code || "",
    article: product?.article || "",
    boxVariant: "single",
    quantity: 1,
    boxesCount: 0,
    unitsPerBox: 0,
    boxSize: 0,
    masterBoxVolume: 0,
    packageWeightKg: 0,
    buyPriceValue: buy.value,
    buyPriceCurrency: buy.currency,
    paymentType: "cashless",
    profitPerUnitUsd: 0,
    otherPerUnitUsd: 0,
    specification: "",
  };
}

function readDraft() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") as {
      rows?: Row[];
      partyExpenses?: PartyExpenses;
      usdRate?: number;
    } | null;
  } catch {
    return null;
  }
}

function rowQuantity(row: Row) {
  return row.boxVariant === "master" && row.boxesCount > 0 && row.unitsPerBox > 0
    ? row.boxesCount * row.unitsPerBox
    : Math.max(1, Number(row.quantity || 1));
}

function rowVolume(row: Row) {
  return row.boxVariant === "master"
    ? roundMeasure(Number(row.masterBoxVolume || 0) * Number(row.boxesCount || 0))
    : roundMeasure(Number(row.boxSize || 0) * rowQuantity(row));
}

function rowVolumePerUnit(row: Row) {
  if (row.boxVariant === "master") {
    return row.unitsPerBox > 0
      ? roundMeasure(Number(row.masterBoxVolume || 0) / row.unitsPerBox)
      : 0;
  }
  return roundMeasure(Number(row.boxSize || 0));
}

function rowWeight(row: Row) {
  return roundMoney(Number(row.packageWeightKg || 0) * rowQuantity(row));
}

export function CustomsCalculatorPage() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const draft = readDraft();
  const [usdRate, setUsdRate] = useState(() => Number(draft?.usdRate || 89));
  const [rows, setRows] = useState<Row[]>(() =>
    draft?.rows?.length ? draft.rows : [],
  );
  const [party, setParty] = useState<PartyExpenses>(() => ({
    ...defaultExpenses,
    ...(draft?.partyExpenses || {}),
  }));
  const [search, setSearch] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const productsQuery = useQuery({
    queryKey: ["customs-products"],
    queryFn: getCustomsProducts,
  });
  const historyQuery = useQuery({
    queryKey: ["customs-history"],
    queryFn: getCustomsHistory,
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const results = useMemo(() => {
    const query = normalizeSearch(search);
    if (!query) return [];
    return products
      .filter((product) =>
        normalizeSearch([product.name, product.code, product.article].join(" ")).includes(query),
      )
      .slice(0, 12);
  }, [products, search]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ usdRate }));
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        rows,
        rowSeq: rows.length + 1,
        partyExpenses: party,
        usdRate,
      }),
    );
  }, [party, rows, usdRate]);

  const partyContext = useMemo(() => {
    const commonKgs = roundMoney(
      party.customsClearance +
        party.temporaryStorage +
        party.declaration +
        party.processing +
        party.seal +
        party.escort +
        party.utilityFee,
    );
    const commonUsd = usdRate > 0 ? roundMoney(commonKgs / usdRate) : 0;
    const totalCommonUsd = roundMoney(commonUsd + party.deliveryUsd);
    const totalUnits = rows.reduce((sum, row) => sum + rowQuantity(row), 0);
    const totalWeight = rows.reduce((sum, row) => sum + rowWeight(row), 0);
    const totalVolume = rows.reduce((sum, row) => sum + rowVolume(row), 0);
    const denominator = party.distributionMode === "volume" ? totalVolume : totalWeight;
    return {
      commonKgs,
      commonUsd,
      totalCommonUsd,
      totalUnits,
      totalWeight,
      totalVolume,
      denominator,
      basisLabel: party.distributionMode === "volume" ? "м³" : "кг",
      distributionLabel: party.distributionMode === "volume" ? "Объем" : "Вес",
      sharedRateUsd: denominator > 0 ? roundMoney(totalCommonUsd / denominator) : 0,
    };
  }, [party, rows, usdRate]);

  const calculateRow = useCallback((row: Row): RowCalculation => {
    const quantity = rowQuantity(row);
    const buyUnitUsd =
      row.buyPriceCurrency === "USD"
        ? Number(row.buyPriceValue || 0)
        : usdRate > 0
          ? roundMoney(Number(row.buyPriceValue || 0) / usdRate)
          : 0;
    const totalWeightKg = rowWeight(row);
    const totalVolumeM3 = rowVolume(row);
    const distributionBase =
      party.distributionMode === "volume" ? totalVolumeM3 : totalWeightKg;
    const sharedTotalUsd = roundMoney(distributionBase * partyContext.sharedRateUsd);
    const sharedPerUnitUsd = quantity > 0 ? roundMoney(sharedTotalUsd / quantity) : 0;
    const profitPerUnitUsd = roundMoney(Number(row.profitPerUnitUsd || 0));
    const otherPerUnitUsd = roundMoney(Number(row.otherPerUnitUsd || 0));
    const landedPerUnitUsd = roundMoney(
      buyUnitUsd + sharedPerUnitUsd + otherPerUnitUsd,
    );
    const taxRate = row.paymentType === "cash" ? 0.04 : 0.02;
    const taxablePerUnit = roundMoney(landedPerUnitUsd + profitPerUnitUsd);
    const taxPerUnitUsd = roundMoney(taxablePerUnit * taxRate);
    const finalPerUnitUsd = roundMoney(taxablePerUnit + taxPerUnitUsd);

    return {
      quantity,
      buyUnitUsd,
      buyTotalUsd: roundMoney(buyUnitUsd * quantity),
      totalWeightKg,
      totalVolumeM3,
      sharedRateUsd: partyContext.sharedRateUsd,
      sharedTotalUsd,
      sharedPerUnitUsd,
      profitTotalUsd: roundMoney(profitPerUnitUsd * quantity),
      otherTotalUsd: roundMoney(otherPerUnitUsd * quantity),
      landedPerUnitUsd,
      taxRateLabel: row.paymentType === "cash" ? "4%" : "2%",
      taxPerUnitUsd,
      taxTotalUsd: roundMoney(taxPerUnitUsd * quantity),
      finalPerUnitUsd,
      finalTotalUsd: roundMoney(finalPerUnitUsd * quantity),
    };
  }, [party.distributionMode, partyContext.sharedRateUsd, usdRate]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const calc = calculateRow(row);
        acc.rows += 1;
        acc.units += calc.quantity;
        acc.weight += calc.totalWeightKg;
        acc.volume += calc.totalVolumeM3;
        acc.buy += calc.buyTotalUsd;
        acc.profit += calc.profitTotalUsd;
        acc.expenses +=
          calc.sharedTotalUsd +
          calc.otherTotalUsd +
          calc.taxTotalUsd +
          calc.profitTotalUsd;
        acc.final += calc.finalTotalUsd;
        return acc;
      },
      {
        rows: 0,
        units: 0,
        weight: 0,
        volume: 0,
        buy: 0,
        profit: 0,
        expenses: 0,
        final: 0,
      },
    );
  }, [rows, calculateRow]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const title = window.prompt(
        "Название для истории",
        `${rows.find((row) => row.name)?.name || "Расчет таможни"} • ${new Date().toLocaleString("ru-RU")}`,
      );
      if (title === null) throw new Error("cancelled");
      return saveCustomsHistory({
        title,
        draft: { rows, rowSeq: rows.length + 1, partyExpenses: party, usdRate },
      });
    },
    onSuccess: async () => {
      showToast({ tone: "success", title: "Расчет сохранен" });
      setHistoryOpen(true);
      await queryClient.invalidateQueries({ queryKey: ["customs-history"] });
    },
    onError: (error) => {
      if (getErrorText(error) !== "cancelled") {
        showToast({
          tone: "error",
          title: "Не удалось сохранить",
          description: getErrorText(error),
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomsHistory,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customs-history"] }),
    onError: (error) => {
      showToast({
        tone: "error",
        title: "Не удалось удалить запись",
        description: getErrorText(error),
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: getCustomsHistoryItem,
    onSuccess: (item) => {
      setRows((Array.isArray(item.rows) ? item.rows : []) as Row[]);
      setParty({ ...defaultExpenses, ...(item.partyExpenses || {}) } as PartyExpenses);
      showToast({ tone: "success", title: "История загружена" });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        title: "Не удалось открыть историю",
        description: getErrorText(error),
      });
    },
  });

  const patch = (id: string, next: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...next } : row)),
    );

  const patchParty = (next: Partial<PartyExpenses>) =>
    setParty((current) => ({ ...current, ...next }));

  const catalogStatus = productsQuery.isLoading
    ? "Загружаю каталог МойСклад..."
    : productsQuery.isError
      ? getErrorText(productsQuery.error)
      : `Каталог МойСклад: ${nf.format(products.length)} товаров`;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Импорт и себестоимость</p>
          <h1>Калькулятор таможни</h1>
          <span>
            Расчет партии по весу или объему, налог, прибыль, история и быстрый
            подбор товара из МойСклад.
          </span>
        </div>
      </header>

      <section className={styles.toolbar}>
        <label>
          <span>Курс USD - KGS</span>
          <input
            type="number"
            value={usdRate}
            onChange={(e) => setUsdRate(Number(e.target.value))}
          />
        </label>
        <label className={styles.searchField}>
          <span>Поиск в каталоге МойСклад</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название, код или артикул"
          />
        </label>
        <button className={styles.toolbarButton} onClick={() => productsQuery.refetch()}>
          <PackageSearch size={17} /> Обновить
        </button>
        <button className={styles.toolbarButtonPrimary} onClick={() => setRows((current) => [...current, makeRow()])}>
          <Plus size={17} /> Добавить товар
        </button>
        <button className={styles.toolbarButton} onClick={() => saveMutation.mutate()}>
          <Save size={17} /> Сохранить в историю
        </button>
        <button className={styles.toolbarSubButton} onClick={() => setHistoryOpen((current) => !current)}>
          <History size={17} /> История
        </button>
        <button
          className={styles.toolbarDangerButton}
          onClick={() => {
            if (window.confirm("Очистить все строки калькулятора?")) {
              setRows([]);
            }
          }}
        >
          <Trash2 size={17} /> Очистить
        </button>
      </section>

      {historyOpen ? (
        <section className={styles.history}>
          <div className={styles.sectionHead}>
            <h2>История расчетов</h2>
            <span>Сохраненные партии из Supabase.</span>
          </div>
          {!historyQuery.data?.length ? (
            <div className={styles.empty}>История пока пустая.</div>
          ) : (
            historyQuery.data.map((item) => (
              <article key={item.id}>
                <button onClick={() => restoreMutation.mutate(item.id)}>
                  <strong>{item.name}</strong>
                  <span>
                    {formatDateTime(item.createdAt)} · {item.rowsCount} строк
                  </span>
                </button>
                <button onClick={() => deleteMutation.mutate(item.id)}>
                  <Trash2 size={15} />
                </button>
              </article>
            ))
          )}
        </section>
      ) : null}

      <section className={styles.searchResults}>
        <div className={styles.sectionHead}>
          <h2>Результаты поиска</h2>
          <span>{productsQuery.isLoading ? "Загружаю каталог товаров..." : catalogStatus}</span>
        </div>
        {!search ? (
          <div className={styles.empty}>
            Каталог здесь необязателен. Можно сразу нажать «Добавить товар» и
            заполнить всё вручную.
          </div>
        ) : !results.length ? (
          <div className={styles.empty}>Ничего не найдено по текущему запросу.</div>
        ) : (
          results.map((product) => (
            <article key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>
                  Код: {product.code || "-"} · Артикул: {product.article || "-"} ·
                  Закупка:{" "}
                  {money(
                    product.buyPrice?.value || 0,
                    product.buyPrice?.currencyIsoCode ||
                      product.buyPrice?.currencyName ||
                      "USD",
                  )}
                </span>
              </div>
              <button onClick={() => setRows((current) => [...current, makeRow(product)])}>
                Добавить
              </button>
            </article>
          ))
        )}
      </section>

      <section className={styles.rows}>
        <div className={styles.sectionHead}>
          <h2>Товары в партии</h2>
          <span>
            Каждая строка это отдельный товар. Общие расходы сверху
            распределяются на весь приход автоматически.
          </span>
        </div>

        {rows.length ? (
          rows.map((row, index) => {
            const calc = calculateRow(row);
            return (
              <article key={row.id} className={styles.rowCard}>
                <header>
                  <div>
                    <span>Товар {index + 1}</span>
                    <strong>{row.name || "Новая позиция"}</strong>
                  </div>
                  <button onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>
                    <Trash2 size={16} />
                  </button>
                </header>

                <div className={styles.rowGrid}>
                  <label className={styles.wide}>
                    <span>Название</span>
                    <input
                      value={row.name}
                      onChange={(e) => patch(row.id, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Код</span>
                    <input
                      value={row.code}
                      onChange={(e) => patch(row.id, { code: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Артикул</span>
                    <input
                      value={row.article}
                      onChange={(e) => patch(row.id, { article: e.target.value })}
                    />
                  </label>
                  <label>
                    <span>Тип коробки</span>
                    <select
                      value={row.boxVariant}
                      onChange={(e) => patch(row.id, { boxVariant: e.target.value as BoxVariant })}
                    >
                      <option value="single">Обычная коробка</option>
                      <option value="master">Мастер-коробка</option>
                    </select>
                  </label>

                  {row.boxVariant === "master" ? (
                    <>
                      <label>
                        <span>Коробок</span>
                        <input
                          type="number"
                          value={row.boxesCount}
                          onChange={(e) => patch(row.id, { boxesCount: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Штук в коробке</span>
                        <input
                          type="number"
                          value={row.unitsPerBox}
                          onChange={(e) => patch(row.id, { unitsPerBox: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Объем мастер-коробки</span>
                        <input
                          type="number"
                          value={row.masterBoxVolume}
                          onChange={(e) =>
                            patch(row.id, { masterBoxVolume: Number(e.target.value) })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>Количество</span>
                        <input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => patch(row.id, { quantity: Number(e.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Объем 1 коробки</span>
                        <input
                          type="number"
                          value={row.boxSize}
                          onChange={(e) => patch(row.id, { boxSize: Number(e.target.value) })}
                        />
                      </label>
                    </>
                  )}

                  <label>
                    <span>Объем 1 шт</span>
                    <input value={rowVolumePerUnit(row)} readOnly />
                  </label>
                  <label>
                    <span>Вес 1 шт, кг</span>
                    <input
                      type="number"
                      value={row.packageWeightKg}
                      onChange={(e) =>
                        patch(row.id, { packageWeightKg: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    <span>Закупка</span>
                    <input
                      type="number"
                      value={row.buyPriceValue}
                      onChange={(e) => patch(row.id, { buyPriceValue: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    <span>Валюта</span>
                    <select
                      value={row.buyPriceCurrency}
                      onChange={(e) =>
                        patch(row.id, { buyPriceCurrency: e.target.value as "USD" | "KGS" })
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="KGS">KGS</option>
                    </select>
                  </label>
                  <label>
                    <span>Оплата</span>
                    <select
                      value={row.paymentType}
                      onChange={(e) =>
                        patch(row.id, { paymentType: e.target.value as PaymentType })
                      }
                    >
                      <option value="cashless">Безнал 2%</option>
                      <option value="cash">Наличные 4%</option>
                    </select>
                  </label>
                  <label>
                    <span>Прибыль/шт USD</span>
                    <input
                      type="number"
                      value={row.profitPerUnitUsd}
                      onChange={(e) =>
                        patch(row.id, { profitPerUnitUsd: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    <span>Прочие/шт USD</span>
                    <input
                      type="number"
                      value={row.otherPerUnitUsd}
                      onChange={(e) =>
                        patch(row.id, { otherPerUnitUsd: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className={styles.wide}>
                    <span>Спецификация</span>
                    <input
                      value={row.specification}
                      onChange={(e) =>
                        patch(row.id, { specification: e.target.value })
                      }
                      placeholder="Модель, цвет, примечание"
                    />
                  </label>
                </div>

                <div className={styles.metrics}>
                  <span>
                    Цена за ед.
                    <b>{formatUsd(calc.buyUnitUsd)}</b>
                  </span>
                  <span>
                    Сумма закупки
                    <b>{formatUsd(calc.buyTotalUsd)}</b>
                  </span>
                  <span>
                    Вес / объем
                    <b>
                      {measure(calc.totalWeightKg, "кг")} / {measure(calc.totalVolumeM3, "м³")}
                    </b>
                  </span>
                  <span>
                    Коробки / штуки
                    <b>
                      {row.boxVariant === "master"
                        ? `${nf.format(row.boxesCount)} / ${nf.format(calc.quantity)}`
                        : `${nf.format(calc.quantity)} шт`}
                    </b>
                  </span>
                  <span>
                    Ставка общих расходов
                    <b>{formatUsd(calc.sharedRateUsd)}</b>
                  </span>
                  <span>
                    Нагрузка на 1 шт
                    <b>{formatUsd(calc.sharedPerUnitUsd)}</b>
                  </span>
                  <span>
                    Прибыль по строке
                    <b>{formatUsd(calc.profitTotalUsd)}</b>
                  </span>
                  <span>
                    Налог {calc.taxRateLabel}
                    <b>{formatUsd(calc.taxTotalUsd)}</b>
                  </span>
                  <span>
                    Доп. по строке
                    <b>{formatUsd(calc.otherTotalUsd)}</b>
                  </span>
                  <span>
                    Себестоимость 1 шт
                    <b>{formatUsd(calc.landedPerUnitUsd)}</b>
                  </span>
                  <span>
                    Итог 1 шт с налогом
                    <b>{formatUsd(calc.finalPerUnitUsd)}</b>
                  </span>
                  <span>
                    Итог партии
                    <b>{formatUsd(calc.finalTotalUsd)}</b>
                  </span>
                </div>
              </article>
            );
          })
        ) : (
          <div className={styles.empty}>
            Пока нет товаров в расчете. Добавьте товар вручную или через каталог
            МойСклад.
          </div>
        )}
      </section>

      <section className={styles.party}>
        <div className={styles.sectionHead}>
          <h2>Общие расходы партии</h2>
          <span>
            Эти суммы относятся ко всему приходу целиком, а не к одной строке.
            Система собирает общий расход, переводит его в USD и распределяет по весу
            или объёму всей поставки.
          </span>
        </div>

        <div className={styles.partyGrid}>
          {[
            ["customsClearance", "Растаможка от брокера за партию, сом"],
            ["temporaryStorage", "СВХ за партию, сом"],
            ["declaration", "Таможенная декларация, сом"],
            ["processing", "Оформление, сом"],
            ["seal", "Пломба, сом"],
            ["escort", "Сопровождение, сом"],
            ["utilityFee", "Утильсбор, сом"],
            ["deliveryUsd", "Транспорт, USD"],
          ].map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="number"
                value={party[key as keyof PartyExpenses] as number}
                onChange={(e) =>
                  patchParty({ [key]: Number(e.target.value) } as Partial<PartyExpenses>)
                }
              />
            </label>
          ))}
          <label>
            <span>Распределять по</span>
            <select
              value={party.distributionMode}
              onChange={(e) =>
                patchParty({ distributionMode: e.target.value as DistributionMode })
              }
            >
              <option value="weight">Весу</option>
              <option value="volume">Объему</option>
            </select>
          </label>
        </div>

        <div className={styles.partyStats}>
          <article>
            <span>Общие расходы, сом</span>
            <strong>{formatSom(partyContext.commonKgs)}</strong>
          </article>
          <article>
            <span>Общие расходы, USD</span>
            <strong>{formatUsd(partyContext.commonUsd)}</strong>
          </article>
          <article>
            <span>С транспортом, USD</span>
            <strong>{formatUsd(partyContext.totalCommonUsd)}</strong>
          </article>
          <article>
            <span>Ставка распределения</span>
            <strong>
              {formatUsd(partyContext.sharedRateUsd)} / {partyContext.basisLabel}
            </strong>
          </article>
        </div>
      </section>

      <section className={styles.summary}>
        <article>
          <span>Товаров в расчете</span>
          <strong>{nf.format(totals.rows)}</strong>
        </article>
        <article>
          <span>Общее кол-во шт.</span>
          <strong>{nf.format(totals.units)} шт</strong>
        </article>
        <article>
          <span>Общий вес, кг</span>
          <strong>{measure(totals.weight, "кг")}</strong>
        </article>
        <article>
          <span>Общий объем, м³</span>
          <strong>{measure(totals.volume, "м³")}</strong>
        </article>
        <article>
          <span>Закупка</span>
          <strong>{formatUsd(totals.buy)}</strong>
        </article>
        <article>
          <span>Общая прибыль</span>
          <strong>{formatUsd(totals.profit)}</strong>
        </article>
        <article>
          <span>Общие расходы партии</span>
          <strong>{formatUsd(totals.expenses)}</strong>
        </article>
      </section>

      <section className={styles.totalSection}>
        <article className={styles.total}>
          <span>Себестоимость партии</span>
          <strong>{formatUsd(totals.final)}</strong>
        </article>
      </section>

      <section className={styles.tableSection}>
        <div className={styles.sectionHead}>
          <h2>Итог по товарам</h2>
          <span>Короткая таблица по каждой позиции без лишних полей.</span>
        </div>

        {!rows.length ? (
          <div className={styles.empty}>Таблица появится после добавления товаров.</div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Наименование</th>
                    <th>Количество</th>
                    <th>Объем 1 шт</th>
                    <th>Вес 1 шт</th>
                    <th>Цена 1 товара со всеми расходами</th>
                    <th>Себестоимость</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const calc = calculateRow(row);
                    return (
                      <tr key={row.id}>
                        <td>{row.name || "Без названия"}</td>
                        <td>{nf.format(calc.quantity)} шт</td>
                        <td>{measure(rowVolumePerUnit(row), "м³")}</td>
                        <td>{measure(row.packageWeightKg || 0, "кг")}</td>
                        <td>{formatUsd(calc.finalPerUnitUsd)}</td>
                        <td>{formatUsd(calc.landedPerUnitUsd)}</td>
                        <td>{formatUsd(calc.finalTotalUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.tableFooter}>
              <article>
                <span>Общее количество всех партий</span>
                <strong>{nf.format(totals.units)} шт</strong>
              </article>
              <article>
                <span>Общий объем</span>
                <strong>{measure(totals.volume, "м³")}</strong>
              </article>
              <article>
                <span>Общие расходы партии</span>
                <strong>{formatUsd(partyContext.totalCommonUsd)}</strong>
              </article>
              <article>
                <span>Итог сумма</span>
                <strong>{formatUsd(totals.final)}</strong>
              </article>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
