import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";

export const LOTTERY_CONFIGURATION_STATES = ["DRAFT", "REVIEW", "PUBLISHED"] as const;
export type LotteryConfigurationState = (typeof LOTTERY_CONFIGURATION_STATES)[number];
export type LotteryConfigurationKind = "PRODUCT" | "BET_TYPE";
export type LotteryConfigurationAdminRole = "SUPER_ADMIN" | "ADMIN" | "AUDITOR";

export interface LotteryConfigurationActor {
  adminId: string;
  sessionId: string;
  role: LotteryConfigurationAdminRole;
}

export class LotteryConfigurationRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LotteryConfigurationRuleError";
  }
}

export interface LotteryConfigurationCommandResult {
  id: string;
  kind: LotteryConfigurationKind;
  state: LotteryConfigurationState;
  version: number;
  revision: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}

@Injectable()
export class LotteryConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(input: { actor: LotteryConfigurationActor }): Promise<{ id: string }> {
    const product = await this.prisma.lotteryProduct.create({ data: { id: randomUUID() } });
    await this.createAudit({
      actor: input.actor,
      action: "LOTTERY_PRODUCT_CREATE",
      resourceId: product.id,
      reason: "Create Lottery Product identity",
      outcome: "CREATED",
    });
    return { id: product.id };
  }

  async createBetType(input: {
    code: string;
    actor: LotteryConfigurationActor;
  }): Promise<{ id: string; code: string }> {
    const code = input.code.trim();
    if (!code) throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "Bet Type code is required");
    try {
      const betType = await this.prisma.lotteryBetType.create({
        data: { id: randomUUID(), code },
      });
      await this.createAudit({
        actor: input.actor,
        action: "LOTTERY_BET_TYPE_CREATE",
        resourceId: betType.id,
        reason: `Create Bet Type ${code}`,
        outcome: "CREATED",
      });
      return betType;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new LotteryConfigurationRuleError("LOTTERY_BET_TYPE_CODE_CONFLICT", "Bet Type code already exists", { code });
      }
      throw error;
    }
  }

  async createBetTypeVersion(input: {
    betTypeId: string;
    version: number;
    canonicalNumberFormat: string;
    validationPattern: string;
    defaultPayout: Prisma.InputJsonValue;
    minStakeMinor: bigint;
    maxStakeMinor: bigint;
    limitPolicyRef: string;
    restrictionPolicyRef: string;
    settlementRuleVersionRef: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    reason?: string;
    actor: LotteryConfigurationActor;
  }): Promise<LotteryConfigurationCommandResult> {
    validateVersionInput(input);
    const betType = await this.prisma.lotteryBetType.findUnique({ where: { id: input.betTypeId } });
    if (!betType) throw new NotFoundException("Bet Type not found");
    const version = await this.prisma.lotteryBetTypeVersion.create({
      data: {
        id: randomUUID(),
        betTypeId: input.betTypeId,
        version: input.version,
        state: "DRAFT",
        canonicalNumberFormat: input.canonicalNumberFormat.trim(),
        validationPattern: input.validationPattern.trim(),
        defaultPayout: input.defaultPayout,
        minStakeMinor: input.minStakeMinor,
        maxStakeMinor: input.maxStakeMinor,
        limitPolicyRef: input.limitPolicyRef.trim(),
        restrictionPolicyRef: input.restrictionPolicyRef.trim(),
        settlementRuleVersionRef: input.settlementRuleVersionRef.trim(),
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: input.effectiveUntil ?? null,
        reason: input.reason?.trim() || null,
        createdByAdminId: input.actor.adminId,
      },
    });
    return toResult("BET_TYPE", version);
  }

  async createProductVersion(input: {
    productId: string;
    version: number;
    timezone: string;
    scheduleTemplateRef: string;
    resultSchemaVersionRef: string;
    settlementRuleVersionRef: string;
    defaultPayoutPolicyRef: string;
    defaultLimitPolicyRef: string;
    defaultRestrictionPolicyRef: string;
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    reason?: string;
    enabledBetTypes: Array<{ betTypeId: string; betTypeVersionId: string }>;
    actor: LotteryConfigurationActor;
  }): Promise<LotteryConfigurationCommandResult> {
    validateVersionInput(input);
    const product = await this.prisma.lotteryProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw new NotFoundException("Lottery Product not found");
    const ids = new Set<string>();
    for (const reference of input.enabledBetTypes) {
      if (ids.has(reference.betTypeId)) {
        throw new LotteryConfigurationRuleError("DUPLICATE_BET_TYPE", "A Product version cannot enable a Bet Type more than once", { betTypeId: reference.betTypeId });
      }
      ids.add(reference.betTypeId);
    }
    const version = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lotteryProductVersion.create({
        data: {
          id: randomUUID(),
          productId: input.productId,
          version: input.version,
          state: "DRAFT",
          timezone: input.timezone.trim(),
          scheduleTemplateRef: input.scheduleTemplateRef.trim(),
          resultSchemaVersionRef: input.resultSchemaVersionRef.trim(),
          settlementRuleVersionRef: input.settlementRuleVersionRef.trim(),
          defaultPayoutPolicyRef: input.defaultPayoutPolicyRef.trim(),
          defaultLimitPolicyRef: input.defaultLimitPolicyRef.trim(),
          defaultRestrictionPolicyRef: input.defaultRestrictionPolicyRef.trim(),
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil ?? null,
          reason: input.reason?.trim() || null,
          createdByAdminId: input.actor.adminId,
          enabledBetTypes: {
            create: input.enabledBetTypes.map((reference) => reference),
          },
        },
      });
      return created;
    });
    return toResult("PRODUCT", version);
  }

  async submit(input: {
    kind: LotteryConfigurationKind;
    id: string;
    expectedRevision: number;
    actor: LotteryConfigurationActor;
  }): Promise<LotteryConfigurationCommandResult> {
    return this.transition(input, "REVIEW", "SUBMIT");
  }

  async publish(input: {
    kind: LotteryConfigurationKind;
    id: string;
    expectedRevision: number;
    actor: LotteryConfigurationActor;
    approvalId: string;
  }): Promise<LotteryConfigurationCommandResult> {
    const result = await this.transition(input, "PUBLISHED", "PUBLISH");
    await this.prisma.adminApprovalEvidence.update({
      where: { id: input.approvalId },
      data: { requestedVersion: result.revision },
    });
    return result;
  }

  private async transition(
    input: { kind: LotteryConfigurationKind; id: string; expectedRevision: number; actor: LotteryConfigurationActor },
    state: "REVIEW" | "PUBLISHED",
    action: "SUBMIT" | "PUBLISH",
  ): Promise<LotteryConfigurationCommandResult> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "expectedVersion must be a positive integer", { field: "expectedVersion" });
    }
    return this.prisma.$transaction(async (tx) => {
      const current = input.kind === "PRODUCT"
        ? await tx.lotteryProductVersion.findUnique({ where: { id: input.id } })
        : await tx.lotteryBetTypeVersion.findUnique({ where: { id: input.id } });
      if (!current) throw new NotFoundException("Lottery configuration version not found");
      if (current.revision !== input.expectedRevision) {
        throw new LotteryConfigurationRuleError("VERSION_CONFLICT", "Lottery configuration version is stale", { expectedVersion: input.expectedRevision, currentVersion: current.revision });
      }
      if (current.state !== (action === "SUBMIT" ? "DRAFT" : "REVIEW")) {
        throw new LotteryConfigurationRuleError("INVALID_STATE", `Cannot ${action.toLowerCase()} Lottery configuration from ${current.state}`, { state: current.state });
      }
      if (action === "PUBLISH" && current.createdByAdminId === input.actor.adminId && input.actor.role === "ADMIN") {
        throw new LotteryConfigurationRuleError("SELF_APPROVAL_FORBIDDEN", "An ADMIN cannot publish their own Lottery configuration version");
      }
      const updated = input.kind === "PRODUCT"
        ? await tx.lotteryProductVersion.update({ where: { id: input.id }, data: { state, revision: { increment: 1 } } })
        : await tx.lotteryBetTypeVersion.update({ where: { id: input.id }, data: { state, revision: { increment: 1 } } });
      await this.createAudit({
        tx,
        actor: input.actor,
        action: `LOTTERY_${input.kind}_VERSION_${action}`,
        resourceId: input.id,
        reason: `${action} Lottery ${input.kind.toLowerCase()} configuration version`,
        outcome: state,
      });
      return toResult(input.kind, updated);
    });
  }

  private async createAudit(input: {
    tx?: Prisma.TransactionClient;
    actor: LotteryConfigurationActor;
    action: string;
    resourceId: string;
    reason: string;
    outcome: string;
  }): Promise<void> {
    const db = input.tx ?? this.prisma;
    await db.auditRecord.create({
      data: {
        id: randomUUID(),
        actorAdminId: input.actor.adminId,
        actorRole: input.actor.role,
        sessionId: input.actor.sessionId,
        action: input.action,
        resourceType: `LOTTERY_${input.action.includes("BET_TYPE") ? "BET_TYPE" : "PRODUCT"}`,
        resourceId: input.resourceId,
        payloadHash: createHash("sha256").update(input.reason).digest("hex"),
        reason: input.reason,
        correlationId: randomUUID(),
        outcome: input.outcome,
      },
    });
  }
}

function validateVersionInput(input: {
  version: number;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  [key: string]: unknown;
}): void {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "version must be a positive integer", { field: "version" });
  }
  if (!(input.effectiveFrom instanceof Date) || !Number.isFinite(input.effectiveFrom.getTime())) {
    throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "effectiveFrom must be a valid instant", { field: "effectiveFrom" });
  }
  if (input.effectiveUntil !== undefined && input.effectiveUntil !== null) {
    if (!(input.effectiveUntil instanceof Date) || input.effectiveUntil.getTime() <= input.effectiveFrom.getTime()) {
      throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "effectiveUntil must be after effectiveFrom", { field: "effectiveUntil" });
    }
  }
}

function toResult(kind: LotteryConfigurationKind, row: { id: string; state: string; version: number; revision: number; effectiveFrom: Date; effectiveUntil: Date | null }): LotteryConfigurationCommandResult {
  return { id: row.id, kind, state: row.state as LotteryConfigurationState, version: row.version, revision: row.revision, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil };
}
