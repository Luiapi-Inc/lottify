import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  MEMBER_CAPABILITIES,
  restrictionTypeForCapability,
  type MemberCapability,
  type MemberCapabilityRestrictionType,
} from "../domain/capability-restriction";
import { OnboardingRuleError } from "../domain/onboarding-error";
import {
  isSelfExclusionRestriction,
  normalAdminRemovalDisposition,
} from "../domain/self-exclusion";

/**
 * Admin governance of Member capability restrictions (Ticket 06).
 *
 * Setting a restriction applies one independent per-capability control with
 * source, reason, effective period and an actor-or-policy reference — never an
 * overloaded account status. Clearing is governed: a self-exclusion restriction
 * cannot be removed through the normal Admin path (responsible-gaming), and
 * every mutation is capability-guarded by the API layer and audited here.
 */
export interface AdminRestrictionActor {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
}

export interface SetCapabilityRestrictionCommand {
  readonly memberId: string;
  readonly capability: MemberCapability;
  readonly reason: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly actorOrPolicyRef: string;
  readonly actor: AdminRestrictionActor;
  readonly correlationId: string;
}

export interface CapabilityRestrictionView {
  readonly id: string;
  readonly memberId: string;
  readonly type: MemberCapabilityRestrictionType;
  readonly source: string;
  readonly reason: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly actorOrPolicyRef: string;
  readonly createdAt: Date;
}

export interface ClearCapabilityRestrictionResult {
  readonly id: string;
  readonly memberId: string;
  readonly removed: boolean;
}

export interface AdminRestrictionCommandInput {
  readonly scope: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly responseCode: number;
}

const ADMIN_RESTRICTION_SOURCE = "admin" as const;
const REASON_MAX_LENGTH = 500;

@Injectable()
export class CapabilityRestrictionAdminService {
  private readonly transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db(): Prisma.TransactionClient {
    return this.transactionContext.getStore() ?? this.prisma;
  }

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const active = this.transactionContext.getStore();
    if (active) return work(active);
    return this.prisma.$transaction((tx) => this.transactionContext.run(tx, () => work(tx)));
  }

  /**
   * Applies a per-capability restriction, idempotently and audited. The Member
   * must exist; the capability must be a locked Member capability.
   */
  async setRestriction(command: SetCapabilityRestrictionCommand): Promise<CapabilityRestrictionView> {
    const capability = parseCapability(command.capability);
    const reason = normalizeReason(command.reason);
    assertEffectiveWindow(command.effectiveFrom, command.effectiveUntil);

    return this.transaction(async (tx) => {
      const member = await tx.member.findUnique({
        where: { id: command.memberId },
        select: { id: true },
      });
      if (!member) {
        throw new OnboardingRuleError("NOT_FOUND", "Member not found", {
          memberId: command.memberId,
        });
      }

      const restriction = await tx.capabilityRestriction.create({
        data: {
          id: randomUUID(),
          memberId: command.memberId,
          type: restrictionTypeForCapability(capability),
          source: ADMIN_RESTRICTION_SOURCE,
          reason,
          effectiveFrom: command.effectiveFrom,
          effectiveUntil: command.effectiveUntil,
          actorOrPolicyRef: command.actorOrPolicyRef,
          createdByAdminId: command.actor.adminId,
        },
      });

      await tx.auditRecord.create({
        data: {
          id: randomUUID(),
          actorAdminId: command.actor.adminId,
          actorRole: command.actor.role,
          sessionId: command.actor.sessionId,
          action: "MEMBER_CAPABILITY_RESTRICTION_SET",
          resourceType: "MEMBER_CAPABILITY_RESTRICTION",
          resourceId: restriction.id,
          payloadHash: sha256(canonicalJson({ memberId: command.memberId, type: restriction.type, reason })),
          reason,
          correlationId: command.correlationId,
          outcome: "SET",
        },
      });

      return toRestrictionView(restriction);
    });
  }

  /**
   * Removes a restriction the Admin set. A self-exclusion restriction is not
   * removable through this normal Admin path.
   */
  async clearRestriction(input: {
    restrictionId: string;
    actor: AdminRestrictionActor;
    reason: string;
    correlationId: string;
  }): Promise<ClearCapabilityRestrictionResult> {
    const reason = normalizeReason(input.reason);

    return this.transaction(async (tx) => {
      const restriction = await tx.capabilityRestriction.findUnique({
        where: { id: input.restrictionId },
      });
      if (!restriction) {
        throw new OnboardingRuleError("NOT_FOUND", "Capability restriction not found", {
          restrictionId: input.restrictionId,
        });
      }

      const disposition = normalAdminRemovalDisposition({
        type: restriction.type as MemberCapabilityRestrictionType,
        source: restriction.source,
        reason: restriction.reason,
        effectiveFrom: restriction.effectiveFrom,
        effectiveUntil: restriction.effectiveUntil,
        actorOrPolicyRef: restriction.actorOrPolicyRef,
      });
      if (disposition === "DENY_SELF_EXCLUSION") {
        throw new OnboardingRuleError(
          "SELF_EXCLUSION_NOT_REMOVABLE",
          "A self-exclusion restriction cannot be removed through the normal Admin path",
          { restrictionId: input.restrictionId },
        );
      }

      await tx.capabilityRestriction.delete({ where: { id: input.restrictionId } });

      await tx.auditRecord.create({
        data: {
          id: randomUUID(),
          actorAdminId: input.actor.adminId,
          actorRole: input.actor.role,
          sessionId: input.actor.sessionId,
          action: "MEMBER_CAPABILITY_RESTRICTION_CLEAR",
          resourceType: "MEMBER_CAPABILITY_RESTRICTION",
          resourceId: input.restrictionId,
          payloadHash: sha256(input.restrictionId),
          reason,
          correlationId: input.correlationId,
          outcome: "CLEARED",
        },
      });

      return { id: input.restrictionId, memberId: restriction.memberId, removed: true };
    });
  }

  /**
   * Runs an Admin command under the Idempotency-Key contract: the same key with
   * the same payload replays the durable prior result; the same key with a
   * different payload conflicts; and the record is written in the same
   * transaction as the command's durable effect.
   */
  async executeCommand<T>(
    input: AdminRestrictionCommandInput,
    execute: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const replay = await claimIdempotent(tx, input);
      if (replay !== null) return replay;
      const produced = await execute(tx);
      const body = JSON.parse(JSON.stringify(produced)) as Prisma.InputJsonValue;
      await recordIdempotent(tx, input, body);
      return body;
    });
  }
}

