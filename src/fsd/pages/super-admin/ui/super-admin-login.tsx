"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { loginSuperAdmin } from "@/src/fsd/features/super-admin-auth";
import styles from "./super-admin-login.module.css";

export function SuperAdminLogin() {
  const router = useRouter();
  const { showToast } = useToast();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: loginSuperAdmin,
    onSuccess: () => {
      setPassword("");
      router.replace("/super-admin");
      router.refresh();
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось войти", description: getErrorText(error) }),
  });

  return (
    <main className={styles.page}>
      <section className={styles.presentation}>
        <div className={styles.logo}><ShieldCheck size={25} /></div>
        <p>ORDO CONTROL</p>
        <h2>Управление системой начинается здесь.</h2>
        <span>Отдельный защищённый контур владельца. Сессии и права сотрудников CRM в эту панель не переносятся.</span>
        <div className={styles.security}><LockKeyhole size={17} /><span>Изолированная авторизация</span></div>
      </section>
      <section className={styles.card}>
        <p>Вход владельца</p>
        <h1>Super Admin</h1>
        <span>Введите отдельные данные Super Admin из серверного окружения.</span>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            loginMutation.mutate({ login, password });
          }}
        >
          <label className={styles.field}>
            <strong>Логин</strong>
            <input
              name="login"
              value={login}
              onChange={(event) => setLogin(event.target.value)}
              autoComplete="username"
              maxLength={200}
              required
              autoFocus
            />
          </label>
          <label className={styles.field}>
            <strong>Пароль</strong>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={500}
              required
            />
          </label>
          <button type="submit" className={styles.submit} disabled={!login || !password || loginMutation.isPending}>
            {loginMutation.isPending ? "Проверяю..." : "Войти"}
          </button>
        </form>
        <small className={styles.hint}>Доступ защищён HttpOnly-сессией. Пароль не сохраняется в браузере.</small>
      </section>
    </main>
  );
}
