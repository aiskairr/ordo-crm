"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, LoaderCircle, RotateCcw, X } from "lucide-react";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getArchivedCrmEmployees, restoreArchivedCrmEmployee } from "../api/users-access-api";
import { BRANCHES } from "../model/users-access-model";
import styles from "./users-access-page.module.css";

export function ArchivedUsersDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const employeesQuery = useQuery({
    queryKey: ["archived-crm-employees"],
    queryFn: getArchivedCrmEmployees,
    retry: false,
  });
  const restoreMutation = useMutation({
    mutationFn: restoreArchivedCrmEmployee,
    onSuccess: async (_result, employeeHref) => {
      const employee = employeesQuery.data?.find((item) => item.href === employeeHref);
      showToast({ tone: "success", title: `Сотрудник «${employee?.name || ""}» восстановлен` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["archived-crm-employees"] }),
        queryClient.invalidateQueries({ queryKey: ["crm-users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    },
    onError: (error) => {
      showToast({ tone: "error", title: "Не удалось восстановить сотрудника", description: getErrorText(error) });
    },
  });

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => { if (!restoreMutation.isPending) onClose(); }}>
      <section
        aria-labelledby="archived-users-title"
        aria-modal="true"
        className={`${styles.modal} ${styles.archiveModal}`}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <span className={styles.archiveIcon}><ArchiveRestore size={22} /></span>
            <div>
              <h2 id="archived-users-title">Архивные сотрудники</h2>
              <p>Сотрудники МойСклад с пометкой CRM delete.</p>
            </div>
          </div>
          <button className={styles.modalClose} type="button" onClick={onClose} disabled={restoreMutation.isPending} aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>

        {employeesQuery.isLoading ? (
          <div className={styles.modalLoading}><LoaderCircle className={styles.spin} size={20} /> Загружаем архив...</div>
        ) : null}
        {employeesQuery.error ? <div className={styles.modalError}>{getErrorText(employeesQuery.error)}</div> : null}

        {!employeesQuery.isLoading && !employeesQuery.error ? (
          <div className={styles.archiveList}>
            {employeesQuery.data?.map((employee) => {
              const restoring = restoreMutation.isPending && restoreMutation.variables === employee.href;
              const branches = employee.branchIds
                .map((branch) => branch in BRANCHES ? BRANCHES[branch as keyof typeof BRANCHES] : branch)
                .join(", ");
              return (
                <article className={styles.archiveEmployee} key={employee.href}>
                  <div>
                    <h3>{employee.name}</h3>
                    <p>{branches || "Филиал не определён"}</p>
                    <small>{employee.description || "CRM delete"}</small>
                  </div>
                  <button
                    className={styles.restoreButton}
                    type="button"
                    disabled={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(employee.href)}
                  >
                    {restoring ? <LoaderCircle className={styles.spin} size={17} /> : <RotateCcw size={17} />}
                    {restoring ? "Возвращаем..." : "Вернуть"}
                  </button>
                </article>
              );
            })}
            {!employeesQuery.data?.length ? (
              <div className={styles.archiveEmpty}>
                <ArchiveRestore size={28} />
                <strong>Архив пуст</strong>
                <span>Сотрудников с пометкой CRM delete нет.</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
