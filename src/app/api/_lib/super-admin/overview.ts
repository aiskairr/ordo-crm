import "server-only";

import { getSuperAdminIntegrationChecks } from "./health-checks";
import { getSuperAdminDatabaseOverview } from "./repository";
import type { SuperAdminOverview } from "./types";

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getSuperAdminOverview(): Promise<SuperAdminOverview> {
  const database = await getSuperAdminDatabaseOverview();
  const integrations = await getSuperAdminIntegrationChecks(database.configured);
  const tableCounts = new Map(database.tables.map((table) => [table.key, table.count || 0]));
  const warnings = database.tables.filter((table) => !table.exists).length
    + integrations.filter((integration) => integration.status !== "healthy").length;
  const hasErrors = integrations.some((integration) => integration.status === "error");

  return {
    system: {
      status: hasErrors ? "error" : warnings ? "warning" : "healthy",
      environment: process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development",
      version: String(process.env.ORDO_APP_VERSION || process.env.npm_package_version || "0.1.0"),
      build: String(process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 8),
      serverTime: new Date().toISOString(),
      timezone: "Asia/Bishkek",
      usdRate: positiveNumber(process.env.MOYSKLAD_REPORT_USD_RATE || process.env.MOYSKLAD_COST_USD_RATE, 88),
    },
    database: {
      configured: database.configured,
      status: database.status,
      message: database.message,
      tables: database.tables,
      migrationFile: "supabase/super-admin-infrastructure.sql",
    },
    integrations,
    summary: {
      modules: tableCounts.get("crm_modules") || 0,
      enabledModules: database.enabledModules,
      settings: tableCounts.get("crm_system_settings") || 0,
      integrations: tableCounts.get("crm_integrations") || 0,
      activeBranches: database.activeBranches,
      warnings,
    },
  };
}
