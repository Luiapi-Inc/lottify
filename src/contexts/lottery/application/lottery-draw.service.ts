import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  createPublishedBetTypeVersion,
  createPublishedLotteryProductVersion,
  type PublishedBetTypeVersion,
  type PublishedLotteryProductVersion,
} from "../domain/configuration-version";
import {
  assertBeforeDrawCutoff,
  createDrawCutoff,
  type DrawCutoff,
} from "../domain/draw-cutoff";
import {
  createDrawConfigurationSnapshot,
  type DrawConfigurationSnapshot,
} from "../domain/draw-configuration-snapshot";
import {
  type DrawLifecycleCommand,
  type DrawLifecycleContext,
  type DrawState,
  IllegalDrawTransitionError,
  transitionDraw,
} from "../domain/draw-lifecycle";
import {
  createDrawOverrideProposal,
  publishDrawOverride,
  resolveDrawOverrideConfiguration,
  revivePersistedDrawOverrideChanges,
  type DrawOverrideChanges,
  type PublishedDrawOverride,
  type ResolvedDrawOverrideConfiguration,
} from "../domain/draw-override";
import {
  planRollingDraws,
  type ExistingDrawGenerationState,
  type RollingDrawPlan,
} from "../domain/rolling-draw-planner";
import {
  applyScheduleOccurrenceException,
  createScheduleOccurrence,
  type ScheduleOccurrence,
  type ScheduleOccurrenceException,
} from "../domain/schedule-occurrence";

export type DrawActor = { adminId: string; sessionId: string; role: string };

type Payout = Record<string, unknown>;
type Restriction = Record<string, unknown>;

export class DrawRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DrawRuleError";
  }
}

export interface DrawSummary {
  id: string;
  productId: string;
  productVersionId: string;
  occurrenceIdentity: string;
  localDate: string;
  state: DrawState;
  version: number;
  openAt: Date;
  cutoffAt: Date;
  drawAt: Date;
  provenance: string;
}

export interface DrawBetTypeSnapshot {
  betTypeId: string;
  betTypeCode: string;
  betTypeVersionId: string;
  canonicalNumberFormat: string;
  validationPattern: string;
  payout: Payout;
  minStakeMinor: string;
  maxStakeMinor: string;
  limitPolicyRef: string;
  restrictionPolicyRef: string;
  settlementRuleVersionRef: string;
}

export interface DrawDetail extends DrawSummary {
  timezone: string;
  scheduleTemplateRef: string;
  resultSchemaVersionRef: string;
  settlementRuleVersionRef: string;
  defaultPayoutPolicyRef: string;
  defaultLimitPolicyRef: string;
  defaultRestrictionPolicyRef: string;
  resultSourceRef: string | null;
  overrideRevisionRef: string;
  cutoff: { cutoffAt: Date };
  serverNow: Date;
  allowedActions: DrawLifecycleCommand[];
  betTypes: DrawBetTypeSnapshot[];
}

export interface DrawListResult {
  items: DrawDetail[];
  nextCursor: string | null;
}

export interface DrawGenerationResult {
  created: DrawSummary[];
  preservedOccurrenceIdentities: string[];
  skippedOccurrenceIdentities: string[];
}

const DRAW_STATE_SET = new Set<string>([
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CLOSED",
  "RESULT_PENDING",
  "RESULT_CONFIRMED",
  "SETTLING",
  "SETTLED",
  "CANCELLING",
  "CANCELLED",
]);

