"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { getMoySkladRequestMonitor } from "../api/moysklad-request-monitor-api";
import styles from "./moysklad-request-monitor.module.css";

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export function MoySkladRequestMonitor() {
  const [expanded, setExpanded] = useState(false);
  const monitor = useQuery({
    queryKey: ["crm", "moysklad-request-monitor"],
    queryFn: getMoySkladRequestMonitor,
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: 1,
  });
  const stats = monitor.data?.stats.rateLimiter;
  const usage = stats?.usagePercent ?? 0;
  const last429At = stats?.last429At ? new Date(stats.last429At).getTime() : 0;
  const danger = Boolean(stats?.blockedUntil) || (last429At > 0 && monitor.dataUpdatedAt - last429At < 60_000);
  const warning = usage >= 80 || (stats?.queuedRequests ?? 0) > 5;
  const bars = stats?.requestsByBucket ?? Array.from({ length: 12 }, () => 0);
  const maxBar = Math.max(1, ...bars);

  return (
    <aside className={`${styles.monitor} ${expanded ? styles.expanded : ""}`} aria-label="Монитор запросов МойСклад">
      <button className={styles.header} type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={expanded ? "Скрыть график запросов МойСклад" : "Показать график запросов МойСклад"}>
        <span className={`${styles.status} ${danger ? styles.danger : warning ? styles.warning : styles.safe}`}>
          {danger ? <AlertTriangle size={16} /> : <Activity size={16} />}
        </span>
        <span className={styles.title}>
          <strong>МойСклад API</strong>
          <small>{stats ? `${stats.requestsLastMinute} из ${stats.maxRequestsPerMinute} за минуту` : "Загружаю статистику…"}</small>
        </span>
        {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>

      {expanded ? (
        <div className={styles.body}>
          {monitor.isError ? (
            <div className={styles.error}>
              <span>Не удалось получить статистику.</span>
              <button type="button" onClick={() => monitor.refetch()} aria-label="Повторить"><RefreshCw size={15} /></button>
            </div>
          ) : (
            <>
              <div className={styles.chart} aria-label="Запросы за последние 60 секунд">
                {bars.map((value, index) => (
                  <i key={index} style={{ height: `${Math.max(5, Math.round((value / maxBar) * 100))}%` }} title={`${value} запросов за 5 секунд`} />
                ))}
              </div>
              <div className={styles.scale}><span>60 сек назад</span><span>сейчас</span></div>
              <div className={styles.progress}>
                <span style={{ width: `${usage}%` }} className={danger ? styles.dangerBar : warning ? styles.warningBar : ""} />
              </div>
              <div className={styles.metrics}>
                <span><small>Использовано</small><strong>{usage}%</strong></span>
                <span><small>Осталось</small><strong>{formatNumber(stats?.remainingThisMinute ?? 0)}</strong></span>
                <span><small>В очереди</small><strong>{formatNumber(stats?.queuedRequests ?? 0)}</strong></span>
                <span><small>Активно</small><strong>{formatNumber(stats?.activeRequests ?? 0)}</strong></span>
              </div>
              <footer>
                <span>Всего с запуска: {formatNumber(stats?.totalStarted ?? 0)}</span>
                <span className={(stats?.total429 ?? 0) > 0 ? styles.hasErrors : ""}>Ошибок 429: {formatNumber(stats?.total429 ?? 0)}</span>
              </footer>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
}
