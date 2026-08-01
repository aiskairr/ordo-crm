import { apiClient } from "@/src/fsd/shared/api";

export type HealthStatus = "healthy" | "warning" | "error" | "not_configured";

export type SuperAdminOverview = {
  system: {
    status: Exclude<HealthStatus, "not_configured">;
    environment: "production" | "development" | "test";
    version: string;
    build: string;
    serverTime: string;
    timezone: string;
    usdRate: number;
  };
  database: {
    configured: boolean;
    status: HealthStatus;
    message: string;
    migrationFile: string;
    tables: Array<{ key: string; title: string; exists: boolean; count: number | null; error: string }>;
  };
  integrations: Array<{
    key: string;
    title: string;
    status: HealthStatus;
    configured: boolean;
    message: string;
    checkedAt: string;
    responseTimeMs: number | null;
  }>;
  summary: {
    modules: number;
    enabledModules: number;
    settings: number;
    integrations: number;
    activeBranches: number;
    warnings: number;
  };
};

export function getSuperAdminOverview() {
  return apiClient<SuperAdminOverview>("/api/super-admin/overview");
}
