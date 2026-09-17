import { describe, expect, it } from "vitest";
import { resolveOtlpSignalUrl } from "../../src/platform/observability/observability";

describe("resolveOtlpSignalUrl (W5-F1 OTLP endpoint contract)", () => {
  it("appends /v1/traces and /v1/metrics to a bare base endpoint", () => {
    expect(resolveOtlpSignalUrl("http://127.0.0.1:4318", "traces")).toBe(
      "http://127.0.0.1:4318/v1/traces",
    );
    expect(resolveOtlpSignalUrl("http://127.0.0.1:4318", "metrics")).toBe(
      "http://127.0.0.1:4318/v1/metrics",
    );
  });

  it("strips a trailing slash before appending the signal segment", () => {
    expect(resolveOtlpSignalUrl("http://collector:4318/", "traces")).toBe(
      "http://collector:4318/v1/traces",
    );
    expect(resolveOtlpSignalUrl("http://collector:4318/", "metrics")).toBe(
      "http://collector:4318/v1/metrics",
    );
  });

  it("handles a base that already carries a /v1 path", () => {
    expect(resolveOtlpSignalUrl("http://collector:4318/v1", "traces")).toBe(
      "http://collector:4318/v1/traces",
    );
    expect(resolveOtlpSignalUrl("http://collector:4318/v1", "metrics")).toBe(
      "http://collector:4318/v1/metrics",
    );
  });

  it("does not double-append when a full signal URL is supplied", () => {
    expect(resolveOtlpSignalUrl("http://collector:4318/v1/traces", "traces")).toBe(
      "http://collector:4318/v1/traces",
    );
    expect(resolveOtlpSignalUrl("http://collector:4318/v1/traces", "metrics")).toBe(
      "http://collector:4318/v1/metrics",
    );
    expect(resolveOtlpSignalUrl("http://collector:4318/v1/metrics", "metrics")).toBe(
      "http://collector:4318/v1/metrics",
    );
  });

  it("keeps traces and metrics on the same base host when a full trace URL is given", () => {
    const traces = resolveOtlpSignalUrl("http://collector:4318/v1/traces", "traces");
    const metrics = resolveOtlpSignalUrl("http://collector:4318/v1/traces", "metrics");
    expect(new URL(traces).host).toBe(new URL(metrics).host);
    expect(new URL(metrics).pathname).toBe("/v1/metrics");
  });
});
