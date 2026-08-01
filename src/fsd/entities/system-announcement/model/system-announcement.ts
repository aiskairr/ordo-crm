export type SystemAnnouncement = {
  id: string;
  title: string;
  message: string;
  important: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizeSystemAnnouncements(value: unknown): SystemAnnouncement[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const row = asRecord(item);
    const id = asString(row.id);
    const title = asString(row.title);
    const message = asString(row.message);
    const createdAt = asString(row.createdAt);
    const updatedAt = asString(row.updatedAt);
    if (!id || !title || !message || !createdAt || !updatedAt) return [];
    return [{
      id,
      title,
      message,
      important: row.important === true,
      published: row.published === true,
      createdAt,
      updatedAt,
      publishedAt: asString(row.publishedAt) || null,
    }];
  });
}
