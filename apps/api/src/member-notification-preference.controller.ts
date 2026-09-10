import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { z, type ZodType } from "zod";
import {
  NotificationPreferenceService,
} from "../../../src/contexts/promotion/application/notification-preference.service";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TOPICS,
} from "../../../src/contexts/promotion/domain/delivery-preferences";
import { PromotionRuleError } from "../../../src/contexts/promotion/domain/rule-error";
import { promotionHttpException } from "./promotion-error.mapper";
import {
  MemberAuthGuard,
  type MemberAuthenticatedRequest,
} from "./member-auth.guard";

class NotificationPreferenceBody {
  @ApiProperty({ enum: [...NOTIFICATION_TOPICS] })
  topic!: string;

  @ApiProperty({ enum: [...NOTIFICATION_CHANNELS] })
  channel!: string;

  @ApiProperty({ type: Boolean })
  enabled!: boolean;

  @ApiProperty({ type: Number, description: "0 when the preference was never stored" })
  version!: number;

  @ApiProperty({ type: String, format: "date-time" })
  updatedAt!: Date;
}

class NotificationPreferencesBody {
  @ApiProperty({ type: String })
  memberId!: string;

  @ApiProperty({ type: NotificationPreferenceBody, isArray: true })
  items!: NotificationPreferenceBody[];
}

class UpdateNotificationPreferencesBody {
  @ApiProperty({ type: NotificationPreferenceBody, isArray: true })
  preferences!: Array<{ topic: string; channel: string; enabled: boolean }>;
}

const updateSchema = z.object({
  preferences: z
    .array(
      z.object({
        topic: z.enum(NOTIFICATION_TOPICS),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_TOPICS.length * NOTIFICATION_CHANNELS.length),
});

/**
 * Member notification preferences. The operation sets absolute topic/channel
 * values, so replaying an accepted request is a no-op; mandatory
 * (transactional/security) topics can never be disabled and are rejected rather
 * than silently ignored.
 */
@ApiTags("Member Notification Preferences")
@Controller("api/v1/member/notification-preferences")
@UseGuards(MemberAuthGuard)
export class MemberNotificationPreferenceController {
  constructor(
    @Inject(NotificationPreferenceService)
    private readonly preferences: NotificationPreferenceService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Read the Member's complete notification preference matrix" })
  @ApiOkResponse({ type: NotificationPreferencesBody })
  async list(@Req() request: MemberAuthenticatedRequest): Promise<NotificationPreferencesBody> {
    const result = await this.preferences.listPreferences(request.memberAuth!.memberId);
    return {
      memberId: result.memberId,
      items: result.items.map((item) => ({
        topic: item.topic,
        channel: item.channel,
        enabled: item.enabled,
        version: item.version,
        updatedAt: item.updatedAt,
      })),
    };
  }

  @Put()
  @ApiBearerAuth()
  @ApiBody({ type: UpdateNotificationPreferencesBody })
  @ApiOkResponse({ type: NotificationPreferencesBody })
  async update(
    @Req() request: MemberAuthenticatedRequest,
    @Body() body: UpdateNotificationPreferencesBody,
  ): Promise<NotificationPreferencesBody> {
    const input = parseBody(updateSchema, body);
    try {
      const result = await this.preferences.updatePreferences(
        request.memberAuth!.memberId,
        input.preferences,
      );
      return {
        memberId: result.memberId,
        items: result.items.map((item) => ({
          topic: item.topic,
          channel: item.channel,
          enabled: item.enabled,
          version: item.version,
          updatedAt: item.updatedAt,
        })),
      };
    } catch (error) {
      if (error instanceof PromotionRuleError) throw promotionHttpException(error);
      throw error;
    }
  }
}

function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: "preferences must list valid topic/channel pairs with a boolean enabled flag",
      details: {},
    });
  }
  return parsed.data;
}