export function toRestrictionView(restriction: {
  id: string;
  memberId: string;
  type: string;
  source: string;
  reason: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  actorOrPolicyRef: string;
  createdAt: Date;
}): CapabilityRestrictionView {
  return {
    id: restriction.id,
    memberId: restriction.memberId,
    type: restriction.type as MemberCapabilityRestrictionType,
    source: restriction.source,
    reason: restriction.reason,
    effectiveFrom: restriction.effectiveFrom,
    effectiveUntil: restriction.effectiveUntil,
    actorOrPolicyRef: restriction.actorOrPolicyRef,
    createdAt: restriction.createdAt,
  };
}

function parseCapability(value: string): MemberCapability {
  if (!(MEMBER_CAPABILITIES as readonly string[]).includes(value)) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `capability must be one of ${MEMBER_CAPABILITIES.join(", ")}`,
      { field: "capability" },
    );
  }
  return value as MemberCapability;
}

function normalizeReason(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OnboardingRuleError("VALIDATION_ERROR", "reason is required", { field: "reason" });
  }
  const trimmed = value.trim();
  if (trimmed.length > REASON_MAX_LENGTH) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      `reason must be at most ${REASON_MAX_LENGTH} characters`,
      { field: "reason" },
    );
  }
  return trimmed;
}

function assertEffectiveWindow(effectiveFrom: Date, effectiveUntil: Date | null): void {
  if (
    effectiveUntil !== null &&
    effectiveUntil.getTime() <= effectiveFrom.getTime()
  ) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "effectiveUntil must be after effectiveFrom",
      { field: "effectiveUntil" },
    );
  }
}

async function claimIdempotent(
  tx: Prisma.TransactionClient,
  input: AdminRestrictionCommandInput,
): Promise<Prisma.JsonValue | null> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
    input.scope,
    input.key,
  ])}, 0))::text`;

  const prior = await tx.idempotencyRecord.findUnique({
    where: { scope_key: { scope: input.scope, key: input.key } },
  });
  if (!prior) return null;
  if (prior.fingerprint !== input.fingerprint) {
    throw new OnboardingRuleError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency-Key was already used with a different payload",
      { scope: input.scope },
    );
  }
  if (prior.status === "COMPLETED" && prior.responseBody !== null) {
    return prior.responseBody;
  }
  throw new OnboardingRuleError(
    "IDEMPOTENCY_IN_PROGRESS",
    "The command did not reach a durable result and requires reconciliation",
    { status: prior.status },
  );
}

async function recordIdempotent(
  tx: Prisma.TransactionClient,
  input: AdminRestrictionCommandInput,
  responseBody: Prisma.InputJsonValue,
): Promise<void> {
  await tx.idempotencyRecord.create({
    data: {
      scope: input.scope,
      key: input.key,
      fingerprint: input.fingerprint,
      responseCode: input.responseCode,
      status: "COMPLETED",
      responseBody,
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
    },
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.keys(item as Record<string, unknown>)
          .sort()
          .map((key) => [key, (item as Record<string, unknown>)[key]]),
      );
    }
    return item;
  });
}
