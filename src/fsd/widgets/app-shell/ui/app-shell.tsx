"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Calculator,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  LogOut,
  Menu,
  MessageCircle,
  PackageCheck,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Truck,
  UserCog,
  WalletCards,
  Shield,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ROLE_LABELS } from "@/src/fsd/entities/user";
import { NAV_ITEMS } from "@/src/fsd/shared/config/navigation";
import { SystemNews } from "@/src/fsd/features/system-news";
import { MoySkladRequestMonitor } from "@/src/fsd/features/moysklad-request-monitor";
import { AttendanceSelfieButton } from "@/src/fsd/features/attendance-selfie";
import { getAttendanceNetworkStatus, getAttendanceStatus, openAttendanceShift } from "@/src/fsd/pages/attendance/api/attendance-api";
import { formatDuration, isAttendanceRequiredForUser } from "@/src/fsd/pages/attendance/model/attendance-model";
import { getShellSession, getUiSettings, logoutCrm, saveUiSettings } from "../api/app-shell-api";
import {
  defaultUiSettings,
  normalizeHexColor,
  normalizeUiSettings,
  readLocalUiSettings,
  themeAccents,
  writeLocalUiSettings,
  type UiSettings,
  type UiTheme,
} from "../model/ui-settings";
import styles from "./app-shell.module.css";

const icons = [
  BarChart3,
  CreditCard,
  Truck,
  Clock3,
  FileText,
  WalletCards,
  ReceiptText,
  PackageCheck,
  FileCheck2,
  FileCheck2,
  MessageCircle,
  SlidersHorizontal,
  Calculator,
  UserCog,
  Shield,
];

const navGroups = [
  { id: "sales", title: "Торговля" },
  { id: "finance", title: "Финансы" },
  { id: "docs", title: "Документы" },
  { id: "tools", title: "Инструменты" },
  { id: "admin", title: "Администрирование" },
] as const;

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "O") + (parts[1]?.[0] ?? "R");
}

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

