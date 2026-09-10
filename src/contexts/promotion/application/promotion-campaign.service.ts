import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import {
  assertCampaignVersionEditable,
  assertCampaignVersionTransition,
  isCampaignVersionEffective,
  promotionTermsDigest,
  promotionTurnoverTargetMinor,
  validatePromotionCampaignTerms,
  type PromotionCampaignState,
  type PromotionCampaignTerms,
} from "../domain/campaign-terms";
import {
  decidePromotionEligibility,
  type PromotionEligibilityDecision,
  type PromotionIneligibilityReason,
} from "../domain/entitlement-snapshot";
import { PromotionRuleError } from "../domain/rule-error";
import { PromotionCommandService } from "./promotion-command.service";
import {
  PROMOTION_MEMBER_FACTS_PORT,
  type PromotionMemberFactsPort,
} from "./promotion-member-facts.port";

export interface PromotionAdminActor {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
}

export interface CreatePromotionCampaignVersionCommand {
  readonly campaignCode: string;
  readonly version: number;
  readonly terms: PromotionCampaignTerms;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly reason: string | null;
  readonly actor: PromotionAdminActor;
  readonly correlationId: string;
}

export interface PromotionCampaignVersionView {
  readonly id: string;
  readonly campaignId: string;
  readonly campaignCode: string;
  readonly version: number;
  readonly revision: number;
  readonly state: PromotionCampaignState;
  readonly terms: PromotionCampaignTerms;
  readonly termsDigest: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly reason: string | null;
  readonly publishedAt: Date | null;
  readonly approvalEvidenceRef: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PromotionDiscoveryItem {
  readonly campaignVersionId: string;
  readonly campaignCode: string;
  readonly campaignVersion: number;
  readonly rewardType: string;
  readonly rewardAmountMinor: string;
  readonly currency: string;
  readonly turnoverTargetMinor: string;
  readonly contributionBps: number;
  readonly winningsDestination: string;
  readonly stackingMode: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly expiresAt: Date;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly PromotionIneligibilityReason[];
}

export interface PromotionEligibilityPreview {
  readonly campaignVersionId: string;
  readonly memberId: string;
  readonly eligible: boolean;
  readonly ineligibilityReasons: readonly PromotionIneligibilityReason[];
  readonly entitlementPreview: {
    readonly rewardAmountMinor: string;
    readonly turnoverTargetMinor: string;
    readonly expiresAt: Date;
    readonly winningsDestination: string;
    readonly contributionBps: number;
    readonly eligibleProductIds: readonly string[];
    readonly eligibleBetTypeCodes: readonly string[];
  };
}

export const PROMOTION_CAMPAIGN_PUBLISH_ACTION_CLASS = "promotion-campaign.publish";
const DAY_MS = 24 * 60 * 60 * 1000;

const VERSION_SELECT = {
  id: true,
  campaignId: true,
  version: true,
  revision: true,
  state: true,
  terms: true,
  termsDigest: true,
  effectiveFrom: true,
  effectiveUntil: true,
  reason: true,
  publishedAt: true,
  approvalEvidenceRef: true,
  createdAt: true,
  updatedAt: true,
  campaign: { select: { code: true } },
} satisfies Prisma.PromotionCampaignVersionSelect;

type PromotionVersionRow = Prisma.PromotionCampaignVersionGetPayload<{
  select: typeof VERSION_SELECT;
}>;

/**
 * Promotion Campaign governance and Member discovery.
 *
 * Admin surface: versioned Draft → Validate → Preview → Approval/Publish with
 * optimistic versioning, maker-checker approval evidence and immutable published
 * terms. Member surface: discovery of published, effective Campaigns with the
 * eligibility decision evaluated against the Member's resolved facts.
 */
@Injectable()
export class PromotionCampaignService extends PromotionCommandService {
  constructor(
    @Inject(PrismaService) prisma: PrismaService,
    @Inject(PROMOTION_MEMBER_FACTS_PORT)
    private readonly memberFacts: PromotionMemberFactsPort,
  ) {
    super(prisma);
  }

