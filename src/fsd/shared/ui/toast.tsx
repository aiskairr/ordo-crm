"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import styles from "./toast.module.css";

type ToastTone = "default" | "error" | "success";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
};

type Toast = ToastInput & {
  id: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((toast: ToastInput) => {
    const id = crypto.randomUUID();
    const nextToast: Toast = {
      id,
      title: toast.title,
      description: toast.description,
      tone: toast.tone ?? "default",
    };

    setToasts((current) => [nextToast, ...current].slice(0, 5));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.viewport} aria-live="polite" aria-label="Уведомления">
        {toasts.map((toast) => (
          <section key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
            <strong>{toast.title}</strong>
            {toast.description ? <span>{toast.description}</span> : null}
          </section>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
