import { describe, expect, it } from "vitest";
import {
  applyNotificationPreferenceChanges,
  assertNotificationPreferenceChangeAllowed,
  defaultNotificationPreferences,
  isMandatoryNotificationTopic,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
} from "../../src/contexts/promotion/domain/delivery-preferences";
import { PromotionRuleError } from "../../src/contexts/promotion/domain/rule-error";

describe("Member notification preferences", () => {
  it("starts from a complete, fully-enabled topic/channel matrix", () => {
    const defaults = defaultNotificationPreferences();
    expect(defaults).toHaveLength(NOTIFICATION_TOPICS.length * NOTIFICATION_CHANNELS.length);
    expect(defaults.every((preference) => preference.enabled)).toBe(true);
  });

  it("never lets a Member disable a mandatory transactional or security topic", () => {
    expect(isMandatoryNotificationTopic("TRANSACTIONAL")).toBe(true);
    expect(isMandatoryNotificationTopic("SECURITY")).toBe(true);
    expect(isMandatoryNotificationTopic("PROMOTIONAL")).toBe(false);
    expect(() =>
      assertNotificationPreferenceChangeAllowed({
        topic: "TRANSACTIONAL",
        channel: "SMS",
        enabled: false,
      }),
    ).toThrow(PromotionRuleError);

    const resolved = applyNotificationPreferenceChanges([], [
      { topic: "TRANSACTIONAL", channel: "SMS", enabled: true },
      { topic: "PROMOTIONAL", channel: "SMS", enabled: false },
    ]);
    // The stored matrix can never contradict the policy, even if a caller tries.
    expect(
      resolved.find((preference) => preference.topic === "PROMOTIONAL" && preference.channel === "SMS")
        ?.enabled,
    ).toBe(false);
    expect(
      resolved.find((preference) => preference.topic === "SECURITY" && preference.channel === "PUSH")
        ?.enabled,
    ).toBe(true);
  });

  it("applies a change set over the current matrix and keeps untouched entries", () => {
    const current = [
      { topic: "PROMOTIONAL" as const, channel: "EMAIL" as const, enabled: true, version: 3, updatedAt: new Date(0) },
    ];
    const resolved = applyNotificationPreferenceChanges(current, [
      { topic: "RESULT", channel: "PUSH", enabled: false },
    ]);
    expect(resolved).toHaveLength(NOTIFICATION_TOPICS.length * NOTIFICATION_CHANNELS.length);
    expect(
      resolved.find((preference) => preference.topic === "RESULT" && preference.channel === "PUSH")
        ?.enabled,
    ).toBe(false);
    expect(
      resolved.find((preference) => preference.topic === "PROMOTIONAL" && preference.channel === "EMAIL")
        ?.enabled,
    ).toBe(true);
  });

  it("rejects an unknown topic or channel instead of storing it", () => {
    expect(() =>
      assertNotificationPreferenceChangeAllowed({
        topic: "MARKETING" as never,
        channel: "SMS",
        enabled: true,
      }),
    ).toThrow(PromotionRuleError);
    expect(() =>
      assertNotificationPreferenceChangeAllowed({
        topic: "PROMOTIONAL",
        channel: "CARRIER_PIGEON" as never,
        enabled: true,
      }),
    ).toThrow(PromotionRuleError);
  });
});