  /**
   * Creates a DRAFT Campaign version. Creating the Campaign root is implicit and
   * idempotent on the Campaign code; a version number can never be reused.
   */
  async createDraftVersion(
    command: CreatePromotionCampaignVersionCommand,
  ): Promise<PromotionCampaignVersionView> {
    const campaignCode = command.campaignCode?.trim();
    if (!campaignCode) {
      throw new PromotionRuleError("VALIDATION_ERROR", "campaignCode is required");
    }
    if (!Number.isInteger(command.version) || command.version < 1) {
      throw new PromotionRuleError("VALIDATION_ERROR", "version must be a positive integer");
    }
    assertEffectiveWindow(command.effectiveFrom, command.effectiveUntil);
    assertTermsValid(command.terms);

    return this.transaction(async (tx) => {
      const campaign = await tx.promotionCampaign.upsert({
        where: { code: campaignCode },
        update: {},
        create: { id: randomUUID(), code: campaignCode },
        select: { id: true },
      });
      const created = await tx.promotionCampaignVersion.create({
        data: {
          id: randomUUID(),
          campaignId: campaign.id,
          version: command.version,
          revision: 1,
          state: "DRAFT",
          terms: command.terms as unknown as Prisma.InputJsonValue,
          termsDigest: promotionTermsDigest(command.terms),
          effectiveFrom: command.effectiveFrom,
          effectiveUntil: command.effectiveUntil,
          reason: command.reason,
          createdByAdminId: command.actor.adminId,
        },
        select: VERSION_SELECT,
      });
      return toVersionView(created);
    });
  }

  /** Draft → Validated. Re-validates the stored terms and bumps the revision. */
  async validateVersion(input: {
    versionId: string;
    expectedRevision: number;
    correlationId: string;
  }): Promise<PromotionCampaignVersionView> {
    return this.transaction(async (tx) => {
      const current = await this.lockVersion(tx, input.versionId);
      assertCampaignVersionEditable(current.state);
      assertExpectedRevision(current.revision, input.expectedRevision);
      assertTermsValid(toTerms(current.terms));

      const updated = await tx.promotionCampaignVersion.update({
        where: { id: input.versionId },
        data: { state: "VALIDATED", revision: { increment: 1 }, reason: current.reason },
        select: VERSION_SELECT,
      });
      return toVersionView(updated);
    });
  }

  /**
   * Approval + publish of a validated version. Requires a different Admin than
   * the requester (maker-checker), fresh MFA/reauth evidence, a non-overlapping
   * effective window against the Campaign's already published versions, and
   * records the approval and audit evidence in the same transaction.
   */
  async approveAndPublish(input: {
    versionId: string;
    expectedRevision: number;
    actor: PromotionAdminActor;
    reauthEvidenceId: string;
    reason: string;
    correlationId: string;
  }): Promise<PromotionCampaignVersionView> {
    return this.transaction(async (tx) => {
      const current = await this.lockVersion(tx, input.versionId);
      assertExpectedRevision(current.revision, input.expectedRevision);
      assertCampaignVersionTransition(current.state, "PUBLISHED");
      const terms = toTerms(current.terms);
      assertTermsValid(terms);

      const requester = current.createdByAdminId;
      if (requester && requester === input.actor.adminId) {
        throw new PromotionRuleError(
          "SELF_APPROVAL_FORBIDDEN",
          "The Admin who created a Promotion Campaign version cannot approve it",
          { versionId: input.versionId },
        );
      }

      await assertNoOverlappingPublishedVersion(tx, {
        campaignId: current.campaignId,
        versionId: input.versionId,
        effectiveFrom: current.effectiveFrom,
        effectiveUntil: current.effectiveUntil,
      });

      const approval = await tx.adminApprovalEvidence.create({
        data: {
          id: randomUUID(),
          action: "PROMOTION_CAMPAIGN_VERSION_PUBLISH",
          resourceType: "PROMOTION_CAMPAIGN_VERSION",
          resourceId: input.versionId,
          requesterAdminId: requester ?? input.actor.adminId,
          approverAdminId: input.actor.adminId,
          requestedVersion: input.expectedRevision,
          payloadHash: current.termsDigest,
          reason: input.reason,
          policyVersion: terms.policyVersion,
          reauthEvidenceId: input.reauthEvidenceId,
          correlationId: input.correlationId,
          approvedAt: new Date(),
        },
        select: { id: true },
      });

      const published = await tx.promotionCampaignVersion.update({
        where: { id: input.versionId },
        data: {
          state: "PUBLISHED",
          revision: { increment: 1 },
          publishedAt: new Date(),
          publishedByAdminId: input.actor.adminId,
          approvalEvidenceRef: approval.id,
        },
        select: VERSION_SELECT,
      });

      await tx.auditRecord.create({
        data: {
          id: randomUUID(),
          actorAdminId: input.actor.adminId,
          actorRole: input.actor.role,
          sessionId: input.actor.sessionId,
          action: "PROMOTION_CAMPAIGN_VERSION_PUBLISH",
          resourceType: "PROMOTION_CAMPAIGN_VERSION",
          resourceId: input.versionId,
          payloadHash: current.termsDigest,
          reason: input.reason,
          reauthEvidenceId: input.reauthEvidenceId,
          approvalId: approval.id,
          correlationId: input.correlationId,
          outcome: "PUBLISHED",
        },
      });

      return toVersionView(published);
    });
  }

