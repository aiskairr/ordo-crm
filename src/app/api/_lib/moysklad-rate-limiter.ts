import "server-only";

type Priority = "high" | "normal";

type QueueEntry = {
  priority: Priority;
  signal?: AbortSignal | null;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  onAbort?: () => void;
};

type LimiterState = {
  queue: QueueEntry[];
  active: number;
  nextStartAt: number;
  blockedUntil: number;
  timer: ReturnType<typeof setTimeout> | null;
  totalStarted: number;
  total429: number;
  startedAtMs: number[];
  lastStartedAt: string | null;
  last429At: string | null;
};

const MAX_REQUESTS_PER_MINUTE = 120;
const DEFAULT_MAX_CONCURRENCY = 2;

const globalWithLimiter = globalThis as typeof globalThis & {
  __ordoMoySkladLimiter?: LimiterState;
};

const state = globalWithLimiter.__ordoMoySkladLimiter ?? {
  queue: [],
  active: 0,
  nextStartAt: 0,
  blockedUntil: 0,
  timer: null,
  totalStarted: 0,
  total429: 0,
  startedAtMs: [],
  lastStartedAt: null,
  last429At: null,
};

globalWithLimiter.__ordoMoySkladLimiter = state;

// Keep hot-reload compatibility when the singleton was created by an older module version.
state.startedAtMs ??= [];

const MONITOR_WINDOW_MS = 60_000;
const MONITOR_BUCKET_MS = 5_000;

function pruneStartedRequests(now: number) {
  const cutoff = now - MONITOR_WINDOW_MS;
  const firstRelevantIndex = state.startedAtMs.findIndex((timestamp) => timestamp > cutoff);
  if (firstRelevantIndex === -1) {
    state.startedAtMs.length = 0;
    return;
  }
  if (firstRelevantIndex > 0) state.startedAtMs.splice(0, firstRelevantIndex);
}

function configuredLimit() {
  const parsed = Number(process.env.MOYSKLAD_MAX_REQUESTS_PER_MINUTE || MAX_REQUESTS_PER_MINUTE);
  return Math.max(1, Math.min(MAX_REQUESTS_PER_MINUTE, Number.isFinite(parsed) ? Math.floor(parsed) : MAX_REQUESTS_PER_MINUTE));
}

function configuredConcurrency() {
  const parsed = Number(process.env.MOYSKLAD_MAX_CONCURRENT_REQUESTS || DEFAULT_MAX_CONCURRENCY);
  return Math.max(1, Math.min(5, Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_MAX_CONCURRENCY));
}

function requestIntervalMs() {
  return Math.ceil(60_000 / configuredLimit());
}

function scheduleDrain(delayMs: number) {
  if (state.timer) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    drain();
  }, Math.max(0, delayMs));
  state.timer.unref?.();
}

function takeNextEntry() {
  const highPriorityIndex = state.queue.findIndex((entry) => entry.priority === "high");
  const index = highPriorityIndex >= 0 ? highPriorityIndex : 0;
  return state.queue.splice(index, 1)[0];
}

function drain() {
  if (!state.queue.length || state.active >= configuredConcurrency()) return;
  const now = Date.now();
  const waitMs = Math.max(state.nextStartAt, state.blockedUntil) - now;
  if (waitMs > 0) {
    scheduleDrain(waitMs);
    return;
  }

  const entry = takeNextEntry();
  if (!entry) return;
  if (entry.signal?.aborted) {
    entry.reject(entry.signal.reason ?? new DOMException("Запрос отменён", "AbortError"));
    drain();
    return;
  }
  if (entry.onAbort && entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);

  state.active += 1;
  state.nextStartAt = now + requestIntervalMs();
  state.totalStarted += 1;
  state.startedAtMs.push(now);
  pruneStartedRequests(now);
  state.lastStartedAt = new Date(now).toISOString();
  let released = false;
  entry.resolve(() => {
    if (released) return;
    released = true;
    state.active = Math.max(0, state.active - 1);
    drain();
  });

  if (state.queue.length) scheduleDrain(requestIntervalMs());
}

function acquire(priority: Priority, signal?: AbortSignal | null) {
  return new Promise<() => void>((resolve, reject) => {
    const entry: QueueEntry = { priority, signal, resolve, reject };
    if (signal) {
      entry.onAbort = () => {
        const index = state.queue.indexOf(entry);
        if (index >= 0) state.queue.splice(index, 1);
        reject(signal.reason ?? new DOMException("Запрос отменён", "AbortError"));
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    state.queue.push(entry);
    drain();
  });
}

function numericHeader(response: Response, name: string) {
  const parsed = Number(response.headers.get(name));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getMoySkladRetryDelayMs(response: Response) {
  const lognexDelay = numericHeader(response, "x-lognex-retry-after");
  if (lognexDelay !== null) return lognexDelay;
  const standardDelay = numericHeader(response, "retry-after");
  return standardDelay !== null ? standardDelay * 1000 : 1000;
}

function observeResponse(response: Response) {
  const now = Date.now();
  if (response.status === 429) {
    const delayMs = Math.max(500, getMoySkladRetryDelayMs(response));
    state.blockedUntil = Math.max(state.blockedUntil, now + delayMs);
    state.total429 += 1;
    state.last429At = new Date(now).toISOString();
  }

  const remaining = numericHeader(response, "x-ratelimit-remaining");
  const resetMs = numericHeader(response, "x-lognex-reset");
  if (remaining === 0 && resetMs !== null && resetMs > 0) {
    state.blockedUntil = Math.max(state.blockedUntil, now + resetMs);
  }
}

export async function moySkladRateLimitedFetch(url: string | URL, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase();
  const priority: Priority = method === "GET" || method === "HEAD" ? "normal" : "high";
  const release = await acquire(priority, init.signal);
  try {
    const response = await fetch(url, { ...init, cache: "no-store" });
    observeResponse(response);
    return response;
  } finally {
    release();
  }
}

export function getMoySkladRateLimiterStats() {
  const now = Date.now();
  pruneStartedRequests(now);
  const bucketCount = MONITOR_WINDOW_MS / MONITOR_BUCKET_MS;
  const requestsByBucket = Array.from({ length: bucketCount }, () => 0);
  const windowStart = now - MONITOR_WINDOW_MS;
  for (const timestamp of state.startedAtMs) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((timestamp - windowStart) / MONITOR_BUCKET_MS)));
    requestsByBucket[index] += 1;
  }
  const maxRequestsPerMinute = configuredLimit();
  const requestsLastMinute = state.startedAtMs.length;

  return {
    maxRequestsPerMinute,
    requestsLastMinute,
    remainingThisMinute: Math.max(0, maxRequestsPerMinute - requestsLastMinute),
    usagePercent: Math.min(100, Math.round((requestsLastMinute / maxRequestsPerMinute) * 100)),
    bucketDurationSeconds: MONITOR_BUCKET_MS / 1000,
    requestsByBucket,
    intervalMs: requestIntervalMs(),
    maxConcurrentRequests: configuredConcurrency(),
    queuedRequests: state.queue.length,
    activeRequests: state.active,
    blockedUntil: state.blockedUntil > Date.now() ? new Date(state.blockedUntil).toISOString() : null,
    totalStarted: state.totalStarted,
    total429: state.total429,
    lastStartedAt: state.lastStartedAt,
    last429At: state.last429At,
  };
}
