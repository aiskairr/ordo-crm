"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, X } from "lucide-react";
import { useState } from "react";
import type { CrmRole, CrmUser, CrmUserCreate } from "@/src/fsd/entities/user";
import { ROLE_LABELS } from "@/src/fsd/entities/user";
import { getErrorText } from "@/src/fsd/shared/lib/errors";
import { useToast } from "@/src/fsd/shared/ui/toast";
import { createCrmUser } from "../api/users-access-api";
import {
  BRANCHES,
  copyPassword,
  generatePassword,
  normalizeLogin,
  normalizePermissions,
  ROLE_DEFAULT_PERMISSIONS,
} from "../model/users-access-model";
import styles from "./create-user-panel.module.css";

const roles = Object.keys(ROLE_LABELS) as CrmRole[];
const branchEntries = Object.entries(BRANCHES);

function createInitialDraft(): CrmUserCreate {
  return {
    name: "",
    login: "",
    position: "Сотрудник",
    salary: 0,
    role: "seller",
    branches: ["ayu"],
    permissions: [...ROLE_DEFAULT_PERMISSIONS.seller],
    active: true,
    password: "",
  };
}

export function CreateUserPanel({ actor }: { actor: Pick<CrmUser, "role"> | null }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CrmUserCreate>(createInitialDraft);
  const [loginTouched, setLoginTouched] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const mutation = useMutation({
    mutationFn: createCrmUser,
    onSuccess: async (user) => {
      showToast({
        tone: "success",
        title: `Сотрудник «${user.name}» создан`,
        description: "Запись добавлена в МойСклад и Supabase.",
      });
      setDraft(createInitialDraft());
      setLoginTouched(false);
      setPasswordVisible(false);
      setOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["crm-users"] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
      ]);
    },
    onError: (error) => {
      showToast({
        tone: "error",
        title: "Не удалось создать сотрудника",
        description: getErrorText(error),
      });
    },
  });

  const patch = (value: Partial<CrmUserCreate>) => {
    setDraft((current) => ({ ...current, ...value }));
  };

  const toggleBranch = (branch: string) => {
    setDraft((current) => {
      const branches = current.branches.includes(branch)
        ? current.branches.filter((item) => item !== branch)
        : [...current.branches, branch];
      return { ...current, branches };
    });
  };

  const generateTemporaryPassword = async () => {
    const password = generatePassword();
    patch({ password });
    setPasswordVisible(true);
    const copied = await copyPassword(password);
    showToast({
      tone: "success",
      title: copied ? "Пароль создан и скопирован" : "Пароль создан",
    });
  };

  if (!open) {
    return (
      <button type="button" className={styles.openButton} onClick={() => setOpen(true)}>
        <Plus size={18} />
        Добавить сотрудника
      </button>
    );
  }

  const canSubmit = Boolean(
    draft.name.trim()
    && draft.login
    && draft.password.length >= 6
    && draft.branches.length,
  );

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <span>Новый сотрудник</span>
          <h2>МойСклад и CRM</h2>
          <p>Сотрудник будет создан в справочнике МойСклад и сразу получит учётную запись в Supabase.</p>
        </div>
        <button type="button" className={styles.closeButton} onClick={() => setOpen(false)} disabled={mutation.isPending}>
          <X size={18} />
        </button>
      </header>

      <div className={styles.grid}>
        <label>
          <span>Имя</span>
          <input
            value={draft.name}
            maxLength={120}
            onChange={(event) => {
              const name = event.target.value;
              patch({
                name,
                ...(!loginTouched ? { login: normalizeLogin(name) } : {}),
              });
            }}
            disabled={mutation.isPending}
            autoFocus
          />
        </label>
        <label>
          <span>Логин</span>
          <input
            value={draft.login}
            maxLength={60}
            onChange={(event) => {
              setLoginTouched(true);
              patch({ login: normalizeLogin(event.target.value) });
            }}
            disabled={mutation.isPending}
          />
        </label>
        <label>
          <span>Должность</span>
          <input
            value={draft.position}
            maxLength={120}
            onChange={(event) => patch({ position: event.target.value })}
            disabled={mutation.isPending}
          />
        </label>
        <label>
          <span>Оклад</span>
          <input
            type="number"
            min="0"
            max="10000000"
            value={draft.salary}
            onChange={(event) => patch({ salary: Number(event.target.value) || 0 })}
            disabled={mutation.isPending}
          />
        </label>
        <label>
          <span>Роль</span>
          <select
            value={draft.role}
            onChange={(event) => {
              const role = event.target.value as CrmRole;
              patch({
                role,
                permissions: normalizePermissions(role, ROLE_DEFAULT_PERMISSIONS[role]),
              });
            }}
            disabled={mutation.isPending}
          >
            {roles.map((role) => (
              <option key={role} value={role} disabled={role === "admin" && actor?.role !== "admin"}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.options}>
        <fieldset>
          <legend>Филиалы</legend>
          <div className={styles.branches}>
            {branchEntries.map(([branch, label]) => (
              <label key={branch}>
                <input
                  type="checkbox"
                  checked={draft.branches.includes(branch)}
                  onChange={() => toggleBranch(branch)}
                  disabled={mutation.isPending}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.password}>
          <span>Временный пароль</span>
          <div>
            <input
              type={passwordVisible ? "text" : "password"}
              value={draft.password}
              minLength={6}
              maxLength={200}
              onChange={(event) => patch({ password: event.target.value })}
              disabled={mutation.isPending}
            />
            <button type="button" onClick={generateTemporaryPassword} disabled={mutation.isPending}>
              <KeyRound size={16} />
              Создать
            </button>
          </div>
        </label>
      </div>

      <footer className={styles.footer}>
        <span>{draft.password && draft.password.length < 6 ? "Пароль должен содержать минимум 6 символов." : ""}</span>
        <button type="button" onClick={() => mutation.mutate(draft)} disabled={!canSubmit || mutation.isPending}>
          {mutation.isPending ? "Создаём..." : "Создать сотрудника"}
        </button>
      </footer>
    </section>
  );
}
