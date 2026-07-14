export type ShellUser = {
  name: string;
  role: string;
};

export const fallbackUser: ShellUser = {
  name: "Пользователь CRM",
  role: "cookie-сессия",
};
