import { AsyncLocalStorage } from "node:async_hooks";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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

export interface LotteryConfigurationListResult<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class LotteryConfigurationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private readonly transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();
  private get db(): Prisma.TransactionClient { return this.transactionContext.getStore() ?? this.prisma; }
  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const active = this.transactionContext.getStore();
    if (active) return work(active);
    return this.prisma.$transaction(tx => this.transactionContext.run(tx, () => work(tx)));
  }

  async executeCommand(input: { scope: string; key: string; fingerprint: string; legacyFingerprint?: string; responseCode: number }, execute: () => Promise<unknown>): Promise<unknown> {
    return this.transaction(async tx => {
      // Same logical command serializes before reading its durable result.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([input.scope, input.key])}, 0))::text`;
      const prior = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: input.scope, key: input.key } } });
      if (prior) {
        if (prior.fingerprint !== input.fingerprint && prior.fingerprint !== input.legacyFingerprint) throw new LotteryConfigurationRuleError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different payload");
        if (prior.status === "COMPLETED" && prior.responseBody !== null) return prior.responseBody;
        // Legacy incomplete records need reconciliation; never replay an unknown effect.
        throw new LotteryConfigurationRuleError("IDEMPOTENCY_IN_PROGRESS", "Legacy command requires reconciliation", { status: prior.status });
      }
      const result = await execute();
      const responseBody = JSON.parse(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonValue;
      await tx.idempotencyRecord.create({ data: {
        scope: input.scope, key: input.key, fingerprint: input.fingerprint, responseCode: input.responseCode,
        status: "COMPLETED", responseBody, expiresAt: new Date("9999-12-31T23:59:59.999Z"),
      } });
      return responseBody;
    });
  }

  private async lockVersion(tx: Prisma.TransactionClient, kind: LotteryConfigurationKind, id: string): Promise<void> {
    if (kind === "PRODUCT") await tx.$queryRaw`SELECT id FROM lottery_product_versions WHERE id = ${id}::uuid FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM lottery_bet_type_versions WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async listProducts(input: {
    limit?: number;
    cursor?: string;
    state?: LotteryConfigurationState;
  } = {}): Promise<LotteryConfigurationListResult<unknown>> {
    const limit = boundedLimit(input.limit);
    const rows = await this.db.lotteryProduct.findMany({
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: {
        versions: {
          where: input.state ? { state: input.state } : undefined,
          orderBy: { version: "desc" },
          select: { id: true, version: true, revision: true, state: true, effectiveFrom: true, effectiveUntil: true },
        },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        versions: row.versions.map(toVersionSummary),
      })),
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async getProduct(id: string, state?: LotteryConfigurationState): Promise<unknown> {
    const row = await this.db.lotteryProduct.findUnique({
      where: { id },
      include: {
        versions: {
          where: state ? { state } : undefined,
          orderBy: { version: "desc" },
          include: {
            enabledBetTypes: {
              include: {
                betType: { select: { id: true, code: true } },
                betTypeVersion: { select: { id: true, version: true, state: true, revision: true } },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException("Lottery Product not found");
    return {
      id: row.id,
      versions: row.versions.map((version) => ({
        ...toVersionSummary(version),
        timezone: version.timezone,
        scheduleTemplateRef: version.scheduleTemplateRef,
        resultSchemaVersionRef: version.resultSchemaVersionRef,
        settlementRuleVersionRef: version.settlementRuleVersionRef,
        defaultPayoutPolicyRef: version.defaultPayoutPolicyRef,
        defaultLimitPolicyRef: version.defaultLimitPolicyRef,
        defaultRestrictionPolicyRef: version.defaultRestrictionPolicyRef,
        enabledBetTypes: version.enabledBetTypes.map((link) => ({
          betTypeId: link.betType.id,
          betTypeCode: link.betType.code,
          betTypeVersionId: link.betTypeVersion.id,
          betTypeVersion: link.betTypeVersion.version,
          betTypeVersionState: link.betTypeVersion.state,
          betTypeVersionRevision: link.betTypeVersion.revision,
        })),
      })),
    };
  }

  async listBetTypes(input: {
    limit?: number;
    cursor?: string;
    state?: LotteryConfigurationState;
  } = {}): Promise<LotteryConfigurationListResult<unknown>> {
    const limit = boundedLimit(input.limit);
    const rows = await this.db.lotteryBetType.findMany({
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: {
        versions: {
          where: input.state ? { state: input.state } : undefined,
          orderBy: { version: "desc" },
          select: { id: true, version: true, revision: true, state: true, effectiveFrom: true, effectiveUntil: true },
        },
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => ({ id: row.id, code: row.code, versions: row.versions.map(toVersionSummary) })),
      nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null,
    };
  }

  async getBetType(id: string, state?: LotteryConfigurationState): Promise<unknown> {
    const row = await this.db.lotteryBetType.findUnique({
      where: { id },
      include: {
        versions: {
          where: state ? { state } : undefined,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!row) throw new NotFoundException("Lottery Bet Type not found");
    return {
      id: row.id,
      code: row.code,
      versions: row.versions.map((version) => ({
        ...toVersionSummary(version),
        canonicalNumberFormat: version.canonicalNumberFormat,
        validationPattern: version.validationPattern,
        defaultPayout: version.defaultPayout,
        minStakeMinor: version.minStakeMinor.toString(),
        maxStakeMinor: version.maxStakeMinor.toString(),
        limitPolicyRef: version.limitPolicyRef,
        restrictionPolicyRef: version.restrictionPolicyRef,
        settlementRuleVersionRef: version.settlementRuleVersionRef,
      })),
    };
  }

  async createProduct(input: { actor: LotteryConfigurationActor }): Promise<{ id: string }> {
    const product = await this.db.lotteryProduct.create({ data: { id: randomUUID() } });
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
      const betType = await this.db.lotteryBetType.create({
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
    const betType = await this.db.lotteryBetType.findUnique({ where: { id: input.betTypeId } });
    if (!betType) throw new NotFoundException("Bet Type not found");
    const version = await this.db.lotteryBetTypeVersion.create({
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
    const product = await this.db.lotteryProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw new NotFoundException("Lottery Product not found");
    const ids = new Set<string>();
    for (const reference of input.enabledBetTypes) {
      if (ids.has(reference.betTypeId)) {
        throw new LotteryConfigurationRuleError("DUPLICATE_BET_TYPE", "A Product version cannot enable a Bet Type more than once", { betTypeId: reference.betTypeId });
      }
      ids.add(reference.betTypeId);
    }
    const version = await this.transaction(async (tx) => {
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

  async approveAndPublish(input: {
    kind: LotteryConfigurationKind;
    id: string;
    expectedRevision: number;
    actor: LotteryConfigurationActor;
    reauthEvidenceId: string;
    correlationId: string;
  }): Promise<LotteryConfigurationCommandResult> {
    return this.transaction(async (tx) => {
      await this.lockVersion(tx, input.kind, input.id);
      const current = input.kind === "PRODUCT"
        ? await tx.lotteryProductVersion.findUnique({ where: { id: input.id }, include: { enabledBetTypes: { include: { betTypeVersion: true } } } })
        : await tx.lotteryBetTypeVersion.findUnique({ where: { id: input.id } });
      if (!current) throw new NotFoundException("Lottery configuration version not found");
      if (current.revision !== input.expectedRevision) {
        throw new LotteryConfigurationRuleError("VERSION_CONFLICT", "Lottery configuration version is stale", { expectedVersion: input.expectedRevision, currentVersion: current.revision });
      }
      if (current.state !== "REVIEW") {
        throw new LotteryConfigurationRuleError("INVALID_STATE", `Cannot publish Lottery configuration from ${current.state}`, { state: current.state });
      }
      if (current.createdByAdminId === input.actor.adminId && input.actor.role === "ADMIN") {
        throw new LotteryConfigurationRuleError("SELF_APPROVAL_FORBIDDEN", "An ADMIN cannot publish their own Lottery configuration version");
      }
      if (input.kind === "PRODUCT") {
        const product = current as typeof current & { enabledBetTypes: Array<{ betTypeVersion: { state: string } }> };
        if (product.enabledBetTypes.some((link) => link.betTypeVersion.state !== "PUBLISHED")) {
          throw new LotteryConfigurationRuleError("BET_TYPE_VERSION_NOT_PUBLISHED", "Every enabled Bet Type version must be published before the Product version", {});
        }
      }
      const payloadHash = createHash("sha256").update(`${input.kind}:${input.id}:${input.expectedRevision}`).digest("hex");
      const approval = await tx.adminApprovalEvidence.create({
        data: {
          id: randomUUID(),
          action: `LOTTERY_${input.kind}_VERSION_PUBLISH`,
          resourceType: `LOTTERY_${input.kind}_VERSION`,
          resourceId: input.id,
          requesterAdminId: current.createdByAdminId ?? input.actor.adminId,
          approverAdminId: input.actor.adminId,
          requestedVersion: input.expectedRevision,
          payloadHash,
          reason: `Publish Lottery ${input.kind.toLowerCase()} configuration version`,
          policyVersion: "lottery-configuration-publish-v1",
          reauthEvidenceId: input.reauthEvidenceId,
          correlationId: input.correlationId,
          approvedAt: new Date(),
        },
      });
      const updated = input.kind === "PRODUCT"
        ? await tx.lotteryProductVersion.update({ where: { id: input.id }, data: { state: "PUBLISHED", revision: { increment: 1 } } })
        : await tx.lotteryBetTypeVersion.update({ where: { id: input.id }, data: { state: "PUBLISHED", revision: { increment: 1 } } });
      await this.createAudit({
        tx,
        actor: input.actor,
        action: `LOTTERY_${input.kind}_VERSION_PUBLISH`,
        resourceId: input.id,
        reason: `Publish Lottery ${input.kind.toLowerCase()} configuration version`,
        outcome: "PUBLISHED",
        approvalId: approval.id,
        reauthEvidenceId: input.reauthEvidenceId,
        correlationId: input.correlationId,
      });
      return toResult(input.kind, updated);
    });
  }

  private async transition(
    input: { kind: LotteryConfigurationKind; id: string; expectedRevision: number; actor: LotteryConfigurationActor },
    state: "REVIEW" | "PUBLISHED",
    action: "SUBMIT" | "PUBLISH",
  ): Promise<LotteryConfigurationCommandResult> {
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "expectedVersion must be a positive integer", { field: "expectedVersion" });
    }
    return this.transaction(async (tx) => {
      await this.lockVersion(tx, input.kind, input.id);
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
    approvalId?: string;
    reauthEvidenceId?: string;
    correlationId?: string;
  }): Promise<void> {
    const db = input.tx ?? this.db;
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
        reauthEvidenceId: input.reauthEvidenceId ?? null,
        approvalId: input.approvalId ?? null,
        correlationId: input.correlationId ?? randomUUID(),
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

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new LotteryConfigurationRuleError("VALIDATION_ERROR", "limit must be an integer between 1 and 100", { field: "limit" });
  }
  return value;
}

function toVersionSummary(row: {
  id: string;
  version: number;
  revision: number;
  state: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
}) {
  return {
    id: row.id,
    version: row.version,
    revision: row.revision,
    state: row.state,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
  };
}

function toResult(kind: LotteryConfigurationKind, row: { id: string; state: string; version: number; revision: number; effectiveFrom: Date; effectiveUntil: Date | null }): LotteryConfigurationCommandResult {
  return { id: row.id, kind, state: row.state as LotteryConfigurationState, version: row.version, revision: row.revision, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil };
}
