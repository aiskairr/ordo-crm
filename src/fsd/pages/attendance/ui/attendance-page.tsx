"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Download, RefreshCw, Save, Trash2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/src/fsd/widgets/app-shell";
import { AttendanceSelfieButton } from "@/src/fsd/features/attendance-selfie";
import { AuthRequired, StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { getErrorText, isUnauthorizedError } from "@/src/fsd/shared/lib/errors";
import {
  getAttendanceReport,
  getAttendanceNetworkSettings,
  getAttendanceNetworkStatus,
  getAttendanceStatus,
  getCrmSession,
  closeAttendanceShift,
  createAttendanceCalendarEntry,
  deleteAttendanceCalendarEntry,
  openAttendanceShift,
  saveAttendanceNetworkSettings,
  saveAttendanceSchedule,
  type AttendanceBranchSchedule,
  type AttendanceCalendarKind,
} from "../api/attendance-api";
import {
  canManageAttendance,
  canViewReports,
  currentWeekIsoRange,
  exportAttendanceCsv,
  formatDateTime,
  formatDuration,
  formatNumber,
  isAttendanceRequiredForUser,
} from "../model/attendance-model";
import { AttendanceTimesheet } from "./attendance-timesheet";
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

function normalizedBranchForUi(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, "-");
  if (normalized.includes("беш") || normalized.includes("besh")) return "besh";
  if (normalized.includes("аю") || normalized.includes("ayu")) return "ayu";
  return normalized;
}

