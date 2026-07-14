import type { AttendanceRecord, AttendanceStore, AttendanceUser } from "../api/attendance-api";

export const branchLabels: Record<string, string> = {
  ayu: "Аю-Гранд",
  besh: "Беш-Сары",
};

export function isAttendanceRequiredForUser(user: AttendanceUser | null) {
  return ["manager", "seller", "logistics", "accountant", "employee"].includes(user?.role ?? "");
}

export function canManageAttendance(user: AttendanceUser | null) {
  return Boolean(user && ["admin", "owner", "manager"].includes(user.role));
}

export function canViewReports(user: AttendanceUser | null) {
  return Boolean(user && ["admin", "owner", "manager"].includes(user.role));
}

export function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function getCurrentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Для отметки прихода/ухода необходимо разрешить доступ к геолокации."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      () => reject(new Error("Для отметки прихода/ухода необходимо разрешить доступ к геолокации.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function distanceMeters(latitude: number, longitude: number, store: AttendanceStore) {
  const earthRadius = 6371000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(store.latitude - latitude);
  const dLon = toRadians(store.longitude - longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latitude)) * Math.cos(toRadians(store.latitude)) * Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestAllowedStore(stores: AttendanceStore[], latitude: number, longitude: number) {
  return stores
    .map((store) => ({
      store,
      distance: distanceMeters(latitude, longitude, store),
    }))
    .sort((left, right) => left.distance - right.distance)[0] ?? null;
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
