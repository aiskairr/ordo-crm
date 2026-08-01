"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, CircleAlert, X } from "lucide-react";
import { getPublishedSystemNews } from "../api/system-news-api";
import styles from "./system-news.module.css";

type SeenMap = Record<string, string>;

function storageKey(userId: string) {
  return `ordo_crm_seen_announcements_v1:${userId}`;
}

function readSeen(userId: string): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "{}");
    return value && typeof value === "object" ? value as SeenMap : {};
  } catch {
    return {};
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "Asia/Bishkek",
  }).format(date);
}

export function SystemNews({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<SeenMap>(() => readSeen(userId));
  const autoOpened = useRef(false);
  const news = useQuery({
    queryKey: ["crm", "system-news"],
    queryFn: getPublishedSystemNews,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
  const unread = useMemo(
    () => (news.data || []).filter((item) => seen[item.id] !== item.updatedAt),
    [news.data, seen],
  );

  useEffect(() => {
    if (!news.data?.length || !unread.length || autoOpened.current) return;
    autoOpened.current = true;
    setOpen(true);
  }, [news.data, unread.length]);

  const close = () => {
    const nextSeen = { ...seen };
    for (const item of news.data || []) nextSeen[item.id] = item.updatedAt;
    setSeen(nextSeen);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(nextSeen));
    setOpen(false);
  };

  return (
    <>
      <button className={styles.trigger} type="button" onClick={() => setOpen(true)} aria-label="Новости CRM" title="Новости CRM">
        <Bell size={19} />
        {unread.length ? <span>{unread.length > 9 ? "9+" : unread.length}</span> : null}
      </button>

      {open ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={close}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="system-news-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div className={styles.icon}><BellRing size={22} /></div>
              <div><p>ORDO CRM</p><h2 id="system-news-title">Новости системы</h2><span>Важные изменения и объявления владельца.</span></div>
              <button type="button" onClick={close} aria-label="Закрыть"><X size={20} /></button>
            </header>
            <div className={styles.list}>
              {news.isLoading ? <div className={styles.state}>Загружаю новости…</div> : null}
              {news.isError ? <div className={styles.state}><CircleAlert size={20} />Не удалось загрузить новости.</div> : null}
              {news.isSuccess && !news.data.length ? <div className={styles.state}>Новых объявлений пока нет.</div> : null}
              {news.data?.map((item) => {
                const isUnread = seen[item.id] !== item.updatedAt;
                return (
                  <article className={`${styles.item} ${item.important ? styles.important : ""}`} key={item.id}>
                    <div className={styles.itemHeading}>
                      <div>{item.important ? <em>Важно</em> : null}{isUnread ? <i>Новое</i> : null}</div>
                      <time>{formatDate(item.publishedAt || item.updatedAt)}</time>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.message}</p>
                  </article>
                );
              })}
            </div>
            <footer><button type="button" onClick={close}>Понятно</button></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
