"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Search, Truck } from "lucide-react";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import {
  DELIVERY_STATUS_LABELS,
  getDeliveries,
  updateDeliveryStatus,
  type Delivery,
  type DeliveryStatus,
} from "../api/deliveries-api";
import styles from "./deliveries-page.module.css";

function toDateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function splitDeliveryPhones(value: string) {
  return value.split(/\s*\/\s*/).map((phone) => phone.trim()).filter(Boolean);
}

function includesQuery(delivery: Delivery, query: string) {
  const source = [
    delivery.customerName,
    delivery.customerPhone,
    delivery.deliveryAddress,
    delivery.employeeName,
    delivery.branchName,
    ...delivery.items.map((item) => item.name),
  ]
    .join(" ")
    .toLocaleLowerCase("ru");
  return source.includes(query);
}

const statusOptions = Object.entries(DELIVERY_STATUS_LABELS) as Array<[DeliveryStatus, string]>;

export function DeliveriesPage() {
  const { showToast } = useToast();
  const initialRange = useMemo(() => {
    const today = new Date();
    const week = new Date(today);
    week.setDate(today.getDate() + 7);
    return { dateFrom: toDateInput(today), dateTo: toDateInput(week) };
  }, []);
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const deliveriesQuery = useQuery({
    queryKey: ["deliveries", dateFrom, dateTo, status],
    queryFn: () => getDeliveries({ dateFrom, dateTo, status }),
  });

  const statusMutation = useMutation({
    mutationFn: updateDeliveryStatus,
    onSuccess: async () => {
      showToast({ tone: "success", title: "Готово", description: "Статус доставки обновлен." });
      await queryClient.invalidateQueries({ queryKey: ["deliveries"] });
    },
  });

  const deliveries = deliveriesQuery.data ?? [];
  const query = search.trim().toLocaleLowerCase("ru");
  const visibleDeliveries = query ? deliveries.filter((delivery) => includesQuery(delivery, query)) : deliveries;
  const counters = {
    total: deliveries.length,
    new: deliveries.filter((delivery) => delivery.status === "new").length,
    transit: deliveries.filter((delivery) => delivery.status === "in_transit").length,
    delivered: deliveries.filter((delivery) => delivery.status === "delivered").length,
  };

  useEffect(() => {
    if (deliveriesQuery.error) {
      showToast({ tone: "error", title: "Не удалось загрузить доставки", description: getErrorText(deliveriesQuery.error) });
    }
  }, [deliveriesQuery.error, showToast]);

  useEffect(() => {
    if (statusMutation.error) {
      showToast({ tone: "error", title: "Статус не обновлен", description: getErrorText(statusMutation.error) });
    }
  }, [showToast, statusMutation.error]);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>Логистика</p>
          <h1>Доставки</h1>
          <span>Расписание доставок, статусы, клиент и позиции по заказу.</span>
        </div>
        <button type="button" onClick={() => deliveriesQuery.refetch()} disabled={deliveriesQuery.isFetching}>
          <RefreshCcw size={17} />
          {deliveriesQuery.isFetching ? "Обновляю..." : "Обновить"}
        </button>
      </header>

      <form className={styles.filters} onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>С даты</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>По дату</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          <span>Статус</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as DeliveryStatus | "")}>
            <option value="">Все статусы</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.search}>
          <span>Поиск</span>
          <div>
            <Search size={16} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Клиент, телефон, адрес, товар"
            />
          </div>
        </label>
      </form>

      <div className={styles.stats}>
        <article>
          <span>Всего</span>
          <strong>{counters.total}</strong>
        </article>
        <article>
          <span>Новые</span>
          <strong>{counters.new}</strong>
        </article>
        <article>
          <span>В пути</span>
          <strong>{counters.transit}</strong>
        </article>
        <article>
          <span>Доставлены</span>
          <strong>{counters.delivered}</strong>
        </article>
      </div>

      <section className={styles.listPanel}>
        <div className={styles.listHead}>
          <div>
            <h2>Расписание</h2>
            <p>{deliveriesQuery.isLoading ? "Загрузка..." : `${visibleDeliveries.length} доставок`}</p>
          </div>
          <Truck size={22} />
        </div>

        {deliveriesQuery.isLoading ? <div className={styles.empty}>Загружаю доставки...</div> : null}
        {!deliveriesQuery.isLoading && !visibleDeliveries.length ? <div className={styles.empty}>Подходящих доставок нет.</div> : null}

        <div className={styles.deliveryList}>
          {visibleDeliveries.map((delivery) => (
            <article key={delivery.id} className={`${styles.card} ${styles[delivery.status]}`}>
              <header>
                <div>
                  <span>{formatDateTime(delivery.scheduledAt)}</span>
                  <h3>{delivery.customerName || "Клиент не указан"}</h3>
                </div>
                <b>{DELIVERY_STATUS_LABELS[delivery.status]}</b>
              </header>

              <div className={styles.info}>
                <div>
                  <span>Телефон</span>
                  {delivery.customerPhone ? (
                    <p className={styles.phoneList}>
                      {splitDeliveryPhones(delivery.customerPhone).map((phone) => (
                        <a key={phone} href={`tel:${phone}`}>{phone}</a>
                      ))}
                    </p>
                  ) : <strong>-</strong>}
                </div>
                <div>
                  <span>Адрес</span>
                  <strong>{delivery.deliveryAddress || "-"}</strong>
                </div>
                <div>
                  <span>Филиал</span>
                  <strong>{delivery.branchName || "-"}</strong>
                </div>
                <div>
                  <span>Продал</span>
                  <strong>{delivery.employeeName || "-"}</strong>
                </div>
              </div>

              <div className={styles.items}>
                <span>Позиции на доставку</span>
                {delivery.items.length ? (
                  delivery.items.map((item, index) => (
                    <div key={`${item.name}-${index}`}>
                      <strong>{item.name || "Товар"}</strong>
                      <b>{formatQuantity(item.quantity)} шт</b>
                    </div>
                  ))
                ) : (
                  <p>Позиции не указаны</p>
                )}
              </div>

              {delivery.notes ? <p className={styles.notes}>{delivery.notes}</p> : null}

              <footer>
                <label>
                  <span>Статус</span>
                  <select
                    value={delivery.status}
                    disabled={statusMutation.isPending}
                    onChange={(event) =>
                      statusMutation.mutate({ id: delivery.id, status: event.target.value as DeliveryStatus })
                    }
                  >
                    {statusOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {delivery.documentUrl ? (
                  <a href={delivery.documentUrl} target="_blank" rel="noreferrer">
                    Документ №{delivery.documentName || delivery.id}
                  </a>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
