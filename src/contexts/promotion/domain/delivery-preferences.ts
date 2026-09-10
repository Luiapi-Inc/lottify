import { PromotionRuleError } from "./rule-error";

/**
 * Member notification preferences. Topics that carry regulated or transactional
 * communication are mandatory: they can be shown but never disabled, and the
 * rule is enforced in one place instead of at each API boundary.
 */

export const NOTIFICATION_TOPICS = ["TRANSACTIONAL", "SECURITY", "PROMOTIONAL", "RESULT"] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export const NOTIFICATION_CHANNELS = ["PUSH", "SMS", "EMAIL"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Topics whose delivery is mandatory and can never be disabled by a Member. */
export const MANDATORY_NOTIFICATION_TOPICS: readonly NotificationTopic[] = [
  "TRANSACTIONAL",
  "SECURITY",
];

export interface NotificationPreferenceRecord {
  readonly topic: NotificationTopic;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface NotificationPreferenceChange {
  readonly topic: NotificationTopic;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export function isMandatoryNotificationTopic(topic: NotificationTopic): boolean {
  return MANDATORY_NOTIFICATION_TOPICS.includes(topic);
}

/** The complete default matrix a Member starts from: everything on. */
export function defaultNotificationPreferences(): NotificationPreferenceChange[] {
  return NOTIFICATION_TOPICS.flatMap((topic) =>
    NOTIFICATION_CHANNELS.map((channel) => ({ topic, channel, enabled: true })),
  );
}

export function assertNotificationPreferenceChangeAllowed(
  change: NotificationPreferenceChange,
): void {
  if (!NOTIFICATION_TOPICS.includes(change.topic)) {
    throw new PromotionRuleError("VALIDATION_ERROR", "Unknown notification topic", {
      topic: change.topic,
    });
  }
  if (!NOTIFICATION_CHANNELS.includes(change.channel)) {
    throw new PromotionRuleError("VALIDATION_ERROR", "Unknown notification channel", {
      channel: change.channel,
    });
  }
  if (!change.enabled && isMandatoryNotificationTopic(change.topic)) {
    throw new PromotionRuleError(
      "NOTIFICATION_PREFERENCE_MANDATORY",
      `${change.topic} notifications are mandatory and cannot be disabled`,
      { topic: change.topic, channel: change.channel },
    );
  }
}

/**
 * Applies a change set over the current preference matrix. Mandatory topics are
 * always forced on so a stored matrix can never contradict the policy, and a
 * changed entry bumps its version for optimistic concurrency.
 */
export function applyNotificationPreferenceChanges(
  current: readonly NotificationPreferenceRecord[],
  changes: readonly NotificationPreferenceChange[],
): NotificationPreferenceChange[] {
  const byKey = new Map<string, NotificationPreferenceChange>();
  for (const existing of current) {
    byKey.set(preferenceKey(existing.topic, existing.channel), {
      topic: existing.topic,
      channel: existing.channel,
      enabled: existing.enabled,
    });
  }
  for (const change of changes) {
    assertNotificationPreferenceChangeAllowed(change);
    byKey.set(preferenceKey(change.topic, change.channel), change);
  }
  return NOTIFICATION_TOPICS.flatMap((topic) =>
    NOTIFICATION_CHANNELS.map((channel) => {
      const resolved = byKey.get(preferenceKey(topic, channel));
      const enabled = isMandatoryNotificationTopic(topic) ? true : (resolved?.enabled ?? true);
      return { topic, channel, enabled };
    }),
  );
}

export function preferenceKey(topic: string, channel: string): string {
  return `${topic}:${channel}`;
}
