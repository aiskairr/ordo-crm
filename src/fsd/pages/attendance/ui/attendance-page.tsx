"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Download, RefreshCw, UserCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/src/fsd/widgets/app-shell";
import { AuthRequired, StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText, isUnauthorizedError } from "@/src/fsd/shared/lib/errors";
import {
  getAttendanceReport,
  getAttendanceStatus,
  getCrmSession,
  manualAttendanceMark,
  saveAttendanceSchedule,
  type AttendanceBranchSchedule,
} from "../api/attendance-api";
import {
  canManageAttendance,
  canViewReports,
  exportAttendanceCsv,
  formatDateTime,
  formatDuration,
  formatNumber,
  recordWorkMinutes,
  todayIsoDate,
} from "../model/attendance-model";
import styles from "./attendance-page.module.css";

function useWorkTimer(checkInTime?: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!checkInTime) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [checkInTime]);

  if (!checkInTime) return 0;
  return Math.max(0, Math.floor((now - new Date(checkInTime).getTime()) / 60000));
}

export function AttendancePage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [dateFrom, setDateFrom] = useState(todayIsoDate);
  const [dateTo, setDateTo] = useState(todayIsoDate);
  const [userId, setUserId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [actionError, setActionError] = useState(false);
  const [manualUserId, setManualUserId] = useState("");
  const [manualStoreId, setManualStoreId] = useState("");
  const [manualDate, setManualDate] = useState(todayIsoDate);
  const [manualTime, setManualTime] = useState("09:00");
  const [scheduleDraft, setScheduleDraft] = useState<{ workStartsAt: string; workEndsAt: string; branches: AttendanceBranchSchedule[] } | null>(null);

  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getCrmSession });
  const statusQuery = useQuery({ queryKey: ["attendance-status"], queryFn: getAttendanceStatus });
  const reportQuery = useQuery({
    queryKey: ["attendance-report", dateFrom, dateTo, userId, storeId],
    queryFn: () => getAttendanceReport({ dateFrom, dateTo, userId, storeId }),
    enabled: Boolean(sessionQuery.data?.user),
  });

  const currentUser = sessionQuery.data?.user ?? null;
  const working = statusQuery.data?.status === "working";
  const managerView = canViewReports(currentUser);
  const adminView = canManageAttendance(currentUser);
  const workMinutes = useWorkTimer(working ? statusQuery.data?.openRecord?.checkInTime : undefined);
  const report = reportQuery.data;
  const uniqueUsers = useMemo(() => {
    const seen = new Set<string>();
    return (report?.users ?? []).filter((user) => {
      const key = (user.login || user.name || user.id).trim().toLocaleLowerCase("ru-RU");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [report?.users]);
  const schedule = scheduleDraft ?? report?.schedule ?? { workStartsAt: "09:00", workEndsAt: "18:00", branches: [] };
  const branchOptions = useMemo(() => {
    if (schedule.branches.length) {
      return schedule.branches.map((branch) => ({ id: branch.key, name: branch.label }));
    }
    return [
      { id: "ayu-grand", name: "Аю-Гранд" },
      { id: "besh-sary", name: "Беш-Сары" },
    ];
  }, [schedule.branches]);
  const selectedManualUserId = manualUserId || uniqueUsers[0]?.id || "";
  const selectedManualStoreId = manualStoreId || branchOptions[0]?.id || "";

  const invalidateAttendance = async () => {
    await queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
    await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    await queryClient.invalidateQueries({ queryKey: ["crm-session"] });
  };

  const scheduleMutation = useMutation({
    mutationFn: saveAttendanceSchedule,
    onSuccess: async (schedule) => {
      setScheduleDraft(schedule);
      showToast({ tone: "success", title: "График сохранен" });
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    },
  });

  const manualMarkMutation = useMutation({
    mutationFn: manualAttendanceMark,
    onSuccess: async () => {
      setActionError(false);
      setActionStatus("Отметка сотрудника сохранена.");
      showToast({ tone: "success", title: "Отметка сохранена" });
      await invalidateAttendance();
    },
    onError: (error) => {
      setActionError(true);
      setActionStatus(getErrorText(error));
      showToast({ tone: "error", title: "Не удалось сохранить отметку", description: getErrorText(error) });
    },
  });

  const totals = useMemo(
    () => [
      { label: "Записей", value: formatNumber(report?.totals.records ?? 0) },
      { label: "На работе", value: formatNumber(report?.totals.open ?? 0) },
      { label: "Отработано", value: formatDuration(report?.totals.totalWorkMinutes ?? 0) },
      { label: "Опозданий", value: formatDuration(report?.totals.lateMinutes ?? 0) },
    ],
    [report],
  );

  const hasLoadError = sessionQuery.error || statusQuery.error || reportQuery.error;

  useEffect(() => {
    if (hasLoadError && ![sessionQuery.error, statusQuery.error, reportQuery.error].some(isUnauthorizedError)) {
      showToast({ tone: "error", title: "Не удалось загрузить посещаемость", description: getErrorText(hasLoadError) });
    }
  }, [hasLoadError, reportQuery.error, sessionQuery.error, showToast, statusQuery.error]);

  useEffect(() => {
    if (scheduleMutation.error) {
      showToast({ tone: "error", title: "Не удалось сохранить график", description: getErrorText(scheduleMutation.error) });
    }
  }, [scheduleMutation.error, showToast]);

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <p>Геозона посещаемости</p>
            <h1>Посещаемость сотрудников</h1>
            <span>
              Кто на работе, сколько отработал, кто опоздал и во сколько менеджер отметил приход или уход по филиалу.
            </span>
          </div>
          <section className={styles.statusCard}>
            <span>Текущий статус</span>
            <strong>{statusQuery.isLoading ? "Загрузка..." : working ? "На работе" : "Не на работе"}</strong>
            <small>{working ? formatDuration(workMinutes) : "00:00"}</small>
          </section>
        </header>

        {hasLoadError && [sessionQuery.error, statusQuery.error, reportQuery.error].some(isUnauthorizedError) ? <AuthRequired /> : null}

        {managerView ? (
          <section className={styles.managerGrid}>
            <div className={styles.reportCard}>
              <div className={styles.sectionHead}>
                <div>
                  <p>Отчеты</p>
                  <h2>Смены сотрудников</h2>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={() => exportAttendanceCsv(report?.rows ?? [], dateFrom, dateTo)}>
                  <Download size={18} />
                  CSV
                </button>
              </div>
              <div className={styles.filters}>
                <label className={styles.field}>
                  <span>С даты</span>
                  <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>По дату</span>
                  <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>Сотрудник</span>
                  <select value={userId} onChange={(event) => setUserId(event.target.value)}>
                    <option value="">Все сотрудники</option>
                    {uniqueUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Филиал</span>
                  <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                    <option value="">Все филиалы</option>
                    {branchOptions.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => reportQuery.refetch()}>
                  <RefreshCw size={18} />
                  Обновить
                </button>
              </div>

              <div className={styles.totals}>
                {totals.map((item) => (
                  <article key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>

              <div className={styles.recordsList}>
                {reportQuery.isLoading ? <StatusPanel title="Загрузка отчета" /> : null}
                {!reportQuery.isLoading && !report?.rows.length ? <StatusPanel title="За выбранный период записей нет" /> : null}
                {(report?.rows ?? []).map((record) => (
                  <article key={record.id} className={styles.recordRow}>
                    <div>
                      <strong>{record.userName || "Сотрудник"}</strong>
                      <small>{record.storeName || "-"}</small>
                    </div>
                    <div>
                      <small>Приход</small>
                      <strong>{formatDateTime(record.checkInTime)}</strong>
                    </div>
                    <div>
                      <small>Уход</small>
                      <strong>{record.checkOutTime ? formatDateTime(record.checkOutTime) : "-"}</strong>
                    </div>
                    <div>
                      <small>Время</small>
                      <strong>{formatDuration(recordWorkMinutes(record))}</strong>
                    </div>
                    <div>
                      <small>Опоздание</small>
                      <strong>{record.lateMinutes ? formatDuration(record.lateMinutes) : "-"}</strong>
                    </div>
                    <span className={`${styles.badge} ${record.status === "closed" ? styles.closed : ""}`}>
                      {record.status === "open" ? "На работе" : "Закрыто"}
                    </span>
                  </article>
                ))}
              </div>
            </div>

            {adminView ? (
              <aside className={styles.adminCard}>
                <div className={styles.sectionHead}>
                  <div>
                    <p>Админ</p>
                    <h2>Филиалы</h2>
                  </div>
                </div>

                <section className={styles.scheduleBox}>
                  <div>
                    <p>График филиалов</p>
                    <span>По этому времени считаются опоздания и автоматический уход домой.</span>
                  </div>
                  {schedule.branches.map((branch, index) => (
                    <div key={branch.key || branch.label} className={styles.adminOpen}>
                      <label className={styles.field}>
                        <span>{branch.label}</span>
                        <input
                          type="time"
                          value={branch.workStartsAt}
                          onChange={(event) =>
                            setScheduleDraft((current) => ({
                              ...(current ?? schedule),
                              branches: (current?.branches ?? schedule.branches).map((item, itemIndex) =>
                                itemIndex === index ? { ...item, workStartsAt: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span>До</span>
                        <input
                          type="time"
                          value={branch.workEndsAt}
                          onChange={(event) =>
                            setScheduleDraft((current) => ({
                              ...(current ?? schedule),
                              branches: (current?.branches ?? schedule.branches).map((item, itemIndex) =>
                                itemIndex === index ? { ...item, workEndsAt: event.target.value } : item,
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <button type="button" onClick={() => scheduleMutation.mutate(schedule)} disabled={scheduleMutation.isPending}>
                    {scheduleMutation.isPending ? "Сохраняю..." : "Сохранить график"}
                  </button>
                </section>

                <div className={styles.adminOpen}>
                  <label className={styles.field}>
                    <span>Сотрудник</span>
                    <select value={selectedManualUserId} onChange={(event) => setManualUserId(event.target.value)}>
                      {uniqueUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Филиал</span>
                    <select value={selectedManualStoreId} onChange={(event) => setManualStoreId(event.target.value)}>
                      {branchOptions.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Дата</span>
                    <input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Время</span>
                    <input type="time" value={manualTime} onChange={(event) => setManualTime(event.target.value)} />
                  </label>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!selectedManualUserId || !selectedManualStoreId || manualMarkMutation.isPending}
                    onClick={() =>
                      manualMarkMutation.mutate({
                        userId: selectedManualUserId,
                        storeId: selectedManualStoreId,
                        action: "check_in",
                        timestamp: new Date(`${manualDate}T${manualTime}:00`).toISOString(),
                      })
                    }
                  >
                    <UserCheck size={18} />
                    Отметить приход
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!selectedManualUserId || !selectedManualStoreId || manualMarkMutation.isPending}
                    onClick={() =>
                      manualMarkMutation.mutate({
                        userId: selectedManualUserId,
                        storeId: selectedManualStoreId,
                        action: "check_out",
                        timestamp: new Date(`${manualDate}T${manualTime}:00`).toISOString(),
                      })
                    }
                  >
                    <Clock3 size={18} />
                    Отметить уход
                  </button>
                </div>
                {actionStatus ? <strong className={actionError ? styles.errorText : ""}>{actionStatus}</strong> : null}
              </aside>
            ) : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
