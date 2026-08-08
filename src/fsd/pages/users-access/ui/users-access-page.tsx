"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, CloudDownload, Eye, EyeOff, KeyRound, RefreshCw, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { ATTENDANCE_AUTO_PERMISSION, ATTENDANCE_BRANCH_VIEW_PERMISSION, ROLE_LABELS, type CrmRole, type CrmUser, type CrmUserUpdate } from "@/src/fsd/entities/user";
import {
  isPercentPayrollScheme,
  PAYROLL_PERCENT_BASE_LABELS,
  PAYROLL_SCHEME_LABELS,
  type PayrollPercentBase,
  type PayrollScheme,
} from "@/src/fsd/entities/payroll";
import { getErrorText, isUnauthorizedError } from "@/src/fsd/shared/lib/errors";
import { AuthRequired, StatusPanel } from "@/src/fsd/shared/ui/status";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { ClearableNumberInput } from "@/src/fsd/shared/ui/clearable-number-input";
import { getShellSession } from "@/src/fsd/widgets/app-shell/api/app-shell-api";
import { AppShell } from "@/src/fsd/widgets/app-shell";
import {
  getCrmUserDeletionImpact,
  getCrmUsers,
  getEmployeePayrollSettings,
  reassignAndDeleteCrmUser,
  saveEmployeePayrollSettings,
  syncCrmUsersFromMoySklad,
  updateCrmUser,
} from "../api/users-access-api";
import {
  arePermissionsLocked,
  BRANCHES,
  canDeleteUser,
  canEditUser,
  canGrantReportProfit,
  copyPassword,
  filterUsers,
  formatMoySkladRemoval,
  generatePassword,
  getNextPermissionsForRole,
  initials,
  isDocumentPriceEditAllowed,
  isReportProfitAllowed,
  normalizeLogin,
  normalizePermissions,
  PERMISSIONS,
  toUserDraft,
  type UsersAccessDraft,
} from "../model/users-access-model";
import { CreateUserPanel } from "./create-user-panel";
import { ArchivedUsersDialog } from "./archived-users-dialog";
import { DeleteUserDialog } from "./delete-user-dialog";
import styles from "./users-access-page.module.css";

const roles = Object.keys(ROLE_LABELS) as CrmRole[];
const branchEntries = Object.entries(BRANCHES);
const permissionEntries = Object.entries(PERMISSIONS);

