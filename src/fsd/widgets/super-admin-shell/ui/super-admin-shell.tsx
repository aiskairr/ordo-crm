"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Blocks,
  Building2,
  Gauge,
  LogOut,
  Menu,
  Newspaper,
  PanelsTopLeft,
  Settings2,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logoutSuperAdmin, type SuperAdminSession } from "@/src/fsd/features/super-admin-auth";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import styles from "./super-admin-shell.module.css";

const futureSections = [
  { label: "Модули", icon: Blocks },
  { label: "Настройки", icon: Settings2 },
  { label: "Интеграции", icon: Unplug },
  { label: "Филиалы", icon: Building2 },
];

export function SuperAdminShell({ session, children }: { session: SuperAdminSession; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const logout = useMutation({
    mutationFn: logoutSuperAdmin,
    onSuccess: () => {
      router.replace("/super-admin/login");
      router.refresh();
    },
    onError: (error) => showToast({
      tone: "error",
      title: "Не удалось завершить сессию",
      description: getErrorText(error),
    }),
  });

  return (
    <div className={styles.shell} data-super-admin="true">
      <button className={styles.mobileMenu} type="button" onClick={() => setMenuOpen(true)} aria-label="Открыть меню">
        <Menu size={22} />
      </button>
      {menuOpen ? <button className={styles.backdrop} type="button" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню" /> : null}

      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><ShieldCheck size={22} /></div>
          <div><strong>ORDO</strong><span>CONTROL</span></div>
          <button type="button" className={styles.closeMenu} onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><X size={20} /></button>
        </div>

        <p className={styles.navLabel}>Управление системой</p>
        <nav className={styles.navigation} aria-label="Разделы Super Admin">
          <Link className={pathname === "/super-admin" ? styles.activeNav : ""} href="/super-admin" onClick={() => setMenuOpen(false)}>
            <Gauge size={19} /><span>Обзор</span>
          </Link>
          <Link className={pathname.startsWith("/super-admin/news") ? styles.activeNav : ""} href="/super-admin/news" onClick={() => setMenuOpen(false)}>
            <Newspaper size={19} /><span>Новости</span>
          </Link>
          {futureSections.map(({ label, icon: Icon }) => (
            <button key={label} type="button" disabled title="Будет реализовано на следующем этапе">
              <Icon size={19} /><span>{label}</span><small>Скоро</small>
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.identity}>
            <span>{session.login.slice(0, 1).toUpperCase()}</span>
            <div><strong>{session.login}</strong><small>Владелец системы</small></div>
          </div>
          <Link className={styles.crmLink} href="/" target="_blank"><PanelsTopLeft size={17} />Открыть CRM</Link>
          <button className={styles.logout} type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut size={17} />{logout.isPending ? "Выходим…" : "Выйти"}
          </button>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <div><span>Панель владельца</span><strong>Super Admin</strong></div>
          <div className={styles.isolation}><span />Изолировано от CRM</div>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
