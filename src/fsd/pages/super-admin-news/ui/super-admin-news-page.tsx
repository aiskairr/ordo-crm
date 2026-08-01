"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CircleAlert, Edit3, Megaphone, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { SystemAnnouncement } from "@/src/fsd/entities/system-announcement";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import {
  createSuperAdminNews,
  deleteSuperAdminNews,
  getSuperAdminNews,
  updateSuperAdminNews,
} from "../api/super-admin-news-api";
import styles from "./super-admin-news-page.module.css";

type FormState = { title: string; message: string; important: boolean; published: boolean };
const emptyForm: FormState = { title: "", message: "", important: false, published: true };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bishkek",
  }).format(date);
}

export function SuperAdminNewsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const news = useQuery({ queryKey: ["super-admin", "news"], queryFn: getSuperAdminNews, retry: 1 });

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["super-admin", "news"] });
  const mutationOptions = {
    onSuccess: async () => {
      await refresh();
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
    },
    onError: (error: Error) => showToast({ tone: "error" as const, title: "Не удалось сохранить новость", description: getErrorText(error) }),
  };
  const createNews = useMutation({ mutationFn: createSuperAdminNews, ...mutationOptions });
  const updateNews = useMutation({ mutationFn: updateSuperAdminNews, ...mutationOptions });
  const deleteNews = useMutation({
    mutationFn: deleteSuperAdminNews,
    onSuccess: refresh,
    onError: (error) => showToast({ tone: "error", title: "Не удалось удалить новость", description: getErrorText(error) }),
  });
  const busy = createNews.isPending || updateNews.isPending;

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };
  const openEdit = (item: SystemAnnouncement) => {
    setEditingId(item.id);
    setForm({ title: item.title, message: item.message, important: item.important, published: item.published });
    setFormOpen(true);
  };
  const togglePublished = (item: SystemAnnouncement) => updateNews.mutate({
    id: item.id,
    title: item.title,
    message: item.message,
    important: item.important,
    published: !item.published,
  });

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><p>Коммуникация</p><h1>Новости CRM</h1><span>Публикации показываются сотрудникам после входа и остаются доступны через колокольчик.</span></div>
        <button type="button" onClick={openCreate}><Plus size={18} />Добавить новость</button>
      </header>

      <section className={styles.stats}>
        <article><Megaphone size={20} /><span>Всего</span><strong>{news.data?.length ?? 0}</strong></article>
        <article><BellRing size={20} /><span>Опубликовано</span><strong>{news.data?.filter((item) => item.published).length ?? 0}</strong></article>
        <article><CircleAlert size={20} /><span>Важных</span><strong>{news.data?.filter((item) => item.published && item.important).length ?? 0}</strong></article>
      </section>

      <section className={styles.listPanel}>
        <div className={styles.listHeading}><div><strong>Все публикации</strong><small>Новые и изменённые публикации снова считаются непрочитанными</small></div><button type="button" onClick={() => news.refetch()} disabled={news.isFetching} aria-label="Обновить"><RefreshCw size={17} /></button></div>
        {news.isPending ? <div className={styles.state}><RefreshCw className={styles.spin} />Загружаю новости…</div> : null}
        {news.isError ? <div className={styles.state}><CircleAlert /><span>Не удалось получить новости.<small>{getErrorText(news.error)}</small></span><button type="button" onClick={() => news.refetch()}>Повторить</button></div> : null}
        {news.isSuccess && !news.data.length ? <div className={styles.empty}><Megaphone size={32} /><strong>Новостей пока нет</strong><span>Создайте первую публикацию для сотрудников CRM.</span><button type="button" onClick={openCreate}>Добавить новость</button></div> : null}
        {news.data?.map((item) => (
          <article className={styles.newsItem} key={item.id}>
            <div className={`${styles.itemMark} ${item.important ? styles.importantMark : ""}`}><Megaphone size={19} /></div>
            <div className={styles.itemBody}>
              <div className={styles.itemTitle}><strong>{item.title}</strong>{item.important ? <em>Важная</em> : null}<span className={item.published ? styles.published : styles.draft}>{item.published ? "Опубликована" : "Черновик"}</span></div>
              <p>{item.message}</p>
              <small>Изменено: {formatDate(item.updatedAt)}</small>
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={() => togglePublished(item)} disabled={updateNews.isPending}>{item.published ? "Снять" : "Опубликовать"}</button>
              <button type="button" onClick={() => openEdit(item)} aria-label="Редактировать"><Edit3 size={17} /></button>
              <button type="button" className={styles.delete} onClick={() => {
                if (window.confirm(`Удалить новость «${item.title}»?`)) deleteNews.mutate(item.id);
              }} disabled={deleteNews.isPending} aria-label="Удалить"><Trash2 size={17} /></button>
            </div>
          </article>
        ))}
      </section>

      {formOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={() => !busy && setFormOpen(false)}>
          <form className={styles.modal} onSubmit={(event) => {
            event.preventDefault();
            if (editingId) updateNews.mutate({ id: editingId, ...form });
            else createNews.mutate(form);
          }} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><p>{editingId ? "Редактирование" : "Новая публикация"}</p><h2>{editingId ? "Изменить новость" : "Добавить новость"}</h2></div><button type="button" onClick={() => setFormOpen(false)} disabled={busy} aria-label="Закрыть"><X size={20} /></button></header>
            <label><span>Заголовок</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} maxLength={120} required autoFocus /><small>{form.title.length}/120</small></label>
            <label><span>Текст новости</span><textarea value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} maxLength={4000} rows={8} required /><small>{form.message.length}/4000</small></label>
            <div className={styles.checks}>
              <label><input type="checkbox" checked={form.important} onChange={(event) => setForm((current) => ({ ...current, important: event.target.checked }))} /><span>Важная новость</span></label>
              <label><input type="checkbox" checked={form.published} onChange={(event) => setForm((current) => ({ ...current, published: event.target.checked }))} /><span>Опубликовать сразу</span></label>
            </div>
            <footer><button type="button" onClick={() => setFormOpen(false)} disabled={busy}>Отмена</button><button type="submit" disabled={busy || !form.title.trim() || !form.message.trim()}>{busy ? "Сохраняю…" : editingId ? "Сохранить" : "Создать новость"}</button></footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
