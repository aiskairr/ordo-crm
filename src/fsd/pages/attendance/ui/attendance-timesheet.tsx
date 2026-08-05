import { useMemo } from "react";
import type { AttendanceBranchSchedule, AttendanceCalendarEntry, AttendanceRecord, AttendanceUser } from "../api/attendance-api";
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
  const priority: Record<AttendanceCalendarEntry["kind"], number> = { leave: 4, holiday: 3, day_off: 2, short_day: 1 };
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
  holiday: "П",
  day_off: "В",
  leave: "ОТ",
  short_day: "СД",
};

const calendarLabels: Record<AttendanceCalendarEntry["kind"], string> = {
  holiday: "Праздник",
  day_off: "Выходной",
  leave: "Согласованный отгул",
  short_day: "Сокращённый день",
};

function time(value: string) {
  return value ? bishkekTime.format(new Date(value)) : "—";
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

export function AttendanceTimesheet({ users, records, calendar, schedules, dateFrom, dateTo }: {
  users: AttendanceUser[];
  records: AttendanceRecord[];
  calendar: AttendanceCalendarEntry[];
  schedules: AttendanceBranchSchedule[];
  dateFrom: string;
  dateTo: string;
}) {
  const days = useMemo(() => dateRange(dateFrom, dateTo), [dateFrom, dateTo]);
  const employees = useMemo(() => {
    const result = [...users];
    const knownIds = new Set(result.map((user) => user.id));
    records.forEach((record) => {
      if (knownIds.has(record.userId)) return;
      knownIds.add(record.userId);
      result.push({ id: record.userId, name: record.userName || "Сотрудник", role: "employee", branches: [] });
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
          <span><b>В</b> Выходной</span>
          <span><b>П</b> Праздник</span>
          <span><b>ОТ</b> Отгул</span>
          <span><b>СД</b> Сокращённый день</span>
        </div>
      </div>
      <div className={styles.scrollArea}>
        <table className={styles.table} style={{ minWidth: `${280 + days.length * 172}px` }}>
          <thead>
            <tr>
              <th className={styles.employeeColumn}>СОТРУДНИК</th>
              {days.map((day) => (
                <th key={day.iso} className={day.today ? styles.todayHead : ""}>
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
                  const summary = summaries.get(`${employee.id}:${day.iso}`);
                  const schedule = employeeSchedule(employee, schedules);
                  const calendarEntry = employeeCalendarEntry(employee, day, calendar);
                  const scheduledWorkday = schedule ? schedule.workDays.includes(day.isoWeekday) : true;
                  const effectiveKind = calendarEntry?.kind ?? (!scheduledWorkday ? "day_off" : null);
                  const specialCode = effectiveKind ? calendarCodes[effectiveKind] : "";
                  const specialLabel = calendarEntry?.title || (effectiveKind ? calendarLabels[effectiveKind] : "");
                  const isNonWorking = effectiveKind === "holiday" || effectiveKind === "day_off" || effectiveKind === "leave";
                  const isPast = day.iso < localIsoDate(new Date());
                  const attendanceCode = summary ? (summary.lateMinutes ? "ОП" : "Я") : isNonWorking ? specialCode : effectiveKind === "short_day" ? "СД" : isPast ? "Н" : "";
                  return (
                    <td key={day.iso} className={`${day.today ? styles.todayCell : ""} ${isNonWorking ? styles.weekendCell : ""}`}>
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
                        </div>
                      ) : (
                        <div className={`${styles.emptyDay} ${attendanceCode === "Н" ? styles.absentDay : ""} ${isNonWorking ? styles.specialDay : ""}`}>
                          <strong>{attendanceCode || "—"}</strong>
                          <small>{specialLabel || (attendanceCode === "Н" ? "Нет отметки" : "Нет смены")}</small>
                          {calendarEntry?.kind === "short_day" && calendarEntry.workEndsAt ? <small>до {calendarEntry.workEndsAt}</small> : null}
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
    </section>
  );
}
