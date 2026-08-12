type RouteBucket = { requests: number; serverErrors: number; totalDurationMs: number; slowRequests: number; maxDurationMs: number };
type MinuteBucket = { minute: number; requests: number; serverErrors: number; totalDurationMs: number; slowRequests: number; routes: Map<string, RouteBucket> };

const WINDOW_MINUTES = 15;
const buckets = new Map<number, MinuteBucket>();

function currentMinute() {
  return Math.floor(Date.now() / 60_000);
}

function prune(nowMinute: number) {
  for (const minute of buckets.keys()) {
    if (minute < nowMinute - WINDOW_MINUTES + 1) buckets.delete(minute);
  }
}

function safeRouteName(route: string | undefined) {
  if (!route || route.length > 160) return "unknown";
  return route.split("?")[0] || "unknown";
}

export function recordHttpResponse(statusCode: number, durationMs: number, route?: string) {
  const minute = currentMinute();
  prune(minute);
  const bucket = buckets.get(minute) ?? { minute, requests: 0, serverErrors: 0, totalDurationMs: 0, slowRequests: 0, routes: new Map() };
  const elapsed = Math.max(0, durationMs);
  bucket.requests += 1;
  bucket.totalDurationMs += elapsed;
  if (statusCode >= 500) bucket.serverErrors += 1;
  if (durationMs >= 2_000) bucket.slowRequests += 1;
  const routeName = safeRouteName(route);
  const routeBucket = bucket.routes.get(routeName) ?? { requests: 0, serverErrors: 0, totalDurationMs: 0, slowRequests: 0, maxDurationMs: 0 };
  routeBucket.requests += 1;
  routeBucket.totalDurationMs += elapsed;
  routeBucket.maxDurationMs = Math.max(routeBucket.maxDurationMs, elapsed);
  if (statusCode >= 500) routeBucket.serverErrors += 1;
  if (durationMs >= 2_000) routeBucket.slowRequests += 1;
  bucket.routes.set(routeName, routeBucket);
  buckets.set(minute, bucket);
}

export function getHttpMetrics() {
  const minute = currentMinute();
  prune(minute);
  const active = [...buckets.values()];
  const requests = active.reduce((sum, item) => sum + item.requests, 0);
  const serverErrors = active.reduce((sum, item) => sum + item.serverErrors, 0);
  const totalDurationMs = active.reduce((sum, item) => sum + item.totalDurationMs, 0);
  const slowRequests = active.reduce((sum, item) => sum + item.slowRequests, 0);
  const routes = new Map<string, RouteBucket>();
  for (const bucket of active) {
    for (const [route, item] of bucket.routes) {
      const total = routes.get(route) ?? { requests: 0, serverErrors: 0, totalDurationMs: 0, slowRequests: 0, maxDurationMs: 0 };
      total.requests += item.requests;
      total.serverErrors += item.serverErrors;
      total.totalDurationMs += item.totalDurationMs;
      total.slowRequests += item.slowRequests;
      total.maxDurationMs = Math.max(total.maxDurationMs, item.maxDurationMs);
      routes.set(route, total);
    }
  }
  const slowestRoutes = [...routes.entries()]
    .map(([route, item]) => ({
      route,
      requests: item.requests,
      serverErrors: item.serverErrors,
      averageLatencyMs: Math.round(item.totalDurationMs / item.requests),
      maxLatencyMs: Math.round(item.maxDurationMs),
      slowRequests: item.slowRequests,
    }))
    .sort((a, b) => b.averageLatencyMs - a.averageLatencyMs || b.requests - a.requests)
    .slice(0, 5);
  return {
    windowMinutes: WINDOW_MINUTES,
    requests,
    serverErrors,
    errorRatePercent: requests > 0 ? Math.round((serverErrors / requests) * 10_000) / 100 : 0,
    averageLatencyMs: requests > 0 ? Math.round(totalDurationMs / requests) : 0,
    slowRequests,
    slowestRoutes,
  };
}

/** Isolated test helper; production code never needs to reset the rolling window. */
export function resetHttpMetricsForTests() {
  buckets.clear();
}
