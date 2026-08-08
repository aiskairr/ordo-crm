import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AttendanceBranchSchedule, AttendanceCalendarEntry, AttendanceCalendarKind, AttendanceRecord, AttendanceUser, EmployeePayment } from "../api/attendance-api";
import { formatDuration, recordWorkMinutes } from "../model/attendance-model";
import styles from "./attendance-timesheet.module.css";

type TimesheetDay = { iso: string; weekday: string; isoWeekday: number; date: string; today: boolean };
type DaySummary = {
  checkIn: string;
  checkOut: string;
  storeName: string;
  workMinutes: number;
  lateMinutes: number;
  open: boolean;
};

const bishkekDateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bishkek",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const bishkekTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Asia/Bishkek",
  hour: "2-digit",
  minute: "2-digit",
});

const roleLabels: Record<AttendanceUser["role"], string> = {
  admin: "Главный администратор",
  owner: "Владелец",
  manager: "Менеджер",
  seller: "Продавец",
  logistics: "Логистика",
  accountant: "Бухгалтер",
  employee: "Сотрудник",
};

function localIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateRange(dateFrom: string, dateTo: string): TimesheetDay[] {
  const start = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const days: TimesheetDay[] = [];
  const today = localIsoDate(new Date());
  const cursor = new Date(start);
  while (cursor <= end && days.length < 62) {
    const iso = localIsoDate(cursor);
    days.push({
      iso,
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(cursor).replace(".", "").toUpperCase(),
      isoWeekday: cursor.getDay() === 0 ? 7 : cursor.getDay(),
      date: new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(cursor),
      today: iso === today,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function normalizedBranch(value: string) {
  const normalized = value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, "-");
  if (normalized.includes("беш") || normalized.includes("besh")) return "besh";
  if (normalized.includes("аю") || normalized.includes("ayu")) return "ayu";
  return normalized;
}

function employeeSchedule(employee: AttendanceUser, schedules: AttendanceBranchSchedule[]) {
  const branches = new Set(employee.branches.map(normalizedBranch));
  return schedules.find((schedule) => branches.has(normalizedBranch(schedule.key)) || branches.has(normalizedBranch(schedule.label)))
    ?? schedules[0]
    ?? null;
}

function employeeCalendarEntry(employee: AttendanceUser, day: TimesheetDay, entries: AttendanceCalendarEntry[]) {
  const branches = new Set(employee.branches.map(normalizedBranch));
  const priority: Record<AttendanceCalendarEntry["kind"], number> = { present: 7, late: 7, absent: 7, delivery: 7, leave: 6, holiday: 5, day_off: 4, short_day: 3 };
  return entries
    .filter((entry) => {
      if (day.iso < entry.dateFrom || day.iso > entry.dateTo) return false;
      if (entry.userId && entry.userId !== employee.id) return false;
      if (entry.storeId && branches.size && !branches.has(normalizedBranch(entry.storeId))) return false;
      return true;
    })
    .sort((left, right) => priority[right.kind] - priority[left.kind])[0] ?? null;
}

const calendarCodes: Record<AttendanceCalendarEntry["kind"], string> = {
  present: "Я",
  late: "ОП",
  absent: "Н",
  holiday: "П",
  day_off: "В",
  leave: "ОТ",
  short_day: "СД",
  delivery: "Д",
};

const calendarLabels: Record<AttendanceCalendarEntry["kind"], string> = {
  present: "Сотрудник работал",
  late: "Опоздание без уважительной причины",
  absent: "Отсутствие без причины",
  holiday: "Праздник",
  day_off: "Выходной",
  leave: "Согласованный отгул",
  short_day: "Сокращённый день",
  delivery: "Вышел на доставку",
};

const markOptions: Array<{ kind: AttendanceCalendarKind; code: string; label: string }> = [
  { kind: "present", code: "Я", label: "Работал" },
  { kind: "late", code: "ОП", label: "Опоздание" },
  { kind: "absent", code: "Н", label: "Не вышел" },
  { kind: "day_off", code: "В", label: "Выходной" },
  { kind: "holiday", code: "П", label: "Праздник" },
  { kind: "leave", code: "ОТ", label: "Согласованный отгул" },
  { kind: "short_day", code: "СД", label: "Сокращённый день" },
  { kind: "delivery", code: "Д", label: "Вышел на доставку" },
];

function time(value: string) {
  return value ? bishkekTime.format(new Date(value)) : "—";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "С";
}

function buildSummary(records: AttendanceRecord[]): DaySummary | null {
  if (!records.length) return null;
  const sorted = [...records].sort((left, right) => new Date(left.checkInTime).getTime() - new Date(right.checkInTime).getTime());
  const lastCompleted = sorted
    .filter((record) => record.checkOutTime)
    .sort((left, right) => new Date(right.checkOutTime).getTime() - new Date(left.checkOutTime).getTime())[0];
  return {
    checkIn: sorted[0]?.checkInTime || "",
    checkOut: lastCompleted?.checkOutTime || "",
    storeName: sorted.map((record) => record.storeName).find(Boolean) || "",
    workMinutes: sorted.reduce((total, record) => total + recordWorkMinutes(record), 0),
    lateMinutes: sorted.reduce((total, record) => total + (record.lateMinutes || 0), 0),
    open: sorted.some((record) => record.status === "open"),
  };
}

function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

export function AttendanceTimesheet({ users, records, calendar, payments, schedules, dateFrom, dateTo, editable = false, onSetMark, onDeleteMark }: {
  users: AttendanceUser[];
  records: AttendanceRecord[];
  calendar: AttendanceCalendarEntry[];
  payments: EmployeePayment[];
  schedules: AttendanceBranchSchedule[];
  dateFrom: string;
  dateTo: string;
  editable?: boolean;
  onSetMark?: (input: {
    kind: AttendanceCalendarKind;
    dateFrom: string;
    dateTo: string;
    userId: string;
    storeId: string;
    title: string;
    workEndsAt: string;
    scope: "employee" | "all";
  }) => Promise<unknown>;
  onDeleteMark?: (id: string) => Promise<unknown>;
}) {
  const [editor, setEditor] = useState<{ day: TimesheetDay; employee: AttendanceUser | null } | null>(null);
  const [selectedKind, setSelectedKind] = useState<AttendanceCalendarKind>("present");
  const [shortDayEnd, setShortDayEnd] = useState("16:00");
  const [saving, setSaving] = useState(false);
  const days = useMemo(() => dateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const employees = useMemo(() => {
    const result = [...users];
    const knownIds = new Set(result.map((user) => user.id));
    records.forEach((record) => {
      if (knownIds.has(record.userId)) return;
      knownIds.add(record.userId);
      result.push({ id: record.userId, name: record.userName || "Сотрудник", role: "employee", branches: [], permissions: [] });
    });
    return result.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [records, users]);

  const summaries = useMemo(() => {
    const grouped = new Map<string, AttendanceRecord[]>();
    records.forEach((record) => {
      const key = `${record.userId}:${bishkekDateKey.format(new Date(record.checkInTime))}`;
      grouped.set(key, [...(grouped.get(key) || []), record]);
    });
    return new Map([...grouped].map(([key, rows]) => [key, buildSummary(rows)]));
  }, [records]);
  const printWeeks = useMemo(() => chunks(days, 7), [days]);
  const advancesByEmployeeDay = useMemo(() => {
    const grouped = new Map<string, number>();
    payments.filter((payment) => payment.status === "paid" && payment.paymentType === "advance").forEach((payment) => {
      const key = `${payment.employeeId}:${payment.paymentDate}`;
      grouped.set(key, (grouped.get(key) || 0) + payment.amount);
    });
    return grouped;
  }, [payments]);

  const getDayView = (employee: AttendanceUser, day: TimesheetDay) => {
    const summary = summaries.get(`${employee.id}:${day.iso}`);
    const schedule = employeeSchedule(employee, schedules);
    const calendarEntry = employeeCalendarEntry(employee, day, calendar);
    const scheduledWorkday = schedule ? schedule.workDays.includes(day.isoWeekday) : true;
    const effectiveKind = calendarEntry?.kind ?? (!scheduledWorkday ? "day_off" : null);
    const specialCode = effectiveKind ? calendarCodes[effectiveKind] : "";
    const specialLabel = calendarEntry?.title || (effectiveKind ? calendarLabels[effectiveKind] : "");
    const isNonWorking = effectiveKind === "holiday" || effectiveKind === "day_off" || effectiveKind === "leave";
    const isPast = day.iso < localIsoDate(new Date());
    const isManualAttendance = effectiveKind === "present" || effectiveKind === "late" || effectiveKind === "absent";
    const attendanceCode = isManualAttendance
      ? specialCode
      : summary
        ? (summary.lateMinutes ? "ОП" : "Я")
        : isNonWorking
          ? specialCode
          : effectiveKind === "short_day" || effectiveKind === "delivery" ? specialCode : isPast ? "Н" : "";
    const advance = advancesByEmployeeDay.get(`${employee.id}:${day.iso}`) || 0;
    return { summary, calendarEntry, specialCode, specialLabel, isNonWorking, attendanceCode, advance };
  };

  const openEditor = (day: TimesheetDay, employee: AttendanceUser | null) => {
    if (!editable) return;
    const existing = calendar.find((entry) => entry.dateFrom === day.iso
      && entry.dateTo === day.iso
      && (employee ? entry.userId === employee.id : !entry.userId && !entry.storeId));
    setSelectedKind(existing?.kind || (employee ? "present" : "day_off"));
    setShortDayEnd(existing?.workEndsAt || "16:00");
    setEditor({ day, employee });
  };

  const exactEditorEntry = editor ? calendar.find((entry) => entry.dateFrom === editor.day.iso
    && entry.dateTo === editor.day.iso
    && (editor.employee ? entry.userId === editor.employee.id : !entry.userId && !entry.storeId)) : null;

  const saveMark = async () => {
    if (!editor || !onSetMark) return;
    setSaving(true);
    try {
      await onSetMark({
        kind: selectedKind,
        dateFrom: editor.day.iso,
        dateTo: editor.day.iso,
        userId: editor.employee?.id || "",
        storeId: "",
        title: calendarLabels[selectedKind],
        workEndsAt: selectedKind === "short_day" ? shortDayEnd : "",
        scope: editor.employee ? "employee" : "all",
      });
      setEditor(null);
    } finally {
      setSaving(false);
    }
  };

  const resetMark = async () => {
    if (!exactEditorEntry || !onDeleteMark) return;
    setSaving(true);
    try {
      await onDeleteMark(exactEditorEntry.id);
      setEditor(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.frame}>
      <div className={styles.tableMeta}>
        <div>
          <strong>Рабочая неделя</strong>
          <span>Приход, уход и фактически отработанное время</span>
        </div>
        <div className={styles.legend}>
          <span><i className={styles.onTimeDot} />Смена закрыта</span>
          <span><i className={styles.workingDot} />Сейчас на работе</span>
          <span><i className={styles.lateDot} />Есть опоздание</span>
          <span><b>Я</b> Работал</span>
          <span><b>ОП</b> Опоздание</span>
          <span><b>Н</b> Не вышел</span>
          <span><b>В</b> Выходной</span>
          <span><b>П</b> Праздник</span>
          <span><b>ОТ</b> Отгул</span>
          <span><b>СД</b> Сокращённый день</span>
          <span><b>Д</b> Вышел на доставку</span>
        </div>
      </div>
      <div className={styles.scrollArea}>
        <table className={styles.table} style={{ minWidth: `${280 + days.length * 172}px` }}>
          <thead>
            <tr>
              <th className={styles.employeeColumn}>СОТРУДНИК</th>
              {days.map((day) => (
                <th
                  key={day.iso}
                  className={`${day.today ? styles.todayHead : ""} ${editable ? styles.editableHead : ""}`}
                  onClick={() => openEditor(day, null)}
                >
                  <span>{day.weekday}</span>
                  <strong>{day.date}</strong>
                  {day.today ? <small>Сегодня</small> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <th className={styles.employeeCell}>
                  <span className={styles.avatar}>{initials(employee.name)}</span>
                  <span className={styles.employeeCopy}>
                    <strong>{employee.name}</strong>
                    <small>{roleLabels[employee.role]}</small>
                  </span>
                </th>
                {days.map((day) => {
                  const { summary, calendarEntry, specialCode, specialLabel, isNonWorking, attendanceCode, advance } = getDayView(employee, day);
                  return (
                    <td
                      key={day.iso}
                      className={`${day.today ? styles.todayCell : ""} ${isNonWorking ? styles.weekendCell : ""} ${editable ? styles.editableCell : ""}`}
                      onClick={() => openEditor(day, employee)}
                    >
                      {summary ? (
                        <div className={`${styles.dayCard} ${summary.open ? styles.workingCard : ""} ${summary.lateMinutes ? styles.lateCard : ""}`}>
                          <div className={styles.codeLine}><b>{attendanceCode}</b>{specialCode ? <span>{specialCode} · {specialLabel}</span> : null}</div>
                          <div className={styles.times}>
                            <strong>{time(summary.checkIn)}</strong>
                            <span>→</span>
                            <strong>{summary.open ? "сейчас" : time(summary.checkOut)}</strong>
                          </div>
                          <div className={styles.duration}>
                            <span>{formatDuration(summary.workMinutes)}</span>
                            {summary.open ? <em>На работе</em> : null}
                          </div>
                          <small className={styles.branch}>{summary.storeName || "Филиал не указан"}</small>
                          {summary.lateMinutes ? <small className={styles.lateLabel}>Опоздание {formatDuration(summary.lateMinutes)}</small> : null}
                          {advance ? <small className={styles.advanceLabel}>Аванс: {formatMoney(advance)} сом</small> : null}
                        </div>
                      ) : (
                        <div className={`${styles.emptyDay} ${attendanceCode === "Н" ? styles.absentDay : ""} ${isNonWorking ? styles.specialDay : ""}`}>
                          <strong>{attendanceCode || "—"}</strong>
                          <small>{specialLabel || (attendanceCode === "Н" ? "Нет отметки" : "Нет смены")}</small>
                          {calendarEntry?.kind === "short_day" && calendarEntry.workEndsAt ? <small>до {calendarEntry.workEndsAt}</small> : null}
                          {advance ? <small className={styles.advanceLabel}>Аванс: {formatMoney(advance)} сом</small> : null}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {!employees.length ? <div className={styles.empty}>Сотрудники для табеля не найдены.</div> : null}
      </div>
      {editor ? (
        <div className={styles.editorBackdrop} role="presentation" onMouseDown={() => !saving && setEditor(null)}>
          <section className={styles.editor} role="dialog" aria-modal="true" aria-labelledby="attendance-mark-title" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className={styles.editorClose} onClick={() => setEditor(null)} disabled={saving} aria-label="Закрыть"><X size={20} /></button>
            <span>{editor.employee ? "Отметка сотрудника" : "Отметка всем сотрудникам"}</span>
            <h3 id="attendance-mark-title">{editor.employee?.name || "Весь коллектив"}</h3>
            <p>{editor.day.date} · {editor.day.weekday}</p>
            <div className={styles.markGrid}>
              {markOptions.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className={selectedKind === option.kind ? styles.markSelected : ""}
                  onClick={() => setSelectedKind(option.kind)}
                >
                  <b>{option.code}</b>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            {selectedKind === "short_day" ? (
              <label className={styles.shortDayField}>
                <span>Работа до</span>
                <input type="time" value={shortDayEnd} onChange={(event) => setShortDayEnd(event.target.value)} />
              </label>
            ) : null}
            {!editor.employee ? <strong className={styles.allWarning}>Отметка применится ко всем сотрудникам на эту дату.</strong> : null}
            <div className={styles.editorActions}>
              {exactEditorEntry ? <button type="button" className={styles.resetButton} onClick={resetMark} disabled={saving}>Сбросить</button> : null}
              <button type="button" className={styles.saveButton} onClick={saveMark} disabled={saving}>{saving ? "Сохраняю…" : "Сохранить отметку"}</button>
            </div>
          </section>
        </div>
      ) : null}
      <div className={`${styles.printSheet} attendance-print-sheet`} aria-hidden="true">
        {printWeeks.map((week, weekIndex) => (
          <section className={styles.printPage} key={week[0]?.iso || weekIndex}>
            <header className={styles.printHeader}>
              <div className={styles.printBrand}>
                <b>O</b>
                <div>
                  <span>ORDO CRM · ПОСЕЩАЕМОСТЬ</span>
                  <h1>Табель рабочего времени</h1>
                  <p>Учёт смен, опозданий и выплат сотрудникам</p>
                </div>
              </div>
              <aside>
                <b>ЛИСТ {String(weekIndex + 1).padStart(2, "0")} / {String(printWeeks.length).padStart(2, "0")}</b>
                <span>Сформирован: {new Intl.DateTimeFormat("ru-RU").format(new Date())}</span>
              </aside>
            </header>
            <div className={styles.printMeta}>
              <article><span>Период</span><b>{week[0]?.date} — {week[week.length - 1]?.date}</b></article>
              <article><span>Сотрудников</span><b>{employees.length}</b></article>
              <article><span>Формат</span><b>Рабочая неделя</b></article>
            </div>
            <table className={styles.printTable}>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Сотрудник</th>
                  {week.map((day) => <th key={day.iso}>{day.weekday}<br /><b>{day.date}</b></th>)}
                  <th>Часы</th>
                  <th>Итого аванс / зарплата</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee, employeeIndex) => {
                  const views = week.map((day) => getDayView(employee, day));
                  const totalMinutes = views.reduce((sum, view) => sum + (view.summary?.workMinutes || 0), 0);
                  const totalAdvance = views.reduce((sum, view) => sum + view.advance, 0);
                  return [
                    <tr key={`${employee.id}-attendance`} className={styles.printAttendanceRow}>
                      <td rowSpan={2}>{employeeIndex + 1}</td>
                      <th>
                        <span className={styles.printEmployee}>
                          <i>{initials(employee.name)}</i>
                          <span>{employee.name}<small>{roleLabels[employee.role]}</small></span>
                        </span>
                      </th>
                      {views.map((view, index) => (
                        <td key={week[index].iso}>
                          <b className={styles.printCode}>{view.attendanceCode || "—"}</b>
                          {view.summary ? <span>{time(view.summary.checkIn)}–{view.summary.open ? "…" : time(view.summary.checkOut)}</span> : null}
                          {view.specialCode === "Д" ? <em>Доставка</em> : null}
                        </td>
                      ))}
                      <td><b>{totalMinutes ? formatDuration(totalMinutes) : "—"}</b></td>
                      <td rowSpan={2} className={styles.printPaymentTotal}>{totalAdvance ? <b>{formatMoney(totalAdvance)} сом</b> : <i />}</td>
                    </tr>,
                    <tr key={`${employee.id}-payment`} className={styles.printPaymentRow}>
                      <th>Аванс / зарплата</th>
                      {views.map((view, index) => <td key={week[index].iso}>{view.advance ? <b>{formatMoney(view.advance)}</b> : <i />}<small>сом</small></td>)}
                      <td>Суммы по дням</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
            <footer className={styles.printFooter}>
              <p><b>Обозначения:</b> Я — работал · ОП — опоздание · Н — отсутствие · В — выходной · П — праздник · ОТ — отгул · СД — сокращённый день · Д — доставка</p>
              <div><span>Ответственный: ____________________</span><span>Подпись: ____________________</span></div>
            </footer>
          </section>
        ))}
      </div>
    </section>
  );
}
