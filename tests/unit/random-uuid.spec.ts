import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "../../apps/admin-web/app/lib/random-uuid";

const V4_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin-web randomUUID helper", () => {
  it("uses the native crypto.randomUUID path when it is available", () => {
    expect(typeof crypto.randomUUID).toBe("function");
    const value = randomUUID();
    expect(value).toMatch(V4_UUID);
  });

  it("falls back to crypto.getRandomValues when crypto.randomUUID is absent", () => {
    // Simulate the plain-HTTP UAT environment where randomUUID is undefined.
    const getRandomValues = vi.fn((array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) array[i] = i + 1;
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const mathRandom = vi.spyOn(Math, "random");

    const value = randomUUID();
    expect(value).toMatch(V4_UUID);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(mathRandom).not.toHaveBeenCalled();
    // Version nibble must be 4 and variant nibble must be 8..b.
    expect(value[14]).toBe("4");
    expect("89ab").toContain(value[19]);
    mathRandom.mockRestore();
  });

  it("requests fresh randomness on every fallback call", () => {
    let call = 0;
    const getRandomValues = vi.fn((array: Uint8Array) => {
      call += 1;
      for (let i = 0; i < array.length; i++) array[i] = (i + call) % 256;
      return array;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    const a = randomUUID();
    const b = randomUUID();
    expect(a).toMatch(V4_UUID);
    expect(b).toMatch(V4_UUID);
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
  });
});
