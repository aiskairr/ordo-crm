import styles from "./status.module.css";

type StatusTone = "default" | "error" | "success";

export function StatusPanel({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description?: string;
  tone?: StatusTone;
}) {
  return (
    <div className={`${styles.panel} ${styles[tone]}`}>
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}

export function AuthRequired({
  title = "Нужно войти в систему",
  description = "Сессия не найдена или истекла. Откройте старую CRM и авторизуйтесь снова.",
}: {
  title?: string;
  description?: string;
} = {}) {
  return (
    <StatusPanel
      tone="error"
      title={title}
      description={description}
    />
  );
}
