import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { OperationalAlert } from "../../apps/workers/src/operational-alert.sink";
import {
  RoutingOperationalAlertSink,
  WebhookOperationalAlertSink,
} from "../../apps/workers/src/operational-alert.sink";
import { resetEnvironmentForTests } from "../../src/platform/config/env";

function sampleAlert(): OperationalAlert {
  return {
    code: "LEDGER_WALLET_MISMATCH",
    severity: "ERROR",
    message: "Ledger-Wallet reconciliation detected a projection mismatch",
    occurredAt: new Date("2026-09-16T12:00:00.000Z"),
    fingerprint: ["LEDGER_WALLET_MISMATCH", "recon-1"],
    details: { memberId: "m-1", discrepancyCount: 3 },
  };
}

describe("WebhookOperationalAlertSink (W5-F2 alert delivery)", () => {
  const original = process.env.OPERATIONAL_ALERT_WEBHOOK_URLS;

  beforeEach(() => {
    process.env.OPERATIONAL_ALERT_WEBHOOK_URLS = "";
    resetEnvironmentForTests();
  });

  afterEach(() => {
    process.env.OPERATIONAL_ALERT_WEBHOOK_URLS = original;
    resetEnvironmentForTests();
    vi.unstubAllGlobals();
  });

  it("POSTs a JSON payload to each configured webhook with the alert fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPERATIONAL_ALERT_WEBHOOK_URLS = "http://127.0.0.1:9999/alerts,http://127.0.0.1:9998/a";
    resetEnvironmentForTests();

    const sink = new WebhookOperationalAlertSink();
    sink.emit(sampleAlert());
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) throw new Error("expected first fetch call");
    const [urlA, initA] = firstCall;
    expect(urlA).toBe("http://127.0.0.1:9999/alerts");
    expect(initA.method).toBe("POST");
    expect(initA.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(initA.body);
    expect(body.code).toBe("LEDGER_WALLET_MISMATCH");
    expect(body.occurredAt).toBe("2026-09-16T12:00:00.000Z");
    expect(body.details.memberId).toBe("m-1");
  });

  it("is a no-op when no webhook URLs are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const sink = new WebhookOperationalAlertSink();
    sink.emit(sampleAlert());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs but does not throw when delivery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    process.env.OPERATIONAL_ALERT_WEBHOOK_URLS = "http://127.0.0.1:1/x";
    resetEnvironmentForTests();

    const sink = new WebhookOperationalAlertSink();
    expect(() => sink.emit(sampleAlert())).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe("RoutingOperationalAlertSink (W5-F2 fan-out)", () => {
  it("emits to every composed sink", () => {
    const a = { emit: vi.fn() };
    const b = { emit: vi.fn() };
    const router = new RoutingOperationalAlertSink([a, b]);
    router.emit(sampleAlert());
    expect(a.emit).toHaveBeenCalledTimes(1);
    expect(b.emit).toHaveBeenCalledTimes(1);
  });

  it("continues to other sinks when one throws", () => {
    const failing = { emit: () => {
      throw new Error("boom");
    } };
    const ok = { emit: vi.fn() };
    const router = new RoutingOperationalAlertSink([failing, ok]);
    expect(() => router.emit(sampleAlert())).not.toThrow();
    expect(ok.emit).toHaveBeenCalledTimes(1);
  });
});
