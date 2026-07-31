"use client";

import { AlertTriangle, ArrowRight, LoaderCircle, Trash2, X } from "lucide-react";
import type { CrmUser } from "@/src/fsd/entities/user";
import type { EmployeeDeletionImpact } from "../api/users-access-api";
import type { UsersAccessDraft } from "../model/users-access-model";
import styles from "./users-access-page.module.css";

type DeleteUserDialogProps = {
  source: UsersAccessDraft;
  targets: CrmUser[];
  impact?: EmployeeDeletionImpact;
  loadingImpact: boolean;
  running: boolean;
  progress: string;
  error: string;
  selectedTargetId: string;
  onSelectTarget: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteUserDialog({
  source,
  targets,
  impact,
  loadingImpact,
  running,
  progress,
  error,
  selectedTargetId,
  onSelectTarget,
  onClose,
  onConfirm,
}: DeleteUserDialogProps) {
  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const cannotContinue = loadingImpact || running || !impact || !selectedTarget;

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => { if (!running) onClose(); }}>
      <section
        aria-labelledby="delete-user-title"
        aria-modal="true"
        className={styles.modal}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <span className={styles.modalDangerIcon}><AlertTriangle size={22} /></span>
            <div>
              <h2 id="delete-user-title">Удалить сотрудника навсегда</h2>
              <p>Продажи сотрудника «{source.name}» будут перенесены перед удалением.</p>
            </div>
          </div>
          <button className={styles.modalClose} type="button" onClick={onClose} disabled={running} aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>

        {loadingImpact ? (
          <div className={styles.modalLoading}><LoaderCircle className={styles.spin} size={20} /> Проверяем связанные документы...</div>
        ) : impact ? (
          <div className={styles.impactGrid}>
            <article><span>Отгрузки</span><strong>{impact.counts.demand}</strong></article>
            <article><span>Розничные продажи</span><strong>{impact.counts.retaildemand}</strong></article>
            <article className={styles.impactTotal}><span>Всего документов</span><strong>{impact.total}</strong></article>
          </div>
        ) : null}

        <label className={styles.modalField}>
          <span>На кого перенести продажи</span>
          <select value={selectedTargetId} onChange={(event) => onSelectTarget(event.target.value)} disabled={running || !targets.length}>
            <option value="">Выберите главного администратора</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>{target.name}</option>
            ))}
          </select>
        </label>

        {!targets.length ? (
          <div className={styles.modalError}>Нет активного admin или owner, привязанного к сотруднику МойСклад.</div>
        ) : null}
        {impact?.unconfigured.length ? (
          <div className={styles.modalWarning}>Для части типов документов не настроено поле сотрудника. Окончательное удаление будет выполнено только если МойСклад его разрешит.</div>
        ) : null}
        {progress ? <div className={styles.modalProgress}><LoaderCircle className={running ? styles.spin : ""} size={18} /> {progress}</div> : null}
        {error ? <div className={styles.modalError}>{error}</div> : null}

        <div className={styles.modalNotice}>
          <ArrowRight size={18} />
          <span>Выручка, прибыль и зарплатная статистика этих документов перейдут к выбранному администратору. Суммы, товары, оплаты и клиенты не изменятся.</span>
        </div>

        <footer className={styles.modalActions}>
          <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={running}>Отмена</button>
          <button className={styles.dangerButton} type="button" onClick={onConfirm} disabled={cannotContinue}>
            {running ? <LoaderCircle className={styles.spin} size={17} /> : <Trash2 size={17} />}
            {running ? "Переносим документы..." : "Перенести и удалить"}
          </button>
        </footer>
      </section>
    </div>
  );
}
