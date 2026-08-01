export type SuperAdminHealthStatus = "healthy" | "warning" | "error" | "not_configured";

export type SuperAdminIntegrationStatus = {
  key: "supabase" | "moysklad" | "telegram" | "whatsapp";
  title: string;
  status: SuperAdminHealthStatus;
  configured: boolean;
  message: string;
  checkedAt: string;
  responseTimeMs: number | null;
};

export type SuperAdminTableStatus = {
  key: "crm_modules" | "crm_system_settings" | "crm_integrations" | "crm_branches";
  title: string;
  exists: boolean;
  count: number | null;
  error: string;
};

export type SuperAdminOverview = {
  system: {
    status: Exclude<SuperAdminHealthStatus, "not_configured">;
    environment: "production" | "development" | "test";
    version: string;
    build: string;
    serverTime: string;
    timezone: "Asia/Bishkek";
    usdRate: number;
  };
  database: {
    configured: boolean;
    status: SuperAdminHealthStatus;
    message: string;
    tables: SuperAdminTableStatus[];
    migrationFile: "supabase/super-admin-infrastructure.sql";
  };
  integrations: SuperAdminIntegrationStatus[];
  summary: {
    modules: number;
    enabledModules: number;
    settings: number;
    integrations: number;
    activeBranches: number;
    warnings: number;
  };
};