export function AttendancePage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const [dateFrom, setDateFrom] = useState(() => currentWeekIsoRange().dateFrom);
  const [dateTo, setDateTo] = useState(() => currentWeekIsoRange().dateTo);
  const [userId, setUserId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [shiftActionStatus, setShiftActionStatus] = useState("");
  const [shiftActionError, setShiftActionError] = useState(false);
  const [networkSettingsDraft, setNetworkSettingsDraft] = useState<{ ayu: string; besh: string } | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<{ workStartsAt: string; workEndsAt: string; branches: AttendanceBranchSchedule[] } | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<{
    kind: AttendanceCalendarKind;
    dateFrom: string;
    dateTo: string;
    userId: string;
    storeId: string;
    title: string;
    workEndsAt: string;
  }>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { kind: "holiday", dateFrom: today, dateTo: today, userId: "", storeId: "", title: "", workEndsAt: "16:00" };
  });

  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getCrmSession });
  const statusQuery = useQuery({ queryKey: ["attendance-status"], queryFn: getAttendanceStatus });
  const networkQuery = useQuery({
    queryKey: ["attendance-network-status"],
    queryFn: getAttendanceNetworkStatus,
    enabled: Boolean(sessionQuery.data?.user && statusQuery.data?.dayStatus?.workingDay !== false),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const reportQuery = useQuery({
    queryKey: ["attendance-report", dateFrom, dateTo, userId, storeId],
    queryFn: () => getAttendanceReport({ dateFrom, dateTo, userId, storeId }),
    enabled: Boolean(sessionQuery.data?.user),
  });

  const currentUser = sessionQuery.data?.user ?? null;
  const working = statusQuery.data?.status === "working";
  const managerView = canViewReports(currentUser);
  const adminView = canManageAttendance(currentUser);
  const attendanceRequired = isAttendanceRequiredForUser(currentUser);
  const attendanceDayOff = statusQuery.data?.dayStatus?.workingDay === false;
  const networkSettingsQuery = useQuery({
    queryKey: ["attendance-network-settings"],
    queryFn: getAttendanceNetworkSettings,
    enabled: adminView,
  });
  const effectiveNetworkSettingsDraft = networkSettingsDraft ?? {
    ayu: networkSettingsQuery.data?.ayu.join(", ") || "",
    besh: networkSettingsQuery.data?.besh.join(", ") || "",
  };
  const workMinutes = useWorkTimer(working ? statusQuery.data?.openRecord?.checkInTime : undefined);
  const networkStatus = networkQuery.data;
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

  const invalidateAttendance = async () => {
    await queryClient.invalidateQueries({ queryKey: ["attendance-status"] });
    await queryClient.invalidateQueries({ queryKey: ["attendance-network-status"] });
    await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    await queryClient.invalidateQueries({ queryKey: ["crm-session"] });
  };

  const openShiftMutation = useMutation({
    mutationFn: openAttendanceShift,
    onSuccess: async (result) => {
      setShiftActionError(false);
      setShiftActionStatus(result.message || "Смена открыта.");
      showToast({ tone: "success", title: "Смена открыта", description: result.store.name });
      await invalidateAttendance();
    },
    onError: (error) => {
      setShiftActionError(true);
      setShiftActionStatus(getErrorText(error));
      showToast({ tone: "error", title: "Не удалось открыть смену", description: getErrorText(error) });
      void networkQuery.refetch();
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: closeAttendanceShift,
    onSuccess: async (result) => {
      setShiftActionError(false);
      setShiftActionStatus(result.message || "Смена закрыта.");
      showToast({ tone: "success", title: "Смена закрыта" });
      await invalidateAttendance();
    },
    onError: (error) => {
      setShiftActionError(true);
      setShiftActionStatus(getErrorText(error));
      showToast({ tone: "error", title: "Не удалось закрыть смену", description: getErrorText(error) });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: saveAttendanceSchedule,
    onSuccess: async (schedule) => {
      setScheduleDraft(schedule);
      showToast({ tone: "success", title: "График сохранен" });
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    },
  });

  const networkSettingsMutation = useMutation({
    mutationFn: () => saveAttendanceNetworkSettings({
      ayu: effectiveNetworkSettingsDraft.ayu.split(/[\s,;]+/).filter(Boolean),
      besh: effectiveNetworkSettingsDraft.besh.split(/[\s,;]+/).filter(Boolean),
    }),
    onSuccess: async (settings) => {
      setNetworkSettingsDraft({ ayu: settings.ayu.join(", "), besh: settings.besh.join(", ") });
      showToast({ tone: "success", title: "IP офисов сохранены" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["attendance-network-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["attendance-network-status"] }),
      ]);
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить IP", description: getErrorText(error) }),
  });

  const calendarMutation = useMutation({
    mutationFn: createAttendanceCalendarEntry,
    onSuccess: async () => {
      setCalendarDraft((current) => ({ ...current, title: "" }));
      showToast({ tone: "success", title: "День добавлен в табель" });
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось сохранить день", description: getErrorText(error) }),
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: deleteAttendanceCalendarEntry,
    onSuccess: async () => {
      showToast({ tone: "success", title: "Запись календаря удалена" });
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    },
    onError: (error) => showToast({ tone: "error", title: "Не удалось удалить запись", description: getErrorText(error) }),
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

  const hasLoadError = sessionQuery.error || statusQuery.error || networkQuery.error || reportQuery.error;

  useEffect(() => {
    if (hasLoadError && ![sessionQuery.error, statusQuery.error, networkQuery.error, reportQuery.error].some(isUnauthorizedError)) {
      showToast({ tone: "error", title: "Не удалось загрузить посещаемость", description: getErrorText(hasLoadError) });
    }
  }, [hasLoadError, networkQuery.error, reportQuery.error, sessionQuery.error, showToast, statusQuery.error]);

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

        {hasLoadError && [sessionQuery.error, statusQuery.error, networkQuery.error, reportQuery.error].some(isUnauthorizedError) ? <AuthRequired /> : null}

        {attendanceRequired && attendanceDayOff ? (
          <StatusPanel
            tone="success"
            title={`${statusQuery.data?.dayStatus.code || "В"} · ${statusQuery.data?.dayStatus.label || "Сегодня нерабочий день"}`}
            description="Открывать смену сегодня не требуется. Этот день не будет считаться прогулом или опозданием."
          />
        ) : null}

        {attendanceRequired && !attendanceDayOff ? (
          <section className={styles.shiftPrompt}>
            <div className={styles.shiftIcon}>
              {working || networkStatus?.allowed ? <Wifi size={34} /> : <WifiOff size={34} />}
            </div>
            <p>Моя смена</p>
            <h2>{working ? "Смена открыта" : networkQuery.isLoading ? "Проверяем офисный Wi‑Fi…" : networkStatus?.allowed ? "Можно открыть смену" : "Подключитесь к офисному Wi‑Fi"}</h2>
            <span>
              {working
                ? `${statusQuery.data?.openRecord?.storeName || "Филиал"} · открыта ${formatDateTime(statusQuery.data?.openRecord?.checkInTime || "")}`
                : networkStatus?.message || "Проверяем подключение и доступ к филиалу."}
            </span>
            {!working && networkStatus ? (
              <div className={`${styles.zonePanel} ${networkStatus.allowed ? styles.zoneAllowed : styles.zoneDenied}`}>
                {networkStatus.allowed ? <Wifi size={26} /> : <WifiOff size={26} />}
                <div>
                  <strong>{networkStatus.branchName || "Офисная сеть не обнаружена"}</strong>
                  <span>IP: {networkStatus.clientIp || "не определён"}{networkStatus.configured ? " · строгая проверка включена" : " · проверка ещё не настроена"}</span>
                </div>
              </div>
            ) : null}
            <div className={styles.actions}>
              {working ? (
                <AttendanceSelfieButton
                  action="close"
                  className={styles.dangerButton}
                  pending={closeShiftMutation.isPending}
                  onCapture={(selfie) => closeShiftMutation.mutate(selfie)}
                />
              ) : (
                <>
                  <button type="button" className={styles.secondaryButton} onClick={() => networkQuery.refetch()} disabled={networkQuery.isFetching}>
                    <RefreshCw size={18} />
                    {networkQuery.isFetching ? "Проверяем…" : "Проверить Wi‑Fi"}
                  </button>
                  <AttendanceSelfieButton
                    action="open"
                    disabled={networkQuery.isLoading || !networkStatus?.allowed}
                    pending={openShiftMutation.isPending}
                    onCapture={(selfie) => openShiftMutation.mutate(selfie)}
                  />
                </>
              )}
            </div>
            {shiftActionStatus ? <strong className={shiftActionError ? styles.errorText : ""}>{shiftActionStatus}</strong> : null}
          </section>
        ) : null}

        {managerView ? (
          <section className={styles.managerGrid}>
            <div className={styles.reportCard}>
              <div className={styles.sectionHead}>
                <div>
                  <p>Отчеты</p>
                  <h2>Табель сотрудников</h2>
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

              {reportQuery.isLoading ? <StatusPanel title="Загрузка табеля" /> : null}
              {!reportQuery.isLoading ? (
                <AttendanceTimesheet
                  users={userId ? uniqueUsers.filter((user) => user.id === userId) : uniqueUsers}
                  records={report?.rows ?? []}
                  calendar={report?.calendar ?? []}
                  schedules={schedule.branches}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                />
              ) : null}
            </div>

            {adminView ? (
              <aside className={styles.adminCard}>
                <div className={styles.sectionHead}>
                  <div>
                    <p>Админ</p>
                    <h2>Настройки посещаемости</h2>
                  </div>
                </div>

                <section className={styles.networkSettings}>
                  <div>
                    <p>Разрешённые внешние IP</p>
                    <span>Укажите публичный IP офисного Wi‑Fi. Несколько адресов разделяйте запятыми.</span>
                  </div>
                  <div className={styles.currentIp}>
                    <span>Текущий внешний IP</span>
                    <strong>{networkSettingsQuery.isLoading ? "Определяем…" : networkSettingsQuery.data?.currentIp || "Не определён"}</strong>
                  </div>
                  <label className={styles.field}>
                    <span>Аю-Гранд</span>
                    <input value={effectiveNetworkSettingsDraft.ayu} onChange={(event) => setNetworkSettingsDraft({ ...effectiveNetworkSettingsDraft, ayu: event.target.value })} placeholder="Например: 123.45.67.89" />
                  </label>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!networkSettingsQuery.data?.currentIp}
                    onClick={() => setNetworkSettingsDraft({ ...effectiveNetworkSettingsDraft, ayu: networkSettingsQuery.data?.currentIp || effectiveNetworkSettingsDraft.ayu })}
                  >
                    Использовать текущий IP для Аю
                  </button>
                  <label className={styles.field}>
                    <span>Беш-Сары</span>
                    <input value={effectiveNetworkSettingsDraft.besh} onChange={(event) => setNetworkSettingsDraft({ ...effectiveNetworkSettingsDraft, besh: event.target.value })} placeholder="Например: 98.76.54.32" />
                  </label>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={!networkSettingsQuery.data?.currentIp}
                    onClick={() => setNetworkSettingsDraft({ ...effectiveNetworkSettingsDraft, besh: networkSettingsQuery.data?.currentIp || effectiveNetworkSettingsDraft.besh })}
                  >
                    Использовать текущий IP для Беш
                  </button>
                  <button type="button" onClick={() => networkSettingsMutation.mutate()} disabled={networkSettingsMutation.isPending}>
                    <Save size={18} />
                    {networkSettingsMutation.isPending ? "Сохраняем…" : "Сохранить IP"}
                  </button>
                  {networkSettingsQuery.error ? <strong className={styles.errorText}>{getErrorText(networkSettingsQuery.error)}</strong> : null}
                </section>

                <section className={styles.scheduleBox}>
                  <div>
                    <p>График филиалов</p>
                    <span>По этому времени считаются опоздания и автоматический уход домой.</span>
                  </div>
                  {schedule.branches.map((branch, index) => (
                    <div key={branch.key || branch.label} className={styles.scheduleBranch}>
                      <div className={styles.adminOpen}>
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
                      <div className={styles.workDays}>
                        {[
                          [1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [7, "Вс"],
                        ].map(([day, label]) => (
                          <label key={day}>
                            <input
                              type="checkbox"
                              checked={branch.workDays.includes(Number(day))}
                              onChange={(event) => setScheduleDraft((current) => ({
                                ...(current ?? schedule),
                                branches: (current?.branches ?? schedule.branches).map((item, itemIndex) => itemIndex === index
                                  ? {
                                      ...item,
                                      workDays: event.target.checked
                                        ? [...new Set([...item.workDays, Number(day)])].sort((left, right) => left - right)
                                        : item.workDays.filter((value) => value !== Number(day)),
                                    }
                                  : item),
                              }))}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => scheduleMutation.mutate(schedule)} disabled={scheduleMutation.isPending}>
                    {scheduleMutation.isPending ? "Сохраняю..." : "Сохранить график"}
                  </button>
                </section>

                <section className={styles.calendarBox}>
                  <div>
                    <p>Календарь табеля</p>
                    <span>Праздники, выходные, отгулы и сокращённые дни не считаются обычным отсутствием.</span>
                  </div>
                  <label className={styles.field}>
                    <span>Тип дня</span>
                    <select value={calendarDraft.kind} onChange={(event) => setCalendarDraft({ ...calendarDraft, kind: event.target.value as AttendanceCalendarKind, userId: "", storeId: "" })}>
                      <option value="holiday">П — государственный праздник</option>
                      <option value="day_off">В — выходной</option>
                      <option value="leave">ОТ — согласованный отгул</option>
                      <option value="short_day">СД — сокращённый день</option>
                    </select>
                  </label>
                  <div className={styles.adminOpen}>
                    <label className={styles.field}>
                      <span>С даты</span>
                      <input type="date" value={calendarDraft.dateFrom} onChange={(event) => setCalendarDraft({ ...calendarDraft, dateFrom: event.target.value, dateTo: calendarDraft.dateTo < event.target.value ? event.target.value : calendarDraft.dateTo })} />
                    </label>
                    <label className={styles.field}>
                      <span>По дату</span>
                      <input type="date" min={calendarDraft.dateFrom} value={calendarDraft.dateTo} onChange={(event) => setCalendarDraft({ ...calendarDraft, dateTo: event.target.value })} />
                    </label>
                  </div>
                  {calendarDraft.kind === "leave" ? (
                    <label className={styles.field}>
                      <span>Сотрудник</span>
                      <select value={calendarDraft.userId} onChange={(event) => setCalendarDraft({ ...calendarDraft, userId: event.target.value })}>
                        <option value="">Выберите сотрудника</option>
                        {uniqueUsers.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className={styles.field}>
                      <span>Филиал</span>
                      <select value={calendarDraft.storeId} onChange={(event) => setCalendarDraft({ ...calendarDraft, storeId: event.target.value })}>
                        <option value="">Все филиалы</option>
                        {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                      </select>
                    </label>
                  )}
                  {calendarDraft.kind === "short_day" ? (
                    <label className={styles.field}>
                      <span>Работа до</span>
                      <input type="time" value={calendarDraft.workEndsAt} onChange={(event) => setCalendarDraft({ ...calendarDraft, workEndsAt: event.target.value })} />
                    </label>
                  ) : null}
                  <label className={styles.field}>
                    <span>Причина или название</span>
                    <input value={calendarDraft.title} onChange={(event) => setCalendarDraft({ ...calendarDraft, title: event.target.value })} placeholder="Например: День независимости" />
                  </label>
                  <button type="button" onClick={() => calendarMutation.mutate(calendarDraft)} disabled={calendarMutation.isPending || (calendarDraft.kind === "leave" && !calendarDraft.userId)}>
                    <CalendarPlus size={18} />
                    {calendarMutation.isPending ? "Добавляю..." : "Добавить в табель"}
                  </button>
                  <div className={styles.calendarList}>
                    {(report?.calendar ?? []).map((entry) => {
                      const labels = { holiday: "П", day_off: "В", leave: "ОТ", short_day: "СД" };
                      const employee = uniqueUsers.find((item) => item.id === entry.userId);
                      const branch = branchOptions.find((item) => normalizedBranchForUi(item.id) === normalizedBranchForUi(entry.storeId));
                      return (
                        <article key={entry.id}>
                          <b>{labels[entry.kind]}</b>
                          <div>
                            <strong>{entry.title || (entry.kind === "leave" ? "Согласованный отгул" : entry.kind === "holiday" ? "Праздник" : entry.kind === "short_day" ? "Сокращённый день" : "Выходной")}</strong>
                            <span>{entry.dateFrom === entry.dateTo ? entry.dateFrom : `${entry.dateFrom} — ${entry.dateTo}`} · {employee?.name || branch?.name || "Все филиалы"}{entry.workEndsAt ? ` · до ${entry.workEndsAt}` : ""}</span>
                          </div>
                          <button type="button" aria-label="Удалить запись" disabled={deleteCalendarMutation.isPending} onClick={() => deleteCalendarMutation.mutate(entry.id)}><Trash2 size={17} /></button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </aside>
            ) : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