@Injectable()
export class LotteryDrawService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  now(): Date {
    return new Date();
  }

  /** Latest PUBLISHED Product version effective at `asOf`, with its PUBLISHED Bet Type versions. */
  private async loadPublishedSnapshot(
    productId: string,
    asOf: Date,
  ): Promise<{ snapshot: DrawConfigurationSnapshot<Payout> }> {
    const productVersion = await this.prisma.lotteryProductVersion.findFirst({
      where: {
        productId,
        state: "PUBLISHED",
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: asOf } }],
      },
      orderBy: { effectiveFrom: "desc" },
      include: {
        enabledBetTypes: {
          include: { betType: true, betTypeVersion: true },
        },
      },
    });
    if (!productVersion) {
      throw new DrawRuleError(
        "PRODUCT_NOT_PUBLISHED",
        `Lottery Product ${productId} has no PUBLISHED version effective at ${asOf.toISOString()}`,
        409,
        { productId },
      );
    }

    const enabledBetTypes = productVersion.enabledBetTypes.map((link) => ({
      betTypeId: link.betTypeId,
      betTypeVersionId: link.betTypeVersionId,
    }));

    const publishedProduct: PublishedLotteryProductVersion =
      createPublishedLotteryProductVersion({
        id: productVersion.id,
        productId: productVersion.productId,
        timezone: productVersion.timezone,
        enabledBetTypes,
        scheduleTemplateRef: productVersion.scheduleTemplateRef,
        resultSchemaVersionRef: productVersion.resultSchemaVersionRef,
        settlementRuleVersionRef: productVersion.settlementRuleVersionRef,
        defaultPayoutPolicyRef: productVersion.defaultPayoutPolicyRef,
        defaultLimitPolicyRef: productVersion.defaultLimitPolicyRef,
        defaultRestrictionPolicyRef:
          productVersion.defaultRestrictionPolicyRef,
        effectiveFrom: productVersion.effectiveFrom,
        effectiveUntil: productVersion.effectiveUntil,
      });

    const betTypeVersions: PublishedBetTypeVersion<Payout>[] =
      productVersion.enabledBetTypes.map((link) => {
        if (link.betTypeVersion.state !== "PUBLISHED") {
          throw new DrawRuleError(
            "BET_TYPE_VERSION_NOT_PUBLISHED",
            `Product ${productId} enables Bet Type version ${link.betTypeVersionId} that is not PUBLISHED`,
            409,
            { betTypeVersionId: link.betTypeVersionId },
          );
        }
        return createPublishedBetTypeVersion<Payout>({
          id: link.betTypeVersion.id,
          betType: { id: link.betType.id, code: link.betType.code },
          canonicalNumberFormat: link.betTypeVersion.canonicalNumberFormat,
          validationPattern: link.betTypeVersion.validationPattern,
          defaultPayout: link.betTypeVersion.defaultPayout as Payout,
          minStakeMinor: link.betTypeVersion.minStakeMinor,
          maxStakeMinor: link.betTypeVersion.maxStakeMinor,
          limitPolicyRef: link.betTypeVersion.limitPolicyRef,
          restrictionPolicyRef: link.betTypeVersion.restrictionPolicyRef,
          settlementRuleVersionRef:
            link.betTypeVersion.settlementRuleVersionRef,
        });
      });

    const snapshot = createDrawConfigurationSnapshot<Payout>({
      productVersion: publishedProduct,
      betTypeVersions,
    });
    return { snapshot };
  }

  /**
   * Idempotent rolling generation. Plans new schedule occurrences through the
   * merged rolling-draw-planner and persists only the planned creations. A
   * second run with the same base occurrences creates nothing new (the planner
   * dedupes by occurrence identity and the (productId, occurrenceIdentity)
   * unique constraint absorbs any concurrent race).
   */
  async generateDraws(input: {
    productId: string;
    baseOccurrences: ScheduleOccurrence[];
    exceptions?: ScheduleOccurrenceException[];
    now?: Date;
    actor?: DrawActor;
  }): Promise<DrawGenerationResult> {
    const asOf = input.now ?? new Date();
    const { snapshot } = await this.loadPublishedSnapshot(input.productId, asOf);

    for (const occurrence of input.baseOccurrences) {
      createScheduleOccurrence(occurrence);
    }
    for (const exception of input.exceptions ?? []) {
      // Validate each exception against the occurrence it targets when present.
      const target = input.baseOccurrences.find(
        (occurrence) =>
          occurrence.occurrenceIdentity === exception.targetOccurrenceIdentity,
      );
      if (target) applyScheduleOccurrenceException(target, exception);
    }

    const existingRows = await this.prisma.lotteryDraw.findMany({
      where: { productId: input.productId },
      select: { occurrenceIdentity: true, provenance: true },
    });
    const existingDraws: ExistingDrawGenerationState[] = existingRows.map(
      (row) => ({
        productId: input.productId,
        occurrenceIdentity: row.occurrenceIdentity,
        hasManualOverride: row.provenance === "MANUAL_EXCEPTION",
        hasBusinessActivity: false,
      }),
    );

    const plan = planRollingDraws({
      productId: input.productId,
      baseOccurrences: input.baseOccurrences,
      exceptions: input.exceptions ?? [],
      existingDraws,
    });

    const created: DrawSummary[] = [];
    for (const creation of plan.create) {
      try {
        const summary = await this.createDrawFromSnapshot({
          productId: input.productId,
          occurrence: creation.occurrence,
          snapshot,
          actor: input.actor,
        });
        created.push(summary);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          // A concurrent generator committed the same occurrence first.
          continue;
        }
        throw error;
      }
    }

    return {
      created,
      preservedOccurrenceIdentities: [...plan.preservedOccurrenceIdentities],
      skippedOccurrenceIdentities: [...plan.skippedOccurrenceIdentities],
    };
  }

  /** Persist a single Draw from a validated occurrence + config snapshot. */
  private async createDrawFromSnapshot(input: {
    productId: string;
    occurrence: ScheduleOccurrence;
    snapshot: DrawConfigurationSnapshot<Payout>;
    actor?: DrawActor;
  }): Promise<DrawSummary> {
    const occurrence = createScheduleOccurrence(input.occurrence);
    const draw = await this.prisma.lotteryDraw.create({
      data: {
        id: randomUUID(),
        productId: input.productId,
        productVersionId: input.snapshot.productVersionId,
        occurrenceIdentity: occurrence.occurrenceIdentity,
        localDate: occurrence.localDate,
        state: "DRAFT",
        version: 1,
        openAt: occurrence.openAt,
        cutoffAt: occurrence.cutoffAt,
        drawAt: occurrence.drawAt,
        provenance: occurrence.provenance,
        timezone: input.snapshot.timezone,
        scheduleTemplateRef: input.snapshot.scheduleTemplateRef,
        resultSchemaVersionRef: input.snapshot.resultSchemaVersionRef,
        settlementRuleVersionRef: input.snapshot.settlementRuleVersionRef,
        defaultPayoutPolicyRef: input.snapshot.defaultPayoutPolicyRef,
        defaultLimitPolicyRef: input.snapshot.defaultLimitPolicyRef,
        defaultRestrictionPolicyRef:
          input.snapshot.defaultRestrictionPolicyRef,
        createdByAdminId: input.actor?.adminId ?? null,
        betTypes: {
          create: input.snapshot.betTypes.map((betType) => ({
            id: randomUUID(),
            betTypeId: betType.betTypeId,
            betTypeCode: betType.betTypeCode,
            betTypeVersionId: betType.betTypeVersionId,
            canonicalNumberFormat: betType.canonicalNumberFormat,
            validationPattern: betType.validationPattern,
            payout: betType.payout as Prisma.InputJsonValue,
            minStakeMinor: betType.minStakeMinor,
            maxStakeMinor: betType.maxStakeMinor,
            limitPolicyRef: betType.limitPolicyRef,
            restrictionPolicyRef: betType.restrictionPolicyRef,
            settlementRuleVersionRef: betType.settlementRuleVersionRef,
          })),
        },
      },
    });
    return toSummary(draw);
  }

  /** Create a single Draw from an explicit occurrence (manual/exceptional). */
  async createDraw(input: {
    productId: string;
    occurrence: ScheduleOccurrence;
    now?: Date;
    actor?: DrawActor;
  }): Promise<DrawDetail> {
    const asOf = input.now ?? new Date();
    const { snapshot } = await this.loadPublishedSnapshot(input.productId, asOf);
    const summary = await this.createDrawFromSnapshot({
      productId: input.productId,
      occurrence: input.occurrence,
      snapshot,
      actor: input.actor,
    });
    return this.getDraw(summary.id);
  }

  /**
   * Transition a Draw's lifecycle through the merged state machine. Illegal or
   * skipped transitions are rejected deterministically; optimistic concurrency
   * on the Draw `version` prevents lost lifecycle updates.
   */
  async transition(input: {
    id: string;
    command: DrawLifecycleCommand;
    expectedVersion: number;
    context?: DrawLifecycleContext;
    actor?: DrawActor;
  }): Promise<DrawDetail> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new DrawRuleError(
        "VALIDATION_ERROR",
        "expectedVersion must be a positive integer",
        400,
        { field: "expectedVersion" },
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM lottery_draws WHERE id = ${input.id}::uuid FOR UPDATE`;
      const current = await tx.lotteryDraw.findUnique({
        where: { id: input.id },
      });
      if (!current) {
        throw new NotFoundException(`Lottery Draw ${input.id} not found`);
      }
      if (current.version !== input.expectedVersion) {
        throw new DrawRuleError(
          "DRAW_VERSION_CONFLICT",
          `Lottery Draw version is stale (expected ${input.expectedVersion}, current ${current.version})`,
          409,
          { expectedVersion: input.expectedVersion, currentVersion: current.version },
        );
      }
      let nextState: DrawState;
      try {
        nextState = transitionDraw(
          current.state as DrawState,
          input.command,
          input.context ?? {},
        );
      } catch (error) {
        if (error instanceof IllegalDrawTransitionError) {
          throw new DrawRuleError(
            "ILLEGAL_DRAW_TRANSITION",
            error.message,
            409,
            { state: error.state, command: error.command },
          );
        }
        throw error;
      }
      const updated = await tx.lotteryDraw.update({
        where: { id: input.id },
        data: { state: nextState, version: { increment: 1 } },
      });
      return this.toDetail(updated, this.now());
    });
  }

  /** Pure cutoff eligibility: strictly-before eligible; exact/beyond rejected. */
  async checkCutoffEligibility(input: {
    id: string;
    serverNow?: Date;
  }): Promise<{ eligible: boolean; cutoffAt: Date; serverNow: Date }> {
    const serverNow = input.serverNow ?? this.now();
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { id: input.id },
      select: { cutoffAt: true },
    });
    if (!draw) {
      throw new NotFoundException(`Lottery Draw ${input.id} not found`);
    }
    const cutoff: DrawCutoff = createDrawCutoff(draw.cutoffAt);
    let eligible = true;
    try {
      assertBeforeDrawCutoff(cutoff, serverNow);
    } catch {
      eligible = false;
    }
    return { eligible, cutoffAt: new Date(draw.cutoffAt.getTime()), serverNow };
  }

  /**
   * Betting gate for #33: the Draw must be OPEN and server time strictly before
   * the single canonical cutoff. Throws DRAW_NOT_OPEN / DRAW_CUTOFF_REACHED.
   */
  async assertDrawOpenForBets(
    id: string,
    serverNow?: Date,
  ): Promise<DrawDetail> {
    const asOf = serverNow ?? this.now();
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { id },
      include: { betTypes: true },
    });
    if (!draw) {
      throw new NotFoundException(`Lottery Draw ${id} not found`);
    }
    if (draw.state !== "OPEN") {
      throw new DrawRuleError(
        "DRAW_NOT_OPEN",
        `Draw ${id} is not accepting bets in state ${draw.state}`,
        409,
        { state: draw.state },
      );
    }
    try {
      assertBeforeDrawCutoff(createDrawCutoff(draw.cutoffAt), asOf);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Draw cutoff has been reached";
      throw new DrawRuleError("DRAW_CUTOFF_REACHED", message, 409, { cutoffAt: draw.cutoffAt });
    }
    return this.toDetail(draw, asOf);
  }

  async listDraws(input: {
    productId?: string;
    states?: DrawState[];
    limit?: number;
    cursor?: string;
    asOf?: Date;
  } = {}): Promise<DrawListResult> {
    const limit = boundedLimit(input.limit);
    const asOf = input.asOf ?? this.now();
    const where: Prisma.LotteryDrawWhereInput = {};
    if (input.productId) where.productId = input.productId;
    if (input.states && input.states.length > 0) where.state = { in: input.states };
    const rows = await this.prisma.lotteryDraw.findMany({
      where,
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { betTypes: true },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.toDetail(row, asOf)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async getDraw(id: string, asOf?: Date): Promise<DrawDetail> {
    const serverNow = asOf ?? this.now();
    const draw = await this.prisma.lotteryDraw.findUnique({
      where: { id },
      include: { betTypes: true },
    });
    if (!draw) {
      throw new NotFoundException(`Lottery Draw ${id} not found`);
    }
    return this.toDetail(draw, serverNow);
  }

  /**
   * Apply a governed, versioned Draw Override. Reuses the merged override
   * domain: builds the baseline from the persisted Draw + Bet Type snapshot +
   * published override chain, proposes, publishes against the current baseline,
   * persists the override and bumps the Draw's override revision.
   */
  async applyDrawOverride(input: {
    drawId: string;
    reason: string;
    actor: DrawActor;
    effectiveAt?: Date;
    changes: DrawOverrideChanges<Payout, Restriction>;
    approvalEvidenceRef: string;
    auditEvidenceRef: string;
  }): Promise<{ overrideId: string; overrideRevisionRef: string; drawId: string }> {
    const effectiveAt = input.effectiveAt ?? this.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM lottery_draws WHERE id = ${input.drawId}::uuid FOR UPDATE`;
      const draw = await tx.lotteryDraw.findUnique({
        where: { id: input.drawId },
        include: { betTypes: true, overrides: true },
      });
      if (!draw) {
        throw new NotFoundException(`Lottery Draw ${input.drawId} not found`);
      }
      const publishedOverrides = await this.publishedOverrideHistory(draw.id);
      const resolved = resolveDrawOverrideConfiguration<Payout, Restriction>(
        this.buildOverrideBaseline(draw),
        publishedOverrides,
        effectiveAt,
      );

      const supersedesOverrideId = [...publishedOverrides]
        .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
        .at(-1)?.id ?? null;

      const proposal = createDrawOverrideProposal<Payout, Restriction>({
        id: randomUUID(),
        supersedesOverrideId,
        baseline: {
          ...this.buildOverrideBaseline(draw),
          drawAt: resolved.drawAt,
          cutoffAt: resolved.cutoffAt,
          resultSourceRef: resolved.resultSourceRef,
          betTypes: resolved.betTypes,
        },
        effectiveAt,
        reason: input.reason,
        actorId: input.actor.adminId,
        changes: input.changes,
      });

      const published = publishDrawOverride<Payout, Restriction>({
        proposal,
        currentBaselineRevisionRef: draw.overrideRevisionRef || "base",
        currentDrawState: draw.state as DrawState,
        approvedPayloadDigest: proposal.payloadDigest,
        approvalEvidenceRef: input.approvalEvidenceRef,
        auditEvidenceRef: input.auditEvidenceRef,
        publishedAt: effectiveAt,
      });

      const created = await tx.lotteryDrawOverride.create({
        data: {
          id: proposal.id,
          drawId: draw.id,
          supersedesOverrideId,
          baselineRevisionRef: draw.overrideRevisionRef || "base",
          baselineState: draw.state,
          effectiveAt,
          reason: input.reason,
          actorAdminId: input.actor.adminId,
          changes: published.changes as unknown as Prisma.InputJsonValue,
          diff: published.diff as unknown as Prisma.InputJsonValue,
          impact: published.impact as unknown as Prisma.InputJsonValue,
          payloadDigest: proposal.payloadDigest,
          approvalEvidenceRef: input.approvalEvidenceRef,
          auditEvidenceRef: input.auditEvidenceRef,
          status: "PUBLISHED",
          publishedAt: effectiveAt,
        },
      });
      const newRevision = `${proposal.id}`;
      await tx.lotteryDraw.update({
        where: { id: draw.id },
        data: { overrideRevisionRef: newRevision, version: { increment: 1 } },
      });
      return { overrideId: created.id, overrideRevisionRef: newRevision, drawId: draw.id };
    });
  }

  private async publishedOverrideHistory(
    drawId: string,
  ): Promise<PublishedDrawOverride<Payout, Restriction>[]> {
    const rows = await this.prisma.lotteryDrawOverride.findMany({
      where: { drawId, status: "PUBLISHED" },
    });
    return rows.map((row) => ({
      id: row.id,
      drawId: row.drawId,
      supersedesOverrideId: row.supersedesOverrideId,
      baselineRevisionRef: row.baselineRevisionRef,
      baselineState: row.baselineState as DrawState,
      effectiveAt: row.effectiveAt,
      reason: row.reason,
      actorId: row.actorAdminId,
      changes: revivePersistedDrawOverrideChanges<Payout, Restriction>(row.changes),
      diff: row.diff as unknown as PublishedDrawOverride<Payout, Restriction>["diff"],
      impact: row.impact as unknown as PublishedDrawOverride<Payout, Restriction>["impact"],
      payloadDigest: row.payloadDigest,
      approvalEvidenceRef: row.approvalEvidenceRef ?? "",
      auditEvidenceRef: row.auditEvidenceRef ?? "",
      publishedAt: row.publishedAt ?? row.createdAt,
    }));
  }

  private buildOverrideBaseline(draw: {
    id: string;
    state: string;
    overrideRevisionRef: string;
    drawAt: Date;
    cutoffAt: Date;
    resultSourceRef: string | null;
    betTypes: Array<{
      betTypeId: string;
      payout: Prisma.JsonValue;
      minStakeMinor: bigint;
      maxStakeMinor: bigint;
    }>;
  }) {
    return {
      drawId: draw.id,
      revisionRef: draw.overrideRevisionRef || "base",
      state: draw.state as DrawState,
      drawAt: new Date(draw.drawAt.getTime()),
      cutoffAt: new Date(draw.cutoffAt.getTime()),
      resultSourceRef: draw.resultSourceRef ?? "UNASSIGNED",
      betTypes: draw.betTypes.map((betType) => ({
        betTypeId: betType.betTypeId,
        payout: betType.payout as Payout,
        minStakeMinor: betType.minStakeMinor,
        maxStakeMinor: betType.maxStakeMinor,
        numberRestrictions: [] as Restriction[],
        bettingEnabled: true,
      })),
    };
  }

  private toDetail(
    row: {
      id: string;
      productId: string;
      productVersionId: string;
      occurrenceIdentity: string;
      localDate: string;
      state: string;
      version: number;
      openAt: Date;
      cutoffAt: Date;
      drawAt: Date;
      provenance: string;
      timezone: string;
      scheduleTemplateRef: string;
      resultSchemaVersionRef: string;
      settlementRuleVersionRef: string;
      defaultPayoutPolicyRef: string;
      defaultLimitPolicyRef: string;
      defaultRestrictionPolicyRef: string;
      resultSourceRef: string | null;
      overrideRevisionRef: string;
      betTypes?: Array<{
        betTypeId: string;
        betTypeCode: string;
        betTypeVersionId: string;
        canonicalNumberFormat: string;
        validationPattern: string;
        payout: Prisma.JsonValue;
        minStakeMinor: bigint;
        maxStakeMinor: bigint;
        limitPolicyRef: string;
        restrictionPolicyRef: string;
        settlementRuleVersionRef: string;
      }>;
    },
    asOf: Date,
  ): DrawDetail {
    return {
      ...toSummary(row),
      timezone: row.timezone,
      scheduleTemplateRef: row.scheduleTemplateRef,
      resultSchemaVersionRef: row.resultSchemaVersionRef,
      settlementRuleVersionRef: row.settlementRuleVersionRef,
      defaultPayoutPolicyRef: row.defaultPayoutPolicyRef,
      defaultLimitPolicyRef: row.defaultLimitPolicyRef,
      defaultRestrictionPolicyRef: row.defaultRestrictionPolicyRef,
      resultSourceRef: row.resultSourceRef,
      overrideRevisionRef: row.overrideRevisionRef,
      cutoff: { cutoffAt: new Date(row.cutoffAt.getTime()) },
      serverNow: new Date(asOf.getTime()),
      allowedActions: allowedDrawActions(row.state as DrawState),
      betTypes: (row.betTypes ?? []).map((betType) => ({
        betTypeId: betType.betTypeId,
        betTypeCode: betType.betTypeCode,
        betTypeVersionId: betType.betTypeVersionId,
        canonicalNumberFormat: betType.canonicalNumberFormat,
        validationPattern: betType.validationPattern,
        payout: betType.payout as Payout,
        minStakeMinor: betType.minStakeMinor.toString(),
        maxStakeMinor: betType.maxStakeMinor.toString(),
        limitPolicyRef: betType.limitPolicyRef,
        restrictionPolicyRef: betType.restrictionPolicyRef,
        settlementRuleVersionRef: betType.settlementRuleVersionRef,
      })),
    };
  }
}

