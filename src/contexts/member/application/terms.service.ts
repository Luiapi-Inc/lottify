import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import { OnboardingRuleError } from "../domain/onboarding-error";
import {
  TERMS_ACCEPTANCE_SOURCE,
  assertEffectiveWindow,
  assertExpectedRevision,
  assertTermsDocumentContentValid,
  assertTermsDocumentTransition,
  canonicalJson,
  isTermsDocumentEffective,
  termsDocumentDigest,
  type TermsDocumentContent,
  type TermsDocumentState,
} from "../domain/terms-document";

/**
 * Member Terms governance + Member-facing Terms status/acceptance.
 *
 * Admin surface: an Admin-authored DRAFT version, an approval-gated PUBLISHED
 * state with maker-checker + fresh MFA evidence, and a terminal RETIRED state,
 * mirroring the repository's other versioned-configuration governance.
 *
 * Member surface: which Terms version(s) are currently required, the Member's
 * own immutable acceptances, and recording an acceptance exactly once per
 * Member + version under the Idempotency-Key contract. Nothing here ever
 * reports an acceptance the Member did not make.
 */

export interface TermsAdminActor {
  readonly adminId: string;
  readonly sessionId: string;
  readonly role: string;
}

export interface CreateTermsVersionCommand {
  readonly code: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly policyVersion: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly reason: string | null;
  readonly actor: TermsAdminActor;
}

export interface TermsDocumentView {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly revision: number;
  readonly state: TermsDocumentState;
  readonly title: string;
  readonly body: string;
  readonly contentDigest: string;
  readonly policyVersion: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly reason: string | null;
  readonly publishedAt: Date | null;
  readonly approvalEvidenceRef: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TermsAcceptanceView {
  readonly id: string;
  readonly memberId: string;
  readonly documentId: string;
  readonly documentCode: string;
  readonly documentVersion: number;
  readonly contentDigest: string;
  readonly source: string;
  readonly acceptedAt: Date;
}

export interface RequiredTermsView {
  readonly document: TermsDocumentView;
  readonly accepted: boolean;
  readonly acceptedAt: Date | null;
  readonly acceptanceId: string | null;
}

export interface MemberTermsStatus {
  readonly memberId: string;
  readonly asOf: Date;
  readonly required: RequiredTermsView[];
  readonly acceptances: TermsAcceptanceView[];
  /**
   * True only when every currently required Terms version has a durable
   * acceptance for this Member. With no required version nothing is outstanding,
   * so it is vacuously satisfied; it never turns true from an assumption.
   */
  readonly satisfied: boolean;
}

export interface AcceptTermsResult {
  readonly acceptance: TermsAcceptanceView;
  /** False on the first acceptance; true when this Member already accepted it. */
  readonly alreadyAccepted: boolean;
}

export interface TermsAcceptanceEvidence {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

const DOCUMENT_SELECT = {
  id: true,
  code: true,
  version: true,
  revision: true,
  state: true,
  title: true,
  body: true,
  contentDigest: true,
  policyVersion: true,
  effectiveFrom: true,
  effectiveUntil: true,
  reason: true,
  publishedAt: true,
  approvalEvidenceRef: true,
  createdAt: true,
  updatedAt: true,
  createdByAdminId: true,
} satisfies Prisma.MemberTermsDocumentSelect;

const ACCEPTANCE_SELECT = {
  id: true,
  memberId: true,
  documentId: true,
  documentCode: true,
  documentVersion: true,
  contentDigest: true,
  source: true,
  acceptedAt: true,
} satisfies Prisma.MemberTermsAcceptanceSelect;

type TermsDocumentRow = Prisma.MemberTermsDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;
type TermsAcceptanceRow = Prisma.MemberTermsAcceptanceGetPayload<{ select: typeof ACCEPTANCE_SELECT }>;

@Injectable()
export class TermsService {
  /**
   * Nested calls reuse the active transaction, so an idempotent command and the
   * durable effect it produced commit or roll back together — a command can
   * never leave an effect without its Idempotency-Key record.
   */
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

