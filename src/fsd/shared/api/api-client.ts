export type ApiErrorPayload = {
  status: number;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = payload.status;
    this.details = payload.details;
  }
}

type RequestOptions = Omit<RequestInit, "body" | "credentials" | "headers"> & {
  body?: unknown;
  headers?: HeadersInit;
  timeoutMs?: number;
};

async function readResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (response.status === 204) {
    return null;
  }

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  return fallback;
}

export async function apiClient<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  const signal = options.signal;

  headers.set("Accept", "application/json");

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    if (signal) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    response = await fetch(url, {
      ...options,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError({
      status: 0,
      message: error instanceof DOMException && error.name === "AbortError" ? "API не отвечает. Проверьте backend и rewrite /api." : error instanceof Error ? error.message : "Не удалось выполнить запрос",
      details: error,
    });
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await readResponse(response);

  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      message: getErrorMessage(payload, `Ошибка запроса: ${response.status}`),
      details: payload,
    });
  }

  return payload as T;
}