function toSummary(row: {
  id: string;
  productId: string;
  productVersionId: string;
  occurrenceIdentity: string;
  localDate: string;
  state: string;
  version: number;
  openAt: Date;
  cutoffAt: Date;
  drawAt: Date;
  provenance: string;
}): DrawSummary {
  return {
    id: row.id,
    productId: row.productId,
    productVersionId: row.productVersionId,
    occurrenceIdentity: row.occurrenceIdentity,
    localDate: row.localDate,
    state: row.state as DrawState,
    version: row.version,
    openAt: row.openAt,
    cutoffAt: row.cutoffAt,
    drawAt: row.drawAt,
    provenance: row.provenance,
  };
}

function allowedDrawActions(state: DrawState): DrawLifecycleCommand[] {
  const allowed: DrawLifecycleCommand[] = [];
  for (const command of [
    "SCHEDULE",
    "OPEN",
    "CLOSE",
    "MARK_RESULT_PENDING",
    "CONFIRM_RESULT",
    "START_SETTLEMENT",
    "COMPLETE_SETTLEMENT",
    "REQUEST_CANCELLATION",
    "COMPLETE_CANCELLATION",
    "REOPEN",
  ] as const) {
    try {
      transitionDraw(state, command, {
        privilegedReopen: true,
        resultExists: false,
      });
      allowed.push(command);
    } catch (error) {
      if (!(error instanceof IllegalDrawTransitionError)) throw error;
    }
  }
  return allowed;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new DrawRuleError(
      "VALIDATION_ERROR",
      "limit must be an integer between 1 and 100",
      400,
      { field: "limit" },
    );
  }
  return value;
}

export function isDrawState(value: string): value is DrawState {
  return DRAW_STATE_SET.has(value);
}