  /** Creates a DRAFT Terms version. A code+version can never be reused. */
  async createDraftVersion(command: CreateTermsVersionCommand): Promise<TermsDocumentView> {
    const content: TermsDocumentContent = {
      code: command.code?.trim() ?? "",
      version: command.version,
      title: command.title,
      body: command.body,
    };
    assertTermsDocumentContentValid(content);
    assertEffectiveWindow(command.effectiveFrom, command.effectiveUntil);
    const policyVersion = command.policyVersion?.trim();
    if (!policyVersion) {
      throw new OnboardingRuleError("VALIDATION_ERROR", "policyVersion is required", {
        field: "policyVersion",
      });
    }

    try {
      const created = await this.db.memberTermsDocument.create({
        data: {
          id: randomUUID(),
          code: content.code,
          version: content.version,
          revision: 1,
          state: "DRAFT",
          title: content.title.trim(),
          body: content.body,
          contentDigest: termsDocumentDigest({ ...content, title: content.title.trim() }),
          policyVersion,
          effectiveFrom: command.effectiveFrom,
          effectiveUntil: command.effectiveUntil,
          reason: command.reason,
          createdByAdminId: command.actor.adminId,
        },
        select: DOCUMENT_SELECT,
      });
      return toDocumentView(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new OnboardingRuleError(
          "STATE_CONFLICT",
          "A Member Terms version with this code and version already exists",
          { code: content.code, version: content.version },
        );
      }
      throw error;
    }
  }

  /**
   * Publishes a DRAFT version. Requires a different Admin than the author
   * (maker-checker), fresh MFA/reauth evidence, a non-overlapping effective
   * window against the same code's already published versions, and records the
   * approval and audit evidence in the same transaction.
   */
  async publishVersion(input: {
    documentId: string;
    expectedRevision: number;
    actor: TermsAdminActor;
    reauthEvidenceId: string;
    reason: string;
    correlationId: string;
  }): Promise<TermsDocumentView> {
    return this.transaction(async (tx) => {
      const current = await lockDocument(tx, input.documentId);
      assertExpectedRevision(current.revision, input.expectedRevision);
      assertTermsDocumentTransition(current.state as TermsDocumentState, "PUBLISHED");
      assertTermsDocumentContentValid({
        code: current.code,
        version: current.version,
        title: current.title,
        body: current.body,
      });

      if (current.createdByAdminId && current.createdByAdminId === input.actor.adminId) {
        throw new OnboardingRuleError(
          "SELF_APPROVAL_FORBIDDEN",
          "The Admin who authored a Member Terms version cannot publish it",
          { documentId: input.documentId },
        );
      }

      await assertNoOverlappingPublishedVersion(tx, {
        code: current.code,
        documentId: input.documentId,
        effectiveFrom: current.effectiveFrom,
        effectiveUntil: current.effectiveUntil,
      });

      const approval = await tx.adminApprovalEvidence.create({
        data: {
          id: randomUUID(),
          action: "MEMBER_TERMS_VERSION_PUBLISH",
          resourceType: "MEMBER_TERMS_VERSION",
          resourceId: input.documentId,
          requesterAdminId: current.createdByAdminId ?? input.actor.adminId,
          approverAdminId: input.actor.adminId,
          requestedVersion: input.expectedRevision,
          payloadHash: current.contentDigest,
          reason: input.reason,
          policyVersion: current.policyVersion,
          reauthEvidenceId: input.reauthEvidenceId,
          correlationId: input.correlationId,
          approvedAt: new Date(),
        },
        select: { id: true },
      });

      const published = await tx.memberTermsDocument.update({
        where: { id: input.documentId },
        data: {
          state: "PUBLISHED",
          revision: { increment: 1 },
          publishedAt: new Date(),
          publishedByAdminId: input.actor.adminId,
          approvalEvidenceRef: approval.id,
        },
        select: DOCUMENT_SELECT,
      });

      await tx.auditRecord.create({
        data: {
          id: randomUUID(),
          actorAdminId: input.actor.adminId,
          actorRole: input.actor.role,
          sessionId: input.actor.sessionId,
          action: "MEMBER_TERMS_VERSION_PUBLISH",
          resourceType: "MEMBER_TERMS_VERSION",
          resourceId: input.documentId,
          payloadHash: current.contentDigest,
          reason: input.reason,
          reauthEvidenceId: input.reauthEvidenceId,
          approvalId: approval.id,
          correlationId: input.correlationId,
          outcome: "PUBLISHED",
        },
      });

      return toDocumentView(published);
    });
  }

