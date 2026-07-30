"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { CalendarDays, Clock3, MapPin, Phone, ShieldCheck } from "lucide-react";
import styles from "./proposal-page.module.css";

type ProposalProduct = {
  name: string;
  code: string;
  article: string;
  folderName: string;
  description: string;
  characteristics: Array<{ name: string; value: string }>;
  imageDataUrl: string;
  quantity: number;
  price: number;
  amount: number;
};

type ProposalRecord = {
  token: string;
  title: string;
  proposalDate: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  sellerLine: string;
  sellerBank: string;
  sellerBik: string;
  sellerSettlementAccount: string;
  total: number;
  totalQuantity: number;
  expiresAt: string;
  products: ProposalProduct[];
};

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

export default function ProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState("");
  const [data, setData] = useState<ProposalRecord | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    params.then(async ({ token: nextToken }) => {
      if (cancelled) return;
      setToken(nextToken);
      setLoading(true);
      setError("");

      const response = await fetch(`/api/commercial-documents/proposal/${nextToken}`, {
        cache: "no-store",
      }).catch(() => null);

      if (cancelled) return;
      if (!response?.ok) {
        setData(null);
        setLoading(false);
        setError("Ссылка истекла или коммерческое предложение уже недоступно.");
        return;
      }

      const payload = await response.json().catch(() => null);
      if (cancelled || !payload) return;
      setData(payload as ProposalRecord);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [params]);

  const expiresLabel = !data?.expiresAt
    ? ""
    : new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(data.expiresAt));

  if (loading) {
    return <main className={styles.state}>Загружаю коммерческое предложение...</main>;
  }

  if (!data) {
    return (
      <main className={styles.state}>
        <div className={styles.stateCard}>
          <strong>Ссылка недоступна</strong>
          <span>{error || `Токен ${token} не найден.`}</span>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Коммерческое предложение</p>
          <h1>{data.title || "Подбор техники"}</h1>
          <p className={styles.subtitle}>
            Подготовили подбор по вашему запросу. Ниже актуальные позиции, фотографии, ключевые характеристики и общая стоимость.
          </p>

          <div className={styles.heroMeta}>
            <span><CalendarDays size={16} /> {data.proposalDate || "Без даты"}</span>
            {data.customerPhone ? <span><Phone size={16} /> {data.customerPhone}</span> : null}
            {data.customerAddress ? <span><MapPin size={16} /> {data.customerAddress}</span> : null}
          </div>
        </div>

        <div className={styles.heroStats}>
          <div className={styles.statCard}>
            <span>Сумма предложения</span>
            <strong>{money(data.total)} сом</strong>
          </div>
          <div className={styles.statCard}>
            <span>Позиций</span>
            <strong>{data.products.length}</strong>
          </div>
          <div className={styles.statCard}>
            <span>Количество единиц</span>
            <strong>{data.totalQuantity}</strong>
          </div>
        </div>
      </section>

      <section className={styles.infoGrid}>
        <article className={styles.infoCard}>
          <p>Для клиента</p>
          <strong>{data.customerName || "Клиент"}</strong>
          <span>{data.customerPhone || "Телефон не указан"}</span>
        </article>
        <article className={styles.infoCard}>
          <p>Поставщик</p>
          <strong>Ordo CRM / Аю-Гранд</strong>
          <span>{data.sellerLine}</span>
        </article>
        <article className={styles.infoCard}>
          <p>Срок ссылки</p>
          <strong><Clock3 size={16} /> До {expiresLabel}</strong>
          <span>После этого страница автоматически перестанет открываться.</span>
        </article>
      </section>

      <section className={styles.products}>
        {data.products.map((product, index) => (
          <article key={`${product.code}-${index}`} className={styles.productCard}>
            <div className={styles.media}>
              {product.imageDataUrl ? (
                <Image src={product.imageDataUrl} alt={product.name} fill unoptimized sizes="(max-width: 1100px) 100vw, 360px" />
              ) : (
                <div className={styles.imageFallback}>Нет фото</div>
              )}
            </div>

            <div className={styles.productBody}>
              <div className={styles.productHead}>
                <div>
                  <p className={styles.productIndex}>Товар {index + 1}</p>
                  <h2>{product.name}</h2>
                  <div className={styles.tags}>
                    {product.folderName ? <span>{product.folderName}</span> : null}
                    {product.code ? <span>Код: {product.code}</span> : null}
                    {product.article ? <span>Арт: {product.article}</span> : null}
                  </div>
                </div>
                <div className={styles.priceBox}>
                  <span>Цена</span>
                  <strong>{money(product.price)} сом</strong>
                  <small>Кол-во: {product.quantity}</small>
                </div>
              </div>

              <p className={styles.description}>{product.description || "Описание пока не заполнено."}</p>

              <div className={styles.specGrid}>
                {product.characteristics.length ? (
                  product.characteristics.map((item, itemIndex) => (
                    <div key={`${item.name}-${itemIndex}`} className={styles.specCard}>
                      <span>{item.name}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))
                ) : (
                  <div className={styles.specCard}>
                    <span>Характеристики</span>
                    <strong>Не заполнены в МойСклад</strong>
                  </div>
                )}
              </div>

              <div className={styles.productFooter}>
                <span>Сумма позиции: <b>{money(product.amount)} сом</b></span>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.bankCard}>
        <div>
          <p className={styles.eyebrowDark}>Реквизиты</p>
          <h3>Оплата по расчетному счету</h3>
          <span>Банк: {data.sellerBank} | БИК: {data.sellerBik} | Расчетный счет: {data.sellerSettlementAccount}</span>
        </div>
        <div className={styles.bankBadge}>
          <ShieldCheck size={18} />
          <span>Актуально на момент создания КП</span>
        </div>
      </section>
    </main>
  );
}
