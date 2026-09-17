import { describe, expect, it } from "vitest";
import { MAX_CORRELATION_ID_LENGTH, resolveCorrelationId } from "../../apps/api/src/correlation";

describe("resolveCorrelationId (W5-F3 correlation binding)", () => {
  it("accepts a caller-supplied header within the length limit", () => {
    const id = "W5-CORR-0001";
    expect(resolveCorrelationId(id)).toBe(id);
  });

  it("generates a UUID when the header is absent", () => {
    const id = resolveCorrelationId(undefined);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates a UUID for an empty header", () => {
    expect(resolveCorrelationId("")).not.toBe("");
  });

  it("generates a UUID when the header exceeds the length limit", () => {
    const tooLong = "x".repeat(MAX_CORRELATION_ID_LENGTH + 1);
    expect(resolveCorrelationId(tooLong)).not.toBe(tooLong);
  });
});
