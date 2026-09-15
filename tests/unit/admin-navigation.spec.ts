import { describe, expect, it } from "vitest";
import { NAVIGATION_AREAS } from "../../apps/admin-web/app/control-plane/navigation";

describe("Admin navigation capability map", () => {
  it("distinguishes API-backed areas that do not yet have a UI", () => {
    const results = NAVIGATION_AREAS.find((area) => area.key === "results-settlement");
    const reconciliation = NAVIGATION_AREAS.find((area) => area.key === "reconciliation");
    const promotions = NAVIGATION_AREAS.find((area) => area.key === "promotions");

    expect(results).toMatchObject({
      serviceExposed: true,
      uiExposed: false,
      readCapability: "result.read",
    });
    expect(reconciliation).toMatchObject({
      serviceExposed: true,
      uiExposed: false,
      readCapability: "reconciliation.read",
    });
    expect(promotions).toMatchObject({
      serviceExposed: true,
      uiExposed: false,
      readCapability: "promotion.read",
    });
  });

  it("keeps unavailable capabilities distinct from API-backed areas", () => {
    expect(NAVIGATION_AREAS.find((area) => area.key === "betting-risk")).toMatchObject({
      serviceExposed: false,
      uiExposed: false,
    });
  });
});