function UserCard({
  actor,
  draft,
  saving,
  deleting,
  isNew,
  onChange,
  onSave,
  onDelete,
  onGeneratePassword,
  onTogglePassword,
}: {
  actor: Pick<CrmUser, "id" | "role"> | null;
  draft: UsersAccessDraft;
  saving: boolean;
  deleting: boolean;
  isNew: boolean;
  onChange: (id: string, patch: Partial<UsersAccessDraft>) => void;
  onSave: (draft: UsersAccessDraft) => void;
  onDelete: (draft: UsersAccessDraft) => void;
  onGeneratePassword: (id: string) => void;
  onTogglePassword: (id: string) => void;
}) {
  const editable = canEditUser(actor, draft);
  const deletable = canDeleteUser(actor, draft);
  const permissionsLocked = arePermissionsLocked(draft.role);
  const reportProfitGranted = draft.permissions.includes("reportProfit");
  const reportProfitEditable = canGrantReportProfit(actor, draft.role, draft.permissions);
  const readOnlyAdmin = actor?.role !== "admin" && draft.role === "admin";
  const payrollEditable = editable && draft.payrollAvailable && !saving && !deleting;
  const attendanceParticipant = !["admin", "owner"].includes(draft.role);

  const updatePayroll = (patch: Partial<UsersAccessDraft["payroll"]>) => {
    onChange(draft.id, { payroll: { ...draft.payroll, ...patch } });
  };

  const toggleBranch = (branch: string) => {
    const next = draft.branches.includes(branch)
      ? draft.branches.filter((item) => item !== branch)
      : [...draft.branches, branch];
    onChange(draft.id, { branches: next.length ? next : draft.branches });
  };

  const togglePermission = (permission: string) => {
    if (permissionsLocked) return;
    if (permission === "reportProfit" && !reportProfitEditable) return;
    if (permission === "editDocumentPrices" && !isDocumentPriceEditAllowed(draft.role)) return;
    const next = draft.permissions.includes(permission)
      ? draft.permissions.filter((item) => item !== permission)
      : [...draft.permissions, permission];
    onChange(draft.id, { permissions: normalizePermissions(draft.role, next) });
  };

  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.identity}>
          <div className={styles.avatar}>{initials(draft.name || draft.login)}</div>
          <div className={styles.identityText}>
            <div className={styles.nameRow}>
              <h2>{draft.name || draft.login}</h2>
              {isNew ? <span className={styles.newBadge}>Новый</span> : null}
            </div>
            <p>{draft.position || ROLE_LABELS[draft.role]}</p>
          </div>
        </div>

        <label className={styles.activeToggle}>
          <input
            type="checkbox"
            checked={draft.active}
            disabled={!editable || saving || deleting}
            onChange={(event) => onChange(draft.id, { active: event.target.checked })}
          />
          <span>Активен</span>
        </label>
      </div>

      {readOnlyAdmin ? (
        <div className={styles.noticeInline}>
          <ShieldAlert size={16} />
          <span>Главный администратор доступен владельцу только для просмотра.</span>
        </div>
      ) : null}

      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Имя</span>
          <input
            value={draft.name}
            disabled={!editable || saving || deleting}
            onChange={(event) => onChange(draft.id, { name: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Логин</span>
          <input
            value={draft.login}
            disabled={!editable || saving || deleting}
            onChange={(event) => onChange(draft.id, { login: normalizeLogin(event.target.value) })}
          />
        </label>
        <label className={styles.field}>
          <span>Должность</span>
          <input
            value={draft.position}
            disabled={!editable || saving || deleting}
            onChange={(event) => onChange(draft.id, { position: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>Оклад</span>
          <ClearableNumberInput
            min="0"
            max="10000000"
            value={draft.salary}
            disabled={!editable || saving || deleting}
            onValueChange={(salary) => onChange(draft.id, { salary })}
          />
        </label>
        <label className={styles.field}>
          <span>Роль</span>
          <select
            value={draft.role}
            disabled={!editable || saving || deleting}
            onChange={(event) => {
              const role = event.target.value as CrmRole;
              onChange(draft.id, {
                role,
                permissions: getNextPermissionsForRole(actor, role, draft.permissions, draft.permissions.length > 0),
              });
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role} disabled={role === "admin" && actor?.role !== "admin"}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Расчёт зарплаты</span>
          <select
            value={draft.payroll.enabled ? "enabled" : "disabled"}
            disabled={!payrollEditable}
            onChange={(event) => updatePayroll({ enabled: event.target.value === "enabled" })}
          >
            <option value="enabled">Участвует</option>
            <option value="disabled">Не участвует</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Открытие рабочей смены</span>
          <select
            value={draft.permissions.includes(ATTENDANCE_AUTO_PERMISSION) ? "automatic" : "manual"}
            disabled={!editable || saving || deleting || !attendanceParticipant || actor?.role !== "admin"}
            onChange={(event) => {
              const withoutMode = draft.permissions.filter((permission) => permission !== ATTENDANCE_AUTO_PERMISSION);
              const permissions = event.target.value === "automatic"
                ? [...withoutMode, ATTENDANCE_AUTO_PERMISSION]
                : withoutMode;
              onChange(draft.id, { permissions: normalizePermissions(draft.role, permissions) });
            }}
          >
            <option value="manual">Сотрудник открывает сам</option>
            <option value="automatic">Автоматически по графику</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Видимость табеля</span>
          <select
            value={draft.permissions.includes(ATTENDANCE_BRANCH_VIEW_PERMISSION) ? "branch" : "self"}
            disabled={!editable || saving || deleting || !attendanceParticipant || !actor || !["admin", "owner"].includes(actor.role)}
            onChange={(event) => {
              const withoutMode = draft.permissions.filter((permission) => permission !== ATTENDANCE_BRANCH_VIEW_PERMISSION);
              const permissions = event.target.value === "branch"
                ? [...withoutMode, ATTENDANCE_BRANCH_VIEW_PERMISSION]
                : withoutMode;
              onChange(draft.id, { permissions: normalizePermissions(draft.role, permissions) });
            }}
          >
            <option value="self">Только свои данные</option>
            <option value="branch">Все сотрудники своих филиалов</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Схема начисления</span>
          <select
            value={draft.payroll.scheme}
            disabled={!payrollEditable}
            onChange={(event) => updatePayroll({ scheme: event.target.value as PayrollScheme })}
          >
            {Object.entries(PAYROLL_SCHEME_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Процент, %</span>
          <ClearableNumberInput
            min="0"
            max="100"
            step="0.1"
            value={draft.payroll.percent}
            disabled={!payrollEditable || !isPercentPayrollScheme(draft.payroll.scheme)}
            onValueChange={(percent) => updatePayroll({ percent })}
          />
        </label>
        <label className={styles.field}>
          <span>База процента</span>
          <select
            value={draft.payroll.percentBase}
            disabled={!payrollEditable || !isPercentPayrollScheme(draft.payroll.scheme)}
            onChange={(event) => updatePayroll({ percentBase: event.target.value as PayrollPercentBase })}
          >
            {Object.entries(PAYROLL_PERCENT_BASE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {!draft.payrollAvailable ? (
        <div className={styles.noticeInline}>
          <ShieldAlert size={16} />
          <span>Настройки зарплаты появятся после связи сотрудника с МойСклад.</span>
        </div>
      ) : null}

      <div className={styles.sectionGrid}>
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <h3>Филиалы</h3>
            <p>Хотя бы один филиал обязателен.</p>
          </div>
          <div className={styles.chips}>
            {branchEntries.map(([branch, label]) => (
              <label key={branch} className={styles.chip}>
                <input
                  type="checkbox"
                  checked={draft.branches.includes(branch)}
                  disabled={!editable || saving || deleting}
                  onChange={() => toggleBranch(branch)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <h3>Разделы</h3>
            <p>Для admin и owner все права включены всегда.</p>
          </div>
          <div className={styles.permissionsGrid}>
            {permissionEntries.map(([permission, label]) => {
              const disabled = !editable
                || saving
                || deleting
                || permissionsLocked
                || (permission === "reportProfit" && (!isReportProfitAllowed(draft.role) || !reportProfitEditable))
                || (permission === "editDocumentPrices" && !isDocumentPriceEditAllowed(draft.role));
              return (
                <label key={permission} className={`${styles.permissionItem} ${disabled ? styles.disabled : ""}`}>
                  <input
                    type="checkbox"
                    checked={draft.permissions.includes(permission)}
                    disabled={disabled}
                    onChange={() => togglePermission(permission)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          {!isReportProfitAllowed(draft.role) ? (
            <p className={styles.hint}>Для этой роли прибыль в отчетности недоступна.</p>
          ) : null}
          {isReportProfitAllowed(draft.role) && !reportProfitEditable && !reportProfitGranted ? (
            <p className={styles.hint}>Выдавать доступ к прибыли может только admin.</p>
          ) : null}
        </section>
      </div>

      <div className={styles.passwordPanel}>
        <div className={styles.sectionHeader}>
          <h3>Пароль входа</h3>
          <p>{draft.passwordSet ? "Пароль установлен" : "Вход заблокирован: пароль не задан"}</p>
        </div>
        <div className={styles.passwordRow}>
          <input
            type={draft.passwordVisible ? "text" : "password"}
            value={draft.password}
            placeholder="Новый пароль"
            disabled={!editable || saving || deleting}
            onChange={(event) => onChange(draft.id, { password: event.target.value })}
          />
          <button type="button" className={styles.iconButton} onClick={() => onTogglePassword(draft.id)} disabled={!editable}>
            {draft.passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button type="button" className={styles.secondaryButton} onClick={() => onGeneratePassword(draft.id)} disabled={!editable || saving || deleting}>
            <KeyRound size={16} />
            Создать временный пароль
          </button>
        </div>
      </div>

      <div className={styles.cardFooter}>
        <div className={styles.salaryHint}>
          <UserRound size={16} />
          <span>Оклад, должность и схема начисления используются на странице зарплат.</span>
        </div>
        <div className={styles.footerActions}>
          <button
            type="button"
            className={styles.dangerButton}
            disabled={!deletable || saving || deleting}
            onClick={() => onDelete(draft)}
          >
            <Trash2 size={16} />
            Удалить везде
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!editable || saving || deleting}
            onClick={() => onSave(draft)}
          >
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function UsersAccessPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | CrmRole>("all");
  const [drafts, setDrafts] = useState<Record<string, UsersAccessDraft>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [newUserIds, setNewUserIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<UsersAccessDraft | null>(null);
  const [reassignmentTargetId, setReassignmentTargetId] = useState("");
  const [deletionProgress, setDeletionProgress] = useState("");
  const [deletionError, setDeletionError] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);

  const sessionQuery = useQuery({ queryKey: ["crm-session"], queryFn: getShellSession });
  const usersQuery = useQuery({ queryKey: ["crm-users"], queryFn: getCrmUsers });
  const payrollSettingsQuery = useQuery({ queryKey: ["payroll-employee-settings"], queryFn: getEmployeePayrollSettings });

  const actor = sessionQuery.data?.user ?? null;
  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const payrollByHref = useMemo(
    () => new Map((payrollSettingsQuery.data ?? []).map((item) => [item.employeeHref, item.payroll])),
    [payrollSettingsQuery.data],
  );
  const filteredUsers = useMemo(() => filterUsers(users, search, roleFilter), [users, search, roleFilter]);
  const reassignmentTargets = useMemo(() => users.filter((user) =>
    user.id !== deleteTarget?.id
    && user.active
    && (user.role === "admin" || user.role === "owner")
    && Boolean(user.moySkladEmployeeHref)
  ), [deleteTarget?.id, users]);

  const deletionImpactQuery = useQuery({
    queryKey: ["crm-user-deletion-impact", deleteTarget?.id],
    queryFn: () => getCrmUserDeletionImpact(deleteTarget?.id || ""),
    enabled: Boolean(deleteTarget?.id),
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: syncCrmUsersFromMoySklad,
    onSuccess: async (result) => {
      setNewUserIds(result.createdIds);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm-users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
      ]);
      const details = [
        `Новых: ${result.createdIds.length}`,
        `скрыто удалённых: ${result.deactivatedIds.length}`,
        `помечено удалёнными в МойСклад: ${result.skippedDeleted}`,
        `активных в МойСклад: ${result.activeEmployees}`,
      ];
      showToast({
        tone: "success",
        title: result.createdIds.length ? "Новые сотрудники добавлены" : "Список сотрудников актуален",
        description: details.join(" · "),
      });
    },
    onError: (error) => {
      showToast({
        tone: "error",
        title: "Не удалось проверить МойСклад",
        description: getErrorText(error),
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (draft: UsersAccessDraft) => {
      setSavingIds((current) => [...current, draft.id]);
      const payload: CrmUserUpdate = {
        name: draft.name,
        login: normalizeLogin(draft.login),
        position: draft.position,
        salary: draft.salary,
        role: draft.role,
        branches: draft.branches,
        permissions: normalizePermissions(draft.role, draft.permissions),
        active: draft.active,
        password: draft.password.trim() || undefined,
      };
      const user = await updateCrmUser(draft.id, payload);
      const payroll = {
        ...draft.payroll,
        monthlySalary: user.salary,
        customPosition: user.position,
      };
      if (draft.payrollAvailable && user.moySkladEmployeeHref) {
        await saveEmployeePayrollSettings(user.moySkladEmployeeHref, payroll);
      }
      return { user, payroll: draft.payrollAvailable ? payroll : undefined };
    },
    onSuccess: async ({ user, payroll }) => {
      setDrafts((current) => ({
        ...current,
        [user.id]: { ...toUserDraft(user, payroll), password: "", passwordVisible: false },
      }));
      showToast({ tone: "success", title: `Сотрудник «${user.name}» сохранен` });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm-users"] }),
        queryClient.invalidateQueries({ queryKey: ["payroll-employee-settings"] }),
      ]);
    },
    onError: (error) => {
      showToast({ tone: "error", title: "Не удалось сохранить сотрудника", description: getErrorText(error) });
    },
    onSettled: (_data, _error, draft) => {
      setSavingIds((current) => current.filter((id) => id !== draft.id));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ draft, targetUserId }: { draft: UsersAccessDraft; targetUserId: string }) => {
      setDeletingIds((current) => [...current, draft.id]);
      let totalProcessed = 0;
      for (let batch = 0; batch < 10_000; batch += 1) {
        const result = await reassignAndDeleteCrmUser(draft.id, targetUserId);
        totalProcessed += result.processed;
        setDeletionProgress(`Перенесено документов: ${totalProcessed}. Осталось: ${result.remaining}.`);
        if (result.completed) return { draft, result, totalProcessed };
        if (result.finalizationFailed) {
          throw new Error(result.moySkladRemoval?.reason || "Документы перенесены, но МойСклад не разрешил окончательное удаление сотрудника.");
        }
        if (result.processed <= 0) {
          throw new Error("Перенос остановлен: МойСклад не вернул документы для обработки.");
        }
      }
      throw new Error("Превышено допустимое количество пакетов переноса.");
    },
    onSuccess: async ({ draft, result, totalProcessed }) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[draft.id];
        return next;
      });
      setDeleteTarget(null);
      setDeletionProgress("");
      setDeletionError("");
      showToast({
        tone: "success",
        title: `Сотрудник «${draft.name}» удален навсегда`,
        description: `Перенесено документов: ${totalProcessed}. МойСклад: ${formatMoySkladRemoval(result.moySkladRemoval)}.`,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm-users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-report"] }),
      ]);
    },
    onError: (error) => {
      setDeletionError(getErrorText(error));
      showToast({ tone: "error", title: "Не удалось удалить сотрудника", description: getErrorText(error) });
    },
    onSettled: (_data, _error, payload) => {
      setDeletingIds((current) => current.filter((id) => id !== payload.draft.id));
    },
  });

  const updateDraft = (id: string, patch: Partial<UsersAccessDraft>) => {
    setDrafts((current) => {
      const user = usersById.get(id);
      const draft = current[id] ?? (user ? toUserDraft(user, payrollByHref.get(user.moySkladEmployeeHref || "")) : null);
      if (!draft) return current;
      const next = { ...draft, ...patch };
      if ("role" in patch && patch.role) {
        next.permissions = normalizePermissions(next.role, next.permissions);
      }
      return { ...current, [id]: next };
    });
  };

  const handleGeneratePassword = async (id: string) => {
    const password = generatePassword();
    const copied = await copyPassword(password);
    updateDraft(id, { password, passwordVisible: true });
    showToast({
      tone: "success",
      title: copied ? "Временный пароль создан и скопирован" : "Временный пароль создан",
      description: copied ? "Нажмите «Сохранить»." : "Нажмите «Сохранить».",
    });
  };

  const handleDelete = (draft: UsersAccessDraft) => {
    const firstTarget = users.find((user) =>
      user.id !== draft.id
      && user.active
      && (user.role === "admin" || user.role === "owner")
      && Boolean(user.moySkladEmployeeHref)
    );
    setDeleteTarget(draft);
    setReassignmentTargetId(firstTarget?.id || "");
    setDeletionProgress("");
    setDeletionError("");
  };

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Управление доступом</span>
            <h1>Сотрудники</h1>
            <p>Роли, филиалы, разрешенные разделы и пароли входа.</p>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => setArchiveOpen(true)}>
              <ArchiveRestore size={16} />
              Архивные сотрудники
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <CloudDownload size={16} className={syncMutation.isPending ? styles.spin : ""} />
              {syncMutation.isPending ? "Проверяем..." : "Проверить МойСклад"}
            </button>
            <button className={styles.refreshButton} onClick={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
              <RefreshCw size={16} className={usersQuery.isFetching ? styles.spin : ""} />
              Обновить
            </button>
          </div>
        </header>

        <div className={styles.notice}>
          Важно: новый пароль применяется сразу. Уже открытая сессия сотрудника обновится после повторного входа.
        </div>

        {actor ? <CreateUserPanel actor={actor} /> : null}

        {usersQuery.isLoading ? <StatusPanel title="Загрузка сотрудников" description="Получаем учетные записи из CRM." /> : null}
        {usersQuery.error && isUnauthorizedError(usersQuery.error) ? <AuthRequired /> : null}

        {!usersQuery.isLoading && !usersQuery.error ? (
          <>
            <section className={styles.toolbar}>
              <div className={styles.toolbarHeader}>
                <div>
                  <h2>Учетные записи</h2>
                  <p>{filteredUsers.length} сотрудников</p>
                </div>
              </div>
              <div className={styles.filters}>
                <input
                  placeholder="Поиск по имени, логину, должности"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | CrmRole)}>
                  <option value="all">Все роли</option>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <div className={styles.cards}>
              {filteredUsers.map((user) => {
                const draft = drafts[user.id]
                  ? {
                      ...toUserDraft(user, payrollByHref.get(user.moySkladEmployeeHref || "")),
                      ...drafts[user.id],
                      password: drafts[user.id].password,
                      passwordVisible: drafts[user.id].passwordVisible,
                    }
                  : toUserDraft(user, payrollByHref.get(user.moySkladEmployeeHref || ""));
                return (
                  <UserCard
                    key={user.id}
                    actor={actor}
                    draft={draft}
                    saving={savingIds.includes(user.id)}
                    deleting={deletingIds.includes(user.id)}
                    isNew={newUserIds.includes(user.id)}
                    onChange={updateDraft}
                    onSave={(value) => saveMutation.mutate(value)}
                    onDelete={handleDelete}
                    onGeneratePassword={handleGeneratePassword}
                    onTogglePassword={(id) => updateDraft(id, { passwordVisible: !draft.passwordVisible })}
                  />
                );
              })}
            </div>

            {filteredUsers.length === 0 ? <StatusPanel title="Сотрудники не найдены" description="Измени поиск или фильтр роли." /> : null}
          </>
        ) : null}
      </div>
      {deleteTarget ? (
        <DeleteUserDialog
          source={deleteTarget}
          targets={reassignmentTargets}
          impact={deletionImpactQuery.data}
          loadingImpact={deletionImpactQuery.isLoading || deletionImpactQuery.isFetching}
          running={deleteMutation.isPending}
          progress={deletionProgress}
          error={deletionError || (deletionImpactQuery.error ? getErrorText(deletionImpactQuery.error) : "")}
          selectedTargetId={reassignmentTargetId}
          onSelectTarget={setReassignmentTargetId}
          onClose={() => {
            if (deleteMutation.isPending) return;
            setDeleteTarget(null);
            setDeletionProgress("");
            setDeletionError("");
          }}
          onConfirm={() => {
            if (!reassignmentTargetId || deleteMutation.isPending) return;
            setDeletionError("");
            deleteMutation.mutate({ draft: deleteTarget, targetUserId: reassignmentTargetId });
          }}
        />
      ) : null}
      {archiveOpen ? <ArchivedUsersDialog onClose={() => setArchiveOpen(false)} /> : null}
    </AppShell>
  );
}