  /** Published → RETIRED. A retired version is never required again. */
  async retireVersion(input: {
    documentId: string;
    expectedRevision: number;
    actor: TermsAdminActor;
    reason: string;
  }): Promise<TermsDocumentView> {
    return this.transaction(async (tx) => {
      const current = await lockDocument(tx, input.documentId);
      assertExpectedRevision(current.revision, input.expectedRevision);
      assertTermsDocumentTransition(current.state as TermsDocumentState, "RETIRED");
      const retired = await tx.memberTermsDocument.update({
        where: { id: input.documentId },
        data: { state: "RETIRED", revision: { increment: 1 }, reason: input.reason },
        select: DOCUMENT_SELECT,
      });
      return toDocumentView(retired);
    });
  }

  async getVersion(documentId: string): Promise<TermsDocumentView> {
    const row = await this.db.memberTermsDocument.findUnique({
      where: { id: documentId },
      select: DOCUMENT_SELECT,
    });
    if (!row) {
      throw new OnboardingRuleError("NOT_FOUND", "Member Terms version not found", {
        documentId,
      });
    }
    return toDocumentView(row);
  }

  async listVersions(input: { limit?: number; cursor?: string; state?: string }): Promise<{
    items: TermsDocumentView[];
    nextCursor: string | null;
  }> {
    const limit = boundedLimit(input.limit);
    const rows = await this.db.memberTermsDocument.findMany({
      where: input.state ? { state: input.state } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: DOCUMENT_SELECT,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(toDocumentView),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * The Terms status of one Member: which version(s) are currently required and
   * which of them this Member has actually accepted. An acceptance is only ever
   * reported from a durable row.
   */
  async getMemberTerms(memberId: string, at: Date): Promise<MemberTermsStatus> {
    const [documents, acceptances] = await Promise.all([
      this.db.memberTermsDocument.findMany({
        where: { state: "PUBLISHED", effectiveFrom: { lte: at } },
        orderBy: [{ code: "asc" }, { version: "desc" }],
        select: DOCUMENT_SELECT,
      }),
      this.db.memberTermsAcceptance.findMany({
        where: { memberId },
        orderBy: [{ acceptedAt: "asc" }, { id: "asc" }],
        select: ACCEPTANCE_SELECT,
      }),
    ]);

    const acceptanceByDocument = new Map(
      acceptances.map((row) => [row.documentId, row] as const),
    );
    const required: RequiredTermsView[] = [];
    for (const row of documents) {
      const document = toDocumentView(row);
      if (!isTermsDocumentEffective(document, at)) continue;
      const acceptance = acceptanceByDocument.get(document.id);
      required.push({
        document,
        accepted: acceptance !== undefined,
        acceptedAt: acceptance?.acceptedAt ?? null,
        acceptanceId: acceptance?.id ?? null,
      });
    }

    return {
      memberId,
      asOf: at,
      required,
      acceptances: acceptances.map(toAcceptanceView),
      satisfied: required.every((entry) => entry.accepted),
    };
  }

  /**
   * Runs an Admin command under the Idempotency-Key contract: the same key with
   * the same payload replays the durable prior result, the same key with a
   * different payload conflicts, and the record is written in the same
   * transaction that produced the command's durable effect.
   */
  async executeCommand<T>(
    input: IdempotentCommandInput,
    execute: () => Promise<T>,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      const replay = await claimIdempotent(tx, input);
      if (replay !== null) return replay;
      const produced = await execute();
      const body = JSON.parse(JSON.stringify(produced)) as Prisma.InputJsonValue;
      await recordIdempotent(tx, input, body);
      return body;
    });
  }

  /**
   * Records a Member's acceptance of the currently required Terms version.
   *
   * - Idempotent twice over: the same Idempotency-Key replays the durable prior
   *   result, and a second acceptance of the same version returns the existing
   *   record (`alreadyAccepted: true`) rather than writing a duplicate.
   * - Denies a version that is not currently required (DRAFT, not yet
   *   effective, expired, retired or unknown) instead of recording an
   *   acceptance the Member was not actually subject to.
   * - Requires an authenticated, ACTIVE Member, which is only reachable after
   *   the phone-possession (OTP) proof that registration/login establishes; no
   *   acceptance is possible on behalf of an unverified phone.
   */
  async acceptTerms(input: {
    memberId: string;
    documentId: string;
    idempotencyKey: string;
    correlationId: string;
    evidence: TermsAcceptanceEvidence;
    at: Date;
  }): Promise<AcceptTermsResult> {
    const command: IdempotentCommandInput = {
      scope: `MEMBER_TERMS_ACCEPT:${input.memberId}`,
      key: input.idempotencyKey,
      fingerprint: sha256(canonicalJson({ documentId: input.documentId })),
      responseCode: 200,
    };

    return this.transaction(async (tx) => {
      const replay = await claimIdempotent(tx, command);
      if (replay !== null) {
        // The stored body carries the acceptance id, so a replay is re-read from
        // the immutable row rather than rebuilt from serialized JSON.
        const stored = replay as unknown as { acceptanceId?: unknown; alreadyAccepted?: unknown };
        if (typeof stored.acceptanceId !== "string") {
          throw new OnboardingRuleError(
            "IDEMPOTENCY_IN_PROGRESS",
            "The command did not reach a durable result and requires reconciliation",
            { scope: command.scope },
          );
        }
        const row = await tx.memberTermsAcceptance.findUniqueOrThrow({
          where: { id: stored.acceptanceId },
          select: ACCEPTANCE_SELECT,
        });
        return {
          acceptance: toAcceptanceView(row),
          alreadyAccepted: stored.alreadyAccepted === true,
        };
      }

      // Second lock scope: acceptance is once per Member + version, so a
      // concurrent acceptance of the same version (even under a different
      // Idempotency-Key) serializes here instead of racing the unique index.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        "MEMBER_TERMS_ACCEPT_DOCUMENT",
        input.memberId,
        input.documentId,
      ])}, 0))::text`;

      const member = await tx.member.findUnique({
        where: { id: input.memberId },
        select: { id: true, status: true },
      });
      if (!member) {
        throw new OnboardingRuleError("NOT_FOUND", "Member not found", {
          memberId: input.memberId,
        });
      }
      if (member.status !== "ACTIVE") {
        throw new OnboardingRuleError(
          "MEMBER_NOT_ACTIVE",
          "This Member account is not active",
          { memberId: input.memberId },
        );
      }

      const document = await tx.memberTermsDocument.findUnique({
        where: { id: input.documentId },
        select: DOCUMENT_SELECT,
      });
      if (!document) {
        throw new OnboardingRuleError("NOT_FOUND", "Member Terms version not found", {
          documentId: input.documentId,
        });
      }
      if (
        !isTermsDocumentEffective(
          {
            state: document.state as TermsDocumentState,
            effectiveFrom: document.effectiveFrom,
            effectiveUntil: document.effectiveUntil,
          },
          input.at,
        )
      ) {
        throw new OnboardingRuleError(
          "TERMS_VERSION_NOT_REQUIRED",
          "This Member Terms version is not currently required",
          { documentId: input.documentId, state: document.state },
        );
      }

      const existing = await tx.memberTermsAcceptance.findUnique({
        where: { memberId_documentId: { memberId: input.memberId, documentId: document.id } },
        select: ACCEPTANCE_SELECT,
      });

      const acceptance =
        existing ??
        (await tx.memberTermsAcceptance.create({
          data: {
            id: randomUUID(),
            memberId: input.memberId,
            documentId: document.id,
            documentCode: document.code,
            documentVersion: document.version,
            contentDigest: document.contentDigest,
            source: TERMS_ACCEPTANCE_SOURCE,
            acceptedAt: input.at,
            evidence: {
              ipAddress: input.evidence.ipAddress,
              userAgent: input.evidence.userAgent,
            } as Prisma.InputJsonValue,
            correlationId: input.correlationId,
          },
          select: ACCEPTANCE_SELECT,
        }));

      const result: AcceptTermsResult = {
        acceptance: toAcceptanceView(acceptance),
        alreadyAccepted: existing !== null,
      };

      await recordIdempotent(tx, command, {
        acceptanceId: result.acceptance.id,
        alreadyAccepted: result.alreadyAccepted,
      } as Prisma.InputJsonValue);

      return result;
    });
  }
}

export interface IdempotentCommandInput {
  readonly scope: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly responseCode: number;
}

/**
 * Serializes a logical command on its Idempotency-Key and returns the durable
 * prior result when the key was already used with the same payload.
 * Returns `null` when the command must execute.
 */
async function claimIdempotent(
  tx: Prisma.TransactionClient,
  input: IdempotentCommandInput,
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
  input: IdempotentCommandInput,
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

async function lockDocument(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<TermsDocumentRow> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM member_terms_documents WHERE id = ${documentId}::uuid FOR UPDATE
  `;
  if (locked.length === 0) {
    throw new OnboardingRuleError("NOT_FOUND", "Member Terms version not found", { documentId });
  }
  return tx.memberTermsDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: DOCUMENT_SELECT,
  });
}

