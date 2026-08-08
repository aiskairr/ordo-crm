import { ATTENDANCE_AUTO_PERMISSION, ATTENDANCE_BRANCH_VIEW_PERMISSION } from "@/src/fsd/entities/user";
import type { AttendanceRecord, AttendanceUser } from "../api/attendance-api";

export const branchLabels: Record<string, string> = {
  ayu: "Аю-Гранд",
  besh: "Беш-Сары",
};

export function isAttendanceRequiredForUser(user: Pick<AttendanceUser, "role"> | null) {
  return ["manager", "seller", "logistics", "accountant", "employee"].includes(user?.role ?? "");
}

export function isAutomaticAttendanceUser(user: Pick<AttendanceUser, "permissions"> | null) {
  return Boolean(user?.permissions?.includes(ATTENDANCE_AUTO_PERMISSION));
}

export function isAttendanceOpeningTime(status: { now: string; dayStatus: { workingDay: boolean; workEndsAt: string } } | undefined) {
  if (!status?.dayStatus.workingDay) return false;
  if (!/^\d{2}:\d{2}$/.test(status.dayStatus.workEndsAt)) return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bishkek",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(status.now || Date.now()));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  const [endHour, endMinute] = status.dayStatus.workEndsAt.split(":").map(Number);
  return hour * 60 + minute < endHour * 60 + endMinute;
}

export function canManageAttendance(user: Pick<AttendanceUser, "role"> | null) {
  return user?.role === "admin";
}

export function canViewReports(user: Pick<AttendanceUser, "role"> | null) {
  return Boolean(user);
}

export function canViewAttendanceTeam(user: Pick<AttendanceUser, "role" | "permissions"> | null) {
  return Boolean(
    user
      && (["admin", "owner"].includes(user.role)
        || user.permissions?.includes(ATTENDANCE_BRANCH_VIEW_PERMISSION)),
  );
}

export function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentWeekIsoRange() {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { dateFrom: localIsoDate(monday), dateTo: localIsoDate(sunday) };
}

export function formatDuration(minutes: number) {
  const value = Math.max(0, Number(minutes) || 0);
  return `${Math.floor(value / 60)}ч ${value % 60}м`;
}

export function formatMeters(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Number(value) || 0)} м`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Number(value) || 0);
}

export function formatDateTime(value: string) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
    : "-";
}

export function recordWorkMinutes(record: AttendanceRecord) {
  return record.currentWorkMinutes || record.totalWorkMinutes || 0;
}

export function exportAttendanceCsv(rows: AttendanceRecord[], dateFrom: string, dateTo: string) {
  const lines = [
    ["Сотрудник", "Точка", "Приход", "Уход", "Минут", "Статус", "Дистанция прихода", "Дистанция ухода"],
    ...rows.map((row) => [
      row.userName,
      row.storeName,
      formatDateTime(row.checkInTime),
      row.checkOutTime ? formatDateTime(row.checkOutTime) : "",
      String(recordWorkMinutes(row)),
      row.status,
      row.checkInDistanceMeters ?? "",
      row.checkOutDistanceMeters ?? "",
    ]),
  ];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `attendance-${dateFrom}-${dateTo}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