function canAccess(user: { role: string; permissions?: string[] } | null, permission?: string) {
  if (!permission) return true;
  if (!user) return false;
  if (user.role === "admin" || user.role === "owner") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

function applyUiSettings(settings: UiSettings) {
  if (typeof document === "undefined") return;

  const normalizedSettings = normalizeUiSettings(settings);
  const normalizedAccent = normalizeHexColor(normalizedSettings.accentColor) || themeAccents[normalizedSettings.theme];
  const normalizedSidebar = normalizeHexColor(normalizedSettings.sidebarColor) || defaultUiSettings.sidebarColor;
  const root = document.documentElement;
  root.dataset.theme = normalizedSettings.theme;
  root.dataset.mode = normalizedSettings.mode;
  document.body.dataset.theme = normalizedSettings.theme;
  document.body.dataset.mode = normalizedSettings.mode;
  document.body.classList.toggle("density-compact", normalizedSettings.density === "compact");
  document.body.classList.toggle("sticky-summary", normalizedSettings.stickySummary);
  root.style.setProperty("--crm-accent", normalizedAccent);
  root.style.setProperty("--primary", normalizedAccent);
  root.style.setProperty("--primary-strong", `color-mix(in srgb, ${normalizedAccent} 82%, black)`);
  root.style.setProperty("--crm-accent-soft", `color-mix(in srgb, ${normalizedAccent} 14%, transparent)`);
  root.style.setProperty("--sidebar", normalizedSidebar);
  root.style.setProperty("--sidebar-soft", `color-mix(in srgb, ${normalizedSidebar} 76%, white 24%)`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<UiSettings>(() => readLocalUiSettings());

  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getShellSession });
  const user = sessionQuery.data?.user ?? null;
  const attendanceRequired = isAttendanceRequiredForUser(user);
  const settingsQuery = useQuery({ queryKey: ["crm-ui-settings"], queryFn: getUiSettings });
  const attendanceStatusQuery = useQuery({
    queryKey: ["attendance-status"],
    queryFn: getAttendanceStatus,
    enabled: Boolean(sessionQuery.data?.user),
  });
  const attendanceNetworkQuery = useQuery({
    queryKey: ["attendance-network-status"],
    queryFn: getAttendanceNetworkStatus,
    enabled: Boolean(user && attendanceRequired && attendanceStatusQuery.data?.dayStatus?.workingDay !== false && attendanceStatusQuery.data?.status !== "working"),
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const logoutMutation = useMutation({
    mutationFn: logoutCrm,
    onSettled: () => {
      queryClient.clear();
      router.replace("/");
    },
  });

  const settingsMutation = useMutation({
    mutationFn: saveUiSettings,
    onSuccess: (settings) => {
      const normalizedSettings = normalizeUiSettings(settings);
      writeLocalUiSettings(normalizedSettings);
      applyUiSettings(normalizedSettings);
      queryClient.setQueryData(["crm-ui-settings"], normalizedSettings);
      setSettingsDraft(normalizedSettings);
      setSettingsOpen(false);
    },
  });

  const attendanceOpenMutation = useMutation({
    mutationFn: openAttendanceShift,
    onSuccess: async (result) => {
      queryClient.setQueryData(["attendance-status"], (current: ReturnType<typeof getAttendanceStatus> extends Promise<infer Status> ? Status | undefined : never) => ({
        ...current!,
        status: "working",
        openRecord: result.record,
        now: new Date().toISOString(),
      }));
      await queryClient.invalidateQueries({ queryKey: ["attendance-report"] });
    },
    onError: async () => {
      await attendanceNetworkQuery.refetch();
    },
  });

  const displayName = user?.name || user?.login || "Пользователь CRM";
  const roleName = user ? ROLE_LABELS[user.role] : "cookie-сессия";
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const attendanceWorking = attendanceStatusQuery.data?.status === "working";
  const attendanceDayOff = attendanceStatusQuery.data?.dayStatus?.workingDay === false;
  const attendanceGateVisible = Boolean(user && attendanceRequired && !attendanceWorking && !attendanceDayOff);
  const workMinutes = useWorkTimer(attendanceWorking ? attendanceStatusQuery.data?.openRecord?.checkInTime : undefined);
  const visibleNavItems = useMemo(
    () =>
      NAV_ITEMS.map((item, index) => ({ item, index })).filter(({ item }) => canAccess(user, item.permission)),
    [user],
  );
  const groupedNavItems = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: visibleNavItems.filter(({ item }) => item.group === group.id),
        }))
        .filter((group) => group.items.length > 0),
    [visibleNavItems],
  );
  const activeNavItem = NAV_ITEMS.find((item) => item.isReact && pathname.startsWith(item.href));
  const pageAllowed = !activeNavItem || canAccess(user, activeNavItem.permission);

  useEffect(() => {
    applyUiSettings(readLocalUiSettings());
  }, []);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const normalizedSettings = normalizeUiSettings(settingsQuery.data);
    writeLocalUiSettings(normalizedSettings);
    applyUiSettings(normalizedSettings);
  }, [settingsQuery.data]);

  useEffect(() => {
    if (!sessionQuery.isSuccess || user) return;
    router.replace("/login");
  }, [router, sessionQuery.isSuccess, user]);

  const patchSettings = (patch: Partial<UiSettings>) => {
    setSettingsDraft((current) => {
      const next = normalizeUiSettings({ ...current, ...patch });
      if (patch.theme && !patch.accentColor) {
        next.accentColor = themeAccents[patch.theme];
      }
      applyUiSettings(next);
      writeLocalUiSettings(next);
      return next;
    });
  };

  if (sessionQuery.isError) {
    return (
      <main className={styles.authRequired}>
        <section>
          <h1>Нужно войти в систему</h1>
          <p>Сессия закончилась или backend не подтвердил доступ.</p>
          <Link href="/login">Открыть вход</Link>
        </section>
      </main>
    );
  }

  return (
    <div className={styles.shell}>
      {user ? <SystemNews userId={user.id} /> : null}
      {attendanceGateVisible ? (
        <div className={styles.attendanceGateBackdrop} role="presentation">
          <section className={styles.attendanceGate} role="dialog" aria-modal="true" aria-labelledby="attendance-gate-title">
            <div className={`${styles.attendanceGateIcon} ${attendanceNetworkQuery.data?.allowed ? styles.attendanceGateAllowed : ""}`}>
              {attendanceNetworkQuery.data?.allowed ? <Wifi size={34} /> : <WifiOff size={34} />}
            </div>
            <span>Посещаемость</span>
            <h2 id="attendance-gate-title">
              {attendanceStatusQuery.isLoading || attendanceNetworkQuery.isLoading
                ? "Проверяем офисный Wi‑Fi…"
                : attendanceNetworkQuery.data?.allowed
                  ? "Откройте рабочую смену"
                  : "Подключитесь к офисному Wi‑Fi"}
            </h2>
            <p>{attendanceNetworkQuery.data?.message || "Для входа в CRM необходимо подтвердить офисную сеть и открыть смену."}</p>
            {attendanceNetworkQuery.data?.branchName ? <strong>{attendanceNetworkQuery.data.branchName} · IP {attendanceNetworkQuery.data.clientIp}</strong> : null}
            {attendanceOpenMutation.error ? <div className={styles.attendanceGateError}>{String((attendanceOpenMutation.error as Error)?.message || "Не удалось открыть смену.")}</div> : null}
            <div className={styles.attendanceGateActions}>
              <button type="button" className={styles.attendanceGateSecondary} onClick={() => attendanceNetworkQuery.refetch()} disabled={attendanceNetworkQuery.isFetching}>
                <RefreshCw size={18} />
                {attendanceNetworkQuery.isFetching ? "Проверяем…" : "Проверить Wi‑Fi"}
              </button>
              <AttendanceSelfieButton
                action="open"
                disabled={!attendanceNetworkQuery.data?.allowed}
                pending={attendanceOpenMutation.isPending}
                onCapture={(selfie) => attendanceOpenMutation.mutate(selfie)}
              />
            </div>
            <button type="button" className={styles.attendanceGateLogout} onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
              Выйти из аккаунта
            </button>
          </section>
        </div>
      ) : null}
      <button className={styles.mobileToggle} onClick={() => setIsOpen((value) => !value)} aria-label="Открыть меню">
        <Menu size={18} />
      </button>
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ""}`}>
        <div className={styles.logo}>
          <span className={styles.logoCompact} aria-hidden="true">
            O
          </span>
          <span className={styles.logoFull}>
            <span className={styles.logoWordmark}>
              <strong>Ordo</strong>
              <em>CRM</em>
            </span>
          </span>
        </div>

        <nav className={styles.nav} aria-label="Разделы CRM">
          {groupedNavItems.map((group) => (
            <section className={styles.navGroup} key={group.id} aria-label={group.title}>
              <div className={styles.navGroupTitle}>{group.title}</div>
                <div className={styles.navGroupItems}>
                  {group.items.map(({ item, index }) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const className = `${styles.navItem} ${active ? styles.active : ""}`;
                  const Icon = icons[index] ?? FileText;

                  if (item.isReact) {
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={className}
                        title={item.title}
                        aria-label={item.title}
                        onClick={() => setIsOpen(false)}
                      >
                        <Icon size={18} />
                        <span className={styles.navText}>{item.title}</span>
                      </Link>
                    );
                  }

                  return (
                    <a key={item.href} href={item.href} className={className} title={item.title} aria-label={item.title}>
                      <Icon size={18} />
                      <span className={styles.navText}>{item.title}</span>
                    </a>
                  );
                  })}
                </div>
            </section>
          ))}
        </nav>

        <div className={styles.userBlock}>
          <div className={styles.avatar}>{initials}</div>
          <div>
            <span>{displayName}</span>
            <small>{roleName}</small>
          </div>
          <Link
            href="/attendance"
            className={`${styles.userAction} ${styles.attendanceAction}`}
            title={attendanceWorking ? `Смена открыта: ${formatDuration(workMinutes)}` : attendanceDayOff ? attendanceStatusQuery.data?.dayStatus.label : "Открыть смену"}
            onClick={() => setIsOpen(false)}
          >
            <Clock3 size={16} />
            <span>{attendanceWorking ? `На работе · ${formatDuration(workMinutes)}` : attendanceDayOff ? `${attendanceStatusQuery.data?.dayStatus.code} · ${attendanceStatusQuery.data?.dayStatus.label}` : "Открыть смену"}</span>
          </Link>
          <button
            className={`${styles.userAction} ${styles.settingsAction}`}
            type="button"
            aria-label="Настройки"
            onClick={() => {
              setSettingsDraft(normalizeUiSettings(settingsQuery.data ?? readLocalUiSettings()));
              setSettingsOpen(true);
            }}
          >
            <Settings size={16} />
            <span>Настройки</span>
          </button>
          <button
            className={`${styles.userAction} ${styles.logoutAction}`}
            type="button"
            aria-label="Выйти из аккаунта"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <LogOut size={16} />
            <span>{logoutMutation.isPending ? "Выходим..." : "Выйти"}</span>
          </button>
        </div>
      </aside>

      <main className={styles.content}>
        {sessionQuery.isLoading || pageAllowed ? (
          children
        ) : (
          <section className={styles.noAccess}>
            <h1>Нет доступа</h1>
            <p>Этот раздел не входит в разрешения вашего аккаунта. Обратитесь к администратору CRM.</p>
          </section>
        )}
      </main>

      {user && (user.role === "admin" || user.role === "owner") ? <MoySkladRequestMonitor /> : null}

      {settingsOpen ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className={styles.settingsModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.settingsHeader}>
              <div>
                <h2 id="settings-title">Настройки CRM</h2>
                <p>Внешний вид и поведение интерфейса сохраняются в аккаунте.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Закрыть настройки">
                ×
              </button>
            </header>

            <div className={styles.settingsGrid}>
              <section className={styles.settingsSection}>
                <h3>Тема</h3>
                <div className={styles.swatches}>
                  {(Object.keys(themeAccents) as UiTheme[]).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      className={settingsDraft.theme === theme ? styles.selectedSwatch : ""}
                      style={{ background: themeAccents[theme] }}
                      aria-label={`Тема ${theme}`}
                      onClick={() => patchSettings({ theme })}
                    />
                  ))}
                </div>
              </section>

              <section className={styles.settingsSection}>
                <h3>Режим</h3>
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={settingsDraft.mode === "dark" ? styles.selectedSegment : ""}
                    onClick={() => patchSettings({ mode: "dark" })}
                  >
                    Темный
                  </button>
                  <button
                    type="button"
                    className={settingsDraft.mode === "light" ? styles.selectedSegment : ""}
                    onClick={() => patchSettings({ mode: "light" })}
                  >
                    Светлый
                  </button>
                </div>
              </section>

              <section className={styles.settingsSection}>
                <h3>Плотность</h3>
                <div className={styles.segmented}>
                  <button
                    type="button"
                    className={settingsDraft.density === "comfortable" ? styles.selectedSegment : ""}
                    onClick={() => patchSettings({ density: "comfortable" })}
                  >
                    Обычная
                  </button>
                  <button
                    type="button"
                    className={settingsDraft.density === "compact" ? styles.selectedSegment : ""}
                    onClick={() => patchSettings({ density: "compact" })}
                  >
                    Компактная
                  </button>
                </div>
              </section>

              <section className={styles.settingsSection}>
                <h3>Акцент</h3>
                <label className={styles.colorInput}>
                  <input
                    type="color"
                    value={normalizeHexColor(settingsDraft.accentColor) || themeAccents[settingsDraft.theme]}
                    onChange={(event) => patchSettings({ accentColor: event.target.value })}
                  />
                  <span>{normalizeHexColor(settingsDraft.accentColor) || themeAccents[settingsDraft.theme]}</span>
                </label>
              </section>

              <section className={styles.settingsSection}>
                <h3>Sidebar</h3>
                <label className={styles.colorInput}>
                  <input
                    type="color"
                    value={normalizeHexColor(settingsDraft.sidebarColor) || defaultUiSettings.sidebarColor}
                    onChange={(event) => patchSettings({ sidebarColor: event.target.value })}
                  />
                  <span>{normalizeHexColor(settingsDraft.sidebarColor) || defaultUiSettings.sidebarColor}</span>
                </label>
              </section>
            </div>

            <div className={styles.checks}>
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.confirmBeforeSubmit}
                  onChange={(event) => patchSettings({ confirmBeforeSubmit: event.target.checked })}
                />
                <span>Подтверждать создание документа продажи</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.focusProductSearch}
                  onChange={(event) => patchSettings({ focusProductSearch: event.target.checked })}
                />
                <span>Фокусировать поиск товара после добавления</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.stickySummary}
                  onChange={(event) => patchSettings({ stickySummary: event.target.checked })}
                />
                <span>Закреплять итоговую панель продажи</span>
              </label>
            </div>

            {settingsMutation.isError ? <p className={styles.settingsError}>Не удалось сохранить настройки.</p> : null}

            <footer className={styles.settingsActions}>
              <button
                type="button"
                onClick={() => {
                  setSettingsDraft(defaultUiSettings);
                  applyUiSettings(defaultUiSettings);
                  writeLocalUiSettings(defaultUiSettings);
                  settingsMutation.mutate(defaultUiSettings);
                }}
                disabled={settingsMutation.isPending}
              >
                Сбросить
              </button>
              <button type="button" onClick={() => settingsMutation.mutate(settingsDraft)} disabled={settingsMutation.isPending}>
                {settingsMutation.isPending ? "Сохраняю..." : "Сохранить"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
