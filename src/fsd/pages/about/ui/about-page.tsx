"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { getLoginUsers, getSession, loginCrm } from "../api/about-api";
import styles from "./about-page.module.css";
import { useEffect, useState } from "react";

export function AboutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getSession });
  const loginUsersQuery = useQuery({ queryKey: ["crm-login-users"], queryFn: getLoginUsers });
  const sessionUser = sessionQuery.data?.user ?? null;
  const users = loginUsersQuery.data ?? [];
  const selectedLogin = login || users.find((user) => user.passwordSet)?.id || users[0]?.id || "";

  const loginMutation = useMutation({
    mutationFn: loginCrm,
    onSuccess: async () => {
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["crm-session"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
      router.replace("/sales");
    },
  });

  useEffect(() => {
    if (!sessionUser) return;
    router.replace("/sales");
  }, [router, sessionUser]);

  useEffect(() => {
    if (loginMutation.error) {
      showToast({ tone: "error", title: "Не удалось войти", description: getErrorText(loginMutation.error) });
    }
  }, [loginMutation.error, showToast]);

  useEffect(() => {
    if (sessionQuery.error) {
      showToast({ tone: "error", title: "Сессия недоступна", description: getErrorText(sessionQuery.error) });
    }
  }, [sessionQuery.error, showToast]);

  useEffect(() => {
    if (loginUsersQuery.error) {
      showToast({ tone: "error", title: "Сотрудники недоступны", description: getErrorText(loginUsersQuery.error) });
    }
  }, [loginUsersQuery.error, showToast]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <Image src="/ordo-logo.svg" alt="Ordo CRM" width={156} height={54} priority />
        </Link>
      </header>

      <section className={styles.hero}>
        <aside className={styles.loginPanel}>
          {sessionUser ? (
            <StatusPanel title="Вы уже вошли" description="Перенаправляю в рабочий раздел." />
          ) : (
            <form
              className={styles.loginForm}
              onSubmit={(event) => {
                event.preventDefault();
                loginMutation.mutate({ login: selectedLogin, password });
              }}
            >
              <div>
                <p>Ordo CRM</p>
                <h1>Вход в систему</h1>
              </div>
              <label>
                <span>Сотрудник</span>
                <select value={selectedLogin} id="login" onChange={(event) => setLogin(event.target.value)} disabled={loginUsersQuery.isLoading || !users.length}>
                  {loginUsersQuery.isLoading ? <option value="">Загружаю...</option> : null}
                  {!loginUsersQuery.isLoading && !users.length ? <option value="">Сотрудники не найдены</option> : null}
                  {users.map((user) => (
                    <option key={user.id} value={user.id} disabled={!user.passwordSet}>
                      {user.name || user.login || user.id}
                      {user.passwordSet ? "" : " (пароль не задан)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Пароль</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </label>
              <button type="submit" disabled={!selectedLogin || !password || loginMutation.isPending}>
                {loginMutation.isPending ? "Вхожу..." : "Войти в CRM"}
              </button>
            </form>
          )}
        </aside>
      </section>
    </main>
  );
}
