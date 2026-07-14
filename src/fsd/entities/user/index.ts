export type CrmRole = "admin" | "owner" | "manager" | "seller" | "logistics" | "accountant" | "employee";

export type CrmUser = {
  id: string;
  name: string;
  login: string;
  position: string;
  salary: number;
  role: CrmRole;
  branches: string[];
  permissions: string[];
  active: boolean;
  passwordSet?: boolean;
  moySkladRemoval?: {
    status: "deleted" | "archived" | "not_found" | "skipped";
    reason?: string;
  };
};

export type CrmUserUpdate = Omit<CrmUser, "id"> & {
  password?: string;
};

export const ROLE_LABELS: Record<CrmRole, string> = {
  admin: "Главный администратор",
  owner: "Владелец",
  manager: "Менеджер",
  seller: "Продавец",
  logistics: "Логистика",
  accountant: "Бухгалтер",
  employee: "Сотрудник",
};
