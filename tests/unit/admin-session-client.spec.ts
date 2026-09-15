import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApi } from "../../apps/admin-web/app/control-plane/admin-api";

describe("Admin session client contract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses POST for the auth/me session probe", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "admin-1", capabilities: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new AdminApi();
    await api.accept("access-token");

    await api.request("auth/me", {});

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/auth/me");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("clears the token and keys when the session is explicitly cleared", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "admin-1", capabilities: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new AdminApi();
    await api.accept("access-token");
    api.clear();

    await api.request("auth/me", {});

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/auth/refresh");
  });
});
