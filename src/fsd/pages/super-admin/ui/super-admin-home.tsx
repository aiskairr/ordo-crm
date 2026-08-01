"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Building2, CircleAlert, Database, RefreshCw, Settings2, Unplug } from "lucide-react";
import { getSuperAdminOverview, type HealthStatus } from "../api/super-admin-overview-api";
import styles from "./super-admin-home.module.css";

const statusLabels: Record<HealthStatus, string> = {
  healthy: "Работает",
  warning: "Требует внимания",
  error: "Ошибка",
  not_configured: "Не настроено",
};

function formatServerTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Bishkek",
  }).format(date);
}

export function SuperAdminHome() {
  const overview = useQuery({
    queryKey: ["super-admin", "overview"],
    queryFn: getSuperAdminOverview,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (overview.isPending) {
    return <section className={styles.loading}><RefreshCw size={24} />Проверяю состояние ORDO CRM…</section>;
  }

  if (overview.isError || !overview.data) {
    return (
      <section className={styles.errorState}>
        <CircleAlert size={30} />
        <div><h1>Обзор временно недоступен</h1><p>Сессия защищена, но сервер не смог собрать диагностику.</p></div>
        <button type="button" onClick={() => overview.refetch()}><RefreshCw size={17} />Повторить</button>
      </section>
    );
  }

  const data = overview.data;

  return (
    <div className={styles.page}>
      <section className={styles.heading}>
        <div><p>Состояние системы</p><h1>Обзор ORDO CRM</h1><span>Безопасная диагностика инфраструктуры без доступа к операциям сотрудников.</span></div>
        <button type="button" onClick={() => overview.refetch()} disabled={overview.isFetching}>
          <RefreshCw size={17} className={overview.isFetching ? styles.spinning : ""} />
          {overview.isFetching ? "Обновляю…" : "Обновить"}
        </button>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.primarySummary}>
          <div className={styles.summaryIcon}><Activity size={21} /></div>
          <span>Состояние</span><strong>{statusLabels[data.system.status]}</strong>
          <small>{data.summary.warnings ? `Предупреждений: ${data.summary.warnings}` : "Все проверки пройдены"}</small>
        </article>
        <article><div className={styles.summaryIcon}><Boxes size={21} /></div><span>Модули</span><strong>{data.summary.enabledModules}<small> / {data.summary.modules}</small></strong><small>включено</small></article>
        <article><div className={styles.summaryIcon}><Building2 size={21} /></div><span>Филиалы</span><strong>{data.summary.activeBranches}</strong><small>активных</small></article>
        <article><div className={styles.summaryIcon}><Settings2 size={21} /></div><span>Настройки</span><strong>{data.summary.settings}</strong><small>записей</small></article>
      </section>

      <section className={styles.columns}>
        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><Database size={20} /><span><strong>Supabase</strong><small>{data.database.message}</small></span></div><Status status={data.database.status} /></div>
          <div className={styles.tableList}>
            {data.database.tables.map((table) => (
              <div key={table.key}>
                <span><strong>{table.title}</strong><code>{table.key}</code></span>
                {table.exists ? <b>{table.count ?? 0}</b> : <em>{table.error || "Недоступно"}</em>}
              </div>
            ))}
          </div>
          {data.database.tables.some((table) => !table.exists) ? (
            <div className={styles.migration}><CircleAlert size={18} /><span>Примените миграцию <code>{data.database.migrationFile}</code></span></div>
          ) : null}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeading}><div><Unplug size={20} /><span><strong>Интеграции</strong><small>Только безопасные проверки доступности</small></span></div></div>
          <div className={styles.integrationList}>
            {data.integrations.map((integration) => (
              <div key={integration.key}>
                <span className={styles.integrationMark}>{integration.title.slice(0, 1)}</span>
                <span><strong>{integration.title}</strong><small>{integration.message}</small></span>
                <div><Status status={integration.status} />{integration.responseTimeMs !== null ? <small>{integration.responseTimeMs} мс</small> : null}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.systemPanel}>
        <div><span>Окружение</span><strong>{data.system.environment}</strong></div>
        <div><span>Версия</span><strong>{data.system.version}</strong></div>
        <div><span>Сборка</span><strong>{data.system.build}</strong></div>
        <div><span>Курс USD</span><strong>{data.system.usdRate} сом</strong></div>
        <div><span>Время сервера</span><strong>{formatServerTime(data.system.serverTime)}</strong></div>
      </section>
    </div>
  );
}

function Status({ status }: { status: HealthStatus }) {
  return <span className={`${styles.status} ${styles[status]}`}><i />{statusLabels[status]}</span>;
}
