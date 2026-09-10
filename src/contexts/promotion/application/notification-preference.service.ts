import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  applyNotificationPreferenceChanges,
  assertNotificationPreferenceChangeAllowed,
  defaultNotificationPreferences,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
  type NotificationChannel,
  type NotificationPreferenceChange,
  type NotificationPreferenceRecord,
  type NotificationTopic,
} from "../domain/delivery-preferences";
import { PromotionRuleError } from "../domain/rule-error";

const PREFERENCE_SELECT = {
  topic: true,
  channel: true,
  enabled: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.MemberNotificationPreferenceSelect;

/**
 * Member notification preferences as a first-class Member resource.
 *
 * Reads always return the complete topic/channel matrix (materializing defaults
 * for entries the Member never touched), mandatory topics are always delivered,
 * and an update applies the whole accepted change set so a Member never ends up
 * with a partially stored preference set.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPreferences(memberId: string): Promise<{
    memberId: string;
    items: NotificationPreferenceRecord[];
  }> {
    const stored = await this.prisma.memberNotificationPreference.findMany({
      where: { memberId },
      select: PREFERENCE_SELECT,
    });
    const byKey = new Map(stored.map((row) => [`${row.topic}:${row.channel}`, row]));
    const items: NotificationPreferenceRecord[] = NOTIFICATION_TOPICS.flatMap((topic) =>
      NOTIFICATION_CHANNELS.map((channel) => {
        const existing = byKey.get(`${topic}:${channel}`);
        return {
          topic: topic as NotificationTopic,
          channel: channel as NotificationChannel,
          enabled: existing?.enabled ?? true,
          version: existing?.version ?? 0,
          updatedAt: existing?.updatedAt ?? new Date(0),
        };
      }),
    );
    return { memberId, items };
  }

  /**
   * Applies an accepted preference change set. The stored matrix always matches
   * the policy after the update: mandatory topics are forced on and every
   * topic/channel pair is materialized, so no consumer has to re-derive
   * defaults.
   */
  async updatePreferences(
    memberId: string,
    changes: readonly NotificationPreferenceChange[],
  ): Promise<{ memberId: string; items: NotificationPreferenceRecord[] }> {
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new PromotionRuleError(
        "VALIDATION_ERROR",
        "preferences must contain at least one topic/channel change",
      );
    }
    for (const change of changes) assertNotificationPreferenceChangeAllowed(change);

    await this.prisma.$transaction(async (tx) => {
      const stored = await tx.memberNotificationPreference.findMany({
        where: { memberId },
        select: PREFERENCE_SELECT,
      });
      const current: NotificationPreferenceRecord[] = stored.map((row) => ({
        topic: row.topic as NotificationTopic,
        channel: row.channel as NotificationChannel,
        enabled: row.enabled,
        version: row.version,
        updatedAt: row.updatedAt,
      }));
      const resolved = applyNotificationPreferenceChanges(current, changes);
      const storedByKey = new Map(stored.map((row) => [`${row.topic}:${row.channel}`, row]));

      for (const preference of resolved) {
        const existing = storedByKey.get(`${preference.topic}:${preference.channel}`);
        if (existing) {
          if (existing.enabled === preference.enabled) continue;
          await tx.memberNotificationPreference.update({
            where: {
              memberId_topic_channel: {
                memberId,
                topic: preference.topic,
                channel: preference.channel,
              },
            },
            data: { enabled: preference.enabled, version: { increment: 1 } },
          });
          continue;
        }
        await tx.memberNotificationPreference.create({
          data: {
            id: randomUUID(),
            memberId,
            topic: preference.topic,
            channel: preference.channel,
            enabled: preference.enabled,
            version: 1,
          },
        });
      }
    });

    return this.listPreferences(memberId);
  }

  /** The complete default matrix, used when no preference row exists yet. */
  defaults(): NotificationPreferenceChange[] {
    return defaultNotificationPreferences();
  }
}
