import { AsyncLocalStorage } from "node:async_hooks";
import { Inject } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../../platform/persistence/prisma.service";
import { PromotionRuleError } from "../domain/rule-error";

/** A Promotion command is a critical mutation: it always carries an Idempotency-Key. */
export interface PromotionIdempotencyInput {
  readonly scope: string;
  readonly key: string;
  readonly fingerprint: string;
  readonly responseCode: number;
}

/**
 * Shared command seam for the Promotion application services.
 *
 * Critical mutations serialize on the Idempotency-Key, replay the durable prior
 * result for a same-key/same-payload retry, and conflict when the same key is
 * reused with a different payload. The same transaction context is reused by
 * nested calls so a command and its durable effects commit or roll back together.
 */
export abstract class PromotionCommandService {
  private readonly transactionContext = new AsyncLocalStorage<Prisma.TransactionClient>();

  protected constructor(@Inject(PrismaService) protected readonly prisma: PrismaService) {}

  protected get db(): Prisma.TransactionClient {
    return this.transactionContext.getStore() ?? this.prisma;
  }

  protected transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const active = this.transactionContext.getStore();
    if (active) return work(active);
    return this.prisma.$transaction((tx) => this.transactionContext.run(tx, () => work(tx)));
  }

  /** Runs a command under the Idempotency-Key contract and stores its durable result. */
  async executeCommand<T>(
    input: PromotionIdempotencyInput,
    execute: () => Promise<T>,
  ): Promise<unknown> {
    return this.transaction(async (tx) => {
      // Same logical command serializes before reading its durable result.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        input.scope,
        input.key,
      ])}, 0))::text`;
      const prior = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope: input.scope, key: input.key } },
      });
      if (prior) {
        if (prior.fingerprint !== input.fingerprint) {
          throw new PromotionRuleError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different payload",
            { scope: input.scope },
          );
        }
        if (prior.status === "COMPLETED" && prior.responseBody !== null) {
          return prior.responseBody;
        }
        throw new PromotionRuleError(
          "IDEMPOTENCY_IN_PROGRESS",
          "The command did not reach a durable result and requires reconciliation",
          { status: prior.status },
        );
      }

      const result = await execute();
      const responseBody = JSON.parse(
        JSON.stringify(result, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ) as Prisma.InputJsonValue;
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
      return responseBody;
    });
  }

  protected requestFingerprint(payload: Record<string, unknown>): string {
    return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
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
