import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpMetrics, recordHttpResponse, resetHttpMetricsForTests } from "../src/services/httpMetrics.js";

describe("rolling HTTP metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"));
    resetHttpMetricsForTests();
  });

  afterEach(() => {
    resetHttpMetricsForTests();
    vi.useRealTimers();
  });

  it("aggregates errors, average latency and slow requests without request data", () => {
    recordHttpResponse(200, 100, "/api/dashboard");
    recordHttpResponse(503, 2_100, "/api/projects/:id");

    expect(getHttpMetrics()).toEqual({
      windowMinutes: 15,
      requests: 2,
      serverErrors: 1,
      errorRatePercent: 50,
      averageLatencyMs: 1_100,
      slowRequests: 1,
      slowestRoutes: [
        { route: "/api/projects/:id", requests: 1, serverErrors: 1, averageLatencyMs: 2_100, maxLatencyMs: 2_100, slowRequests: 1 },
        { route: "/api/dashboard", requests: 1, serverErrors: 0, averageLatencyMs: 100, maxLatencyMs: 100, slowRequests: 0 },
      ],
    });
  });

  it("expires buckets outside the 15 minute window", () => {
    recordHttpResponse(500, 3_000);
    vi.advanceTimersByTime(15 * 60_000);

    expect(getHttpMetrics()).toMatchObject({ requests: 0, serverErrors: 0, slowRequests: 0 });
  });

  it("uses route templates and never retains query strings", () => {
    recordHttpResponse(200, 240, "/api/projects/:id?token=never-store-this");

    expect(getHttpMetrics().slowestRoutes[0]).toMatchObject({ route: "/api/projects/:id", requests: 1 });
  });
});
