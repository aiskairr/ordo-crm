export type NavItem = {
  title: string;
  href: string;
  permission?: string;
  isReact?: boolean;
  group: "sales" | "finance" | "docs" | "tools" | "admin";
};

export const NAV_ITEMS: NavItem[] = [
  { title: "Продажи", href: "/sales", permission: "sales", isReact: true, group: "sales" },
  { title: "Продать в долг", href: "/debt-sale", permission: "debtSale", isReact: true, group: "sales" },
  { title: "Доставки", href: "/deliveries", permission: "deliveries", isReact: true, group: "sales" },
  { title: "Посещаемость", href: "/attendance", permission: "attendance", isReact: true, group: "admin" },
  { title: "Отчетность", href: "/reports", permission: "reports", isReact: true, group: "finance" },
  { title: "Банковские комиссии", href: "/bank-commissions", permission: "bankCommissions", isReact: true, group: "finance" },
  { title: "Расходы", href: "/expenses", permission: "expenses", isReact: true, group: "finance" },
  { title: "Зарплаты", href: "/payroll", permission: "payroll", isReact: true, group: "finance" },
  { title: "Счета юрлицам", href: "/commercial-documents", permission: "commercialDocuments", isReact: true, group: "docs" },
  { title: "Акт сверки", href: "/reconciliation", permission: "reconciliation", isReact: true, group: "docs" },
  { title: "WhatsApp рассылка", href: "/whatsapp-broadcast", permission: "whatsappBroadcast", isReact: true, group: "tools" },
  { title: "PDF-каталог", href: "/product-catalog", isReact: true, group: "tools" },
  { title: "Расчет цен", href: "/price-formula", permission: "priceFormula", isReact: true, group: "tools" },
  { title: "Калькулятор таможни", href: "/customs-calculator", permission: "customsCalculator", isReact: true, group: "tools" },
  { title: "Сотрудники и доступ", href: "/users-access", permission: "users", isReact: true, group: "admin" },
];