  /** Published → Retired. A retired version is no longer claimable. */
  async retireVersion(input: {
    versionId: string;
    expectedRevision: number;
    actor: PromotionAdminActor;
    reason: string;
  }): Promise<PromotionCampaignVersionView> {
    return this.transaction(async (tx) => {
      const current = await this.lockVersion(tx, input.versionId);
      assertExpectedRevision(current.revision, input.expectedRevision);
      assertCampaignVersionTransition(current.state, "RETIRED");
      const retired = await tx.promotionCampaignVersion.update({
        where: { id: input.versionId },
        data: { state: "RETIRED", revision: { increment: 1 }, reason: input.reason },
        select: VERSION_SELECT,
      });
      return toVersionView(retired);
    });
  }

  async getVersion(versionId: string): Promise<PromotionCampaignVersionView> {
    const row = await this.prisma.promotionCampaignVersion.findUnique({
      where: { id: versionId },
      select: VERSION_SELECT,
    });
    if (!row) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Campaign version not found", {
        versionId,
      });
    }
    return toVersionView(row);
  }

  async listVersions(input: { limit?: number; cursor?: string; state?: string }): Promise<{
    items: PromotionCampaignVersionView[];
    nextCursor: string | null;
  }> {
    const limit = boundedLimit(input.limit);
    const rows = await this.prisma.promotionCampaignVersion.findMany({
      where: input.state ? { state: input.state } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: VERSION_SELECT,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toVersionView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * Eligibility preview for a Member against a version's terms without granting
   * anything: the Admin sees exactly the decision the Member's claim would make.
   */
  async previewEligibility(input: {
    versionId: string;
    memberId: string;
    now: Date;
  }): Promise<PromotionEligibilityPreview> {
    const version = await this.prisma.promotionCampaignVersion.findUnique({
      where: { id: input.versionId },
      select: VERSION_SELECT,
    });
    if (!version) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Campaign version not found", {
        versionId: input.versionId,
      });
    }
    if (version.state === "RETIRED") {
      throw new PromotionRuleError("STATE_CONFLICT", "A retired Campaign version cannot be previewed", {
        versionId: input.versionId,
      });
    }

    const facts = await this.memberFacts.getMemberFacts(input.memberId);
    const held = await this.heldCampaignVersionIds(input.memberId);
    const terms = toTerms(version.terms);
    const decision = decidePromotionEligibility({
      version: {
        id: version.id,
        // Preview answers "who would qualify if this version were published",
        // so it evaluates every Campaign criterion except publication liveness —
        // a Draft/Validated version is not yet claimable through discovery.
        state: "PUBLISHED",
        effectiveFrom: version.effectiveFrom,
        effectiveUntil: version.effectiveUntil,
      },
      terms,
      facts,
      heldCampaignVersionIds: held,
      at: input.now,
    });

    return {
      campaignVersionId: version.id,
      memberId: input.memberId,
      eligible: decision.eligible,
      ineligibilityReasons: decision.reasons,
      entitlementPreview: {
        rewardAmountMinor: terms.rewardAmountMinor,
        turnoverTargetMinor: promotionTurnoverTargetMinor(terms).toString(),
        expiresAt: new Date(input.now.getTime() + terms.expiryDaysAfterGrant * DAY_MS),
        winningsDestination: terms.winningsDestination,
        contributionBps: terms.scope.contributionBps,
        eligibleProductIds: terms.scope.eligibleProductIds,
        eligibleBetTypeCodes: terms.scope.eligibleBetTypeCodes,
      },
    };
  }

  /**
   * Member promotion discovery: every published, currently effective Campaign
   * version with the eligibility decision and the resolved terms the Member
   * would receive. Already-held Campaign versions are reported as ineligible
   * rather than hidden, so the Member sees a complete picture.
   */
  async discoverForMember(memberId: string, at: Date): Promise<{
    memberId: string;
    asOf: Date;
    items: PromotionDiscoveryItem[];
  }> {
    const rows = await this.prisma.promotionCampaignVersion.findMany({
      where: { state: "PUBLISHED", effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: "desc" }, { id: "asc" }],
      select: VERSION_SELECT,
    });
    const facts = await this.memberFacts.getMemberFacts(memberId);
    const held = await this.heldCampaignVersionIds(memberId);

    const items: PromotionDiscoveryItem[] = [];
    for (const row of rows) {
      const terms = toTerms(row.terms);
      const decision: PromotionEligibilityDecision = decidePromotionEligibility({
        version: {
          id: row.id,
          state: row.state as PromotionCampaignState,
          effectiveFrom: row.effectiveFrom,
          effectiveUntil: row.effectiveUntil,
        },
        terms,
        facts,
        heldCampaignVersionIds: held,
        at,
      });
      if (!isCampaignVersionEffective({ state: row.state as PromotionCampaignState, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil }, at)) {
        continue;
      }
      items.push({
        campaignVersionId: row.id,
        campaignCode: row.campaign.code,
        campaignVersion: row.version,
        rewardType: terms.rewardType,
        rewardAmountMinor: terms.rewardAmountMinor,
        currency: terms.currency,
        turnoverTargetMinor: promotionTurnoverTargetMinor(terms).toString(),
        contributionBps: terms.scope.contributionBps,
        winningsDestination: terms.winningsDestination,
        stackingMode: terms.stacking.mode,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
        expiresAt: new Date(at.getTime() + terms.expiryDaysAfterGrant * DAY_MS),
        eligible: decision.eligible,
        ineligibilityReasons: decision.reasons,
      });
    }

    return { memberId, asOf: at, items };
  }

  private async heldCampaignVersionIds(memberId: string): Promise<string[]> {
    const held = await this.prisma.promotionEntitlement.findMany({
      where: { memberId },
      select: { campaignVersionId: true },
    });
    return held.map((row) => row.campaignVersionId);
  }

  private async lockVersion(
    tx: Prisma.TransactionClient,
    versionId: string,
  ): Promise<PromotionVersionRow & { state: PromotionCampaignState; createdByAdminId: string | null }> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM promotion_campaign_versions WHERE id = ${versionId}::uuid FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new PromotionRuleError("NOT_FOUND", "Promotion Campaign version not found", {
        versionId,
      });
    }
    const row = await tx.promotionCampaignVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { ...VERSION_SELECT, createdByAdminId: true },
    });
    return { ...row, state: row.state as PromotionCampaignState };
  }
}

