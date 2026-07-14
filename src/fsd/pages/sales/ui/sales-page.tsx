"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { AppShell } from "@/src/fsd/widgets/app-shell";
import { SaleComposer } from "@/src/fsd/widgets/sale-composer";
import { AuthRequired, StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText, isUnauthorizedError } from "@/src/fsd/shared/lib/errors";
import { getEmployees, getPaymentTypes, getRetailStores, getSalesConfig, getSalesSession } from "../api/sales-api";
import styles from "./sales-page.module.css";

export function SalesPage({ mode = "sales" }: { mode?: "sales" | "debt" }) {
  const { showToast } = useToast();
  const configQuery = useQuery({ queryKey: ["sales-config"], queryFn: getSalesConfig });
  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getSalesSession });
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: getEmployees });
  const storesQuery = useQuery({ queryKey: ["retail-stores"], queryFn: getRetailStores });
  const paymentTypesQuery = useQuery({ queryKey: ["payment-types"], queryFn: getPaymentTypes });

  const queries = [configQuery, sessionQuery, employeesQuery, storesQuery, paymentTypesQuery];
  const isLoading = queries.some((query) => query.isLoading);
  const unauthorizedError = queries.find((query) => query.error && isUnauthorizedError(query.error))?.error;
  const firstError = queries.find((query) => query.error)?.error;

  useEffect(() => {
    if (firstError && !unauthorizedError) {
      showToast({ tone: "error", title: "Не удалось загрузить данные для продаж", description: getErrorText(firstError) });
    }
  }, [firstError, showToast, unauthorizedError]);

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerCopy}>
            <span className={styles.eyebrow}>{mode === "debt" ? "Отдельный режим" : "Продажи и оформление"}</span>
            <h1>{mode === "debt" ? "Продать в долг" : "Продажи"}</h1>
            <p>{mode === "debt" ? "Создание отгрузки с задолженностью клиента и возможной предоплатой." : "Создание документа продажи, оплата, клиент, доставка и черновик."}</p>
          </div>
          <div className={styles.headerActions}>
            <Link href={mode === "debt" ? "/sales" : "/debt-sale"} className={styles.modeLink}>
              {mode === "debt" ? "Обычная продажа" : "Продать в долг"}
            </Link>
          </div>
        </header>

        {isLoading ? <StatusPanel title="Загрузка данных" description="Получаем товары, клиентов и справочники." /> : null}
        {unauthorizedError ? <AuthRequired /> : null}
        {!isLoading && !firstError ? (
          <SaleComposer
            config={configQuery.data ?? { branches: [], employees: [] }}
            employees={employeesQuery.data ?? []}
            currentUser={sessionQuery.data?.user ?? null}
            retailStores={storesQuery.data ?? []}
            paymentTypes={paymentTypesQuery.data ?? []}
            products={[]}
            customers={[]}
            mode={mode}
          />
        ) : null}
      </div>
      <div>
        <span ></span>
      </div>
    </AppShell>
  );
}