async function assertNoOverlappingPublishedVersion(
  tx: Prisma.TransactionClient,
  input: {
    code: string;
    documentId: string;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
  },
): Promise<void> {
  const overlapping = await tx.memberTermsDocument.findFirst({
    where: {
      code: input.code,
      state: "PUBLISHED",
      id: { not: input.documentId },
      effectiveFrom: { lt: input.effectiveUntil ?? new Date("9999-12-31T23:59:59.999Z") },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: input.effectiveFrom } }],
    },
    select: { id: true, version: true },
  });
  if (overlapping) {
    throw new OnboardingRuleError(
      "OVERLAPPING_PUBLISHED_VERSION",
      "Another published version of these Member Terms already covers the effective window",
      { conflictingDocumentId: overlapping.id, conflictingVersion: overlapping.version },
    );
  }
}

export function toDocumentView(row: TermsDocumentRow): TermsDocumentView {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    revision: row.revision,
    state: row.state as TermsDocumentState,
    title: row.title,
    body: row.body,
    contentDigest: row.contentDigest,
    policyVersion: row.policyVersion,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    reason: row.reason,
    publishedAt: row.publishedAt,
    approvalEvidenceRef: row.approvalEvidenceRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAcceptanceView(row: TermsAcceptanceRow): TermsAcceptanceView {
  return {
    id: row.id,
    memberId: row.memberId,
    documentId: row.documentId,
    documentCode: row.documentCode,
    documentVersion: row.documentVersion,
    contentDigest: row.contentDigest,
    source: row.source,
    acceptedAt: row.acceptedAt,
  };
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new OnboardingRuleError(
      "VALIDATION_ERROR",
      "limit must be an integer between 1 and 100",
      { field: "limit" },
    );
  }
  return limit;
}

function sha256(value: string): string {
  // Local to the command contract: the acceptance fingerprint identifies the
  // requested Terms version, and is never part of the Terms document rules.
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