export function assertTermsValid(terms: PromotionCampaignTerms): void {
  const violations = validatePromotionCampaignTerms(terms);
  if (violations.length > 0) {
    throw new PromotionRuleError(
      "VALIDATION_ERROR",
      "Promotion Campaign terms are not valid",
      { violations },
    );
  }
}

export function assertEffectiveWindow(effectiveFrom: Date, effectiveUntil: Date | null): void {
  if (!(effectiveFrom instanceof Date) || Number.isNaN(effectiveFrom.getTime())) {
    throw new PromotionRuleError("VALIDATION_ERROR", "effectiveFrom must be an RFC 3339 instant");
  }
  if (effectiveUntil !== null) {
    if (!(effectiveUntil instanceof Date) || Number.isNaN(effectiveUntil.getTime())) {
      throw new PromotionRuleError("VALIDATION_ERROR", "effectiveUntil must be an RFC 3339 instant");
    }
    if (effectiveUntil.getTime() <= effectiveFrom.getTime()) {
      throw new PromotionRuleError(
        "VALIDATION_ERROR",
        "effectiveUntil must be after effectiveFrom",
      );
    }
  }
}

export function assertExpectedRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) {
    throw new PromotionRuleError("VALIDATION_ERROR", "expectedVersion must be a positive integer");
  }
  if (actual !== expected) {
    throw new PromotionRuleError(
      "VERSION_CONFLICT",
      "The Promotion Campaign version changed since it was read",
      { expectedVersion: expected, actualVersion: actual },
    );
  }
}

async function assertNoOverlappingPublishedVersion(
  tx: Prisma.TransactionClient,
  input: {
    campaignId: string;
    versionId: string;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
  },
): Promise<void> {
  const overlapping = await tx.promotionCampaignVersion.findFirst({
    where: {
      campaignId: input.campaignId,
      state: "PUBLISHED",
      id: { not: input.versionId },
      effectiveFrom: { lt: input.effectiveUntil ?? new Date("9999-12-31T23:59:59.999Z") },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: input.effectiveFrom } }],
    },
    select: { id: true, version: true },
  });
  if (overlapping) {
    throw new PromotionRuleError(
      "OVERLAPPING_PUBLISHED_VERSION",
      "Another published version of this Campaign already covers the effective window",
      { conflictingVersionId: overlapping.id, conflictingVersion: overlapping.version },
    );
  }
}

function toVersionView(row: PromotionVersionRow): PromotionCampaignVersionView {
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignCode: row.campaign.code,
    version: row.version,
    revision: row.revision,
    state: row.state as PromotionCampaignState,
    terms: toTerms(row.terms),
    termsDigest: row.termsDigest,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    reason: row.reason,
    publishedAt: row.publishedAt,
    approvalEvidenceRef: row.approvalEvidenceRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTerms(value: Prisma.JsonValue): PromotionCampaignTerms {
  return value as unknown as PromotionCampaignTerms;
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new PromotionRuleError("VALIDATION_ERROR", "limit must be an integer between 1 and 100");
  }
  return limit;
}
