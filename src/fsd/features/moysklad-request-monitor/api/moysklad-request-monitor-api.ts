import { apiClient } from "@/src/fsd/shared/api";

export type MoySkladRateLimiterStats = {
  maxRequestsPerMinute: number;
  requestsLastMinute: number;
  remainingThisMinute: number;
  usagePercent: number;
  bucketDurationSeconds: number;
  requestsByBucket: number[];
  maxConcurrentRequests: number;
  queuedRequests: number;
  activeRequests: number;
  blockedUntil: string | null;
  totalStarted: number;
  total429: number;
  lastStartedAt: string | null;
  last429At: string | null;
};

type MonitorResponse = {
  stats: {
    tokenConfigured: boolean;
    rateLimiter: MoySkladRateLimiterStats;
  };
};

export async function getMoySkladRequestMonitor() {
  return apiClient<MonitorResponse>("/api/crm/moysklad-monitor");
}
