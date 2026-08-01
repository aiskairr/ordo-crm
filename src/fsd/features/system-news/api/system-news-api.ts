import { normalizeSystemAnnouncements } from "@/src/fsd/entities/system-announcement";
import { apiClient } from "@/src/fsd/shared/api";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function getPublishedSystemNews() {
  const payload = asRecord(await apiClient<unknown>("/api/crm/news"));
  return normalizeSystemAnnouncements(payload.announcements).filter((item) => item.published);
}
