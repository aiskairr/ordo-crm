"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { logoutSuperAdmin, type SuperAdminSession } from "../api/super-admin-auth-api";
import styles from "./super-admin-home.module.css";

export function SuperAdminHome({ session }: { session: SuperAdminSession }) {
  const router = useRouter();
  const { showToast } = useToast();
  const logoutMutation = useMutation({
    mutationFn: logoutSuperAdmin,
    onSuccess: () => {
      router.replace("/super-admin/login");
      router.refresh();
    },
    onError: (error) => {
      showToast({
        tone: "error",
        title: "Не удалось завершить сессию",
        description: getErrorText(error),
      });
    },
  });

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p>ORDO CRM</p>
        <h1>Super Admin</h1>
        <span>Авторизация настроена. Административные модули будут добавляться отдельными этапами.</span>
        <dl>
          <div>
            <dt>Текущая сессия</dt>
            <dd>{session.login}</dd>
          </div>
        </dl>
        <button type="button" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
          {logoutMutation.isPending ? "Выходим..." : "Выйти"}
        </button>
      </section>
    </main>
  );
}
