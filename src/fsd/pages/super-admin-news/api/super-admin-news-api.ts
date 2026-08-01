import { normalizeSystemAnnouncements, type SystemAnnouncement } from "@/src/fsd/entities/system-announcement";
import { apiClient } from "@/src/fsd/shared/api";

type NewsInput = Pick<SystemAnnouncement, "title" | "message" | "important" | "published">;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function getSuperAdminNews() {
  const payload = asRecord(await apiClient<unknown>("/api/super-admin/news"));
  return normalizeSystemAnnouncements(payload.announcements);
}

export async function createSuperAdminNews(input: NewsInput) {
  return apiClient<{ announcement: SystemAnnouncement }>("/api/super-admin/news", { method: "POST", body: input });
}

export async function updateSuperAdminNews(input: NewsInput & { id: string }) {
  const { id, ...body } = input;
  return apiClient<{ announcement: SystemAnnouncement }>(`/api/super-admin/news/${encodeURIComponent(id)}`, { method: "PUT", body });
}

export async function deleteSuperAdminNews(id: string) {
  return apiClient<{ ok: boolean }>(`/api/super-admin/news/${encodeURIComponent(id)}`, { method: "DELETE" });
}
