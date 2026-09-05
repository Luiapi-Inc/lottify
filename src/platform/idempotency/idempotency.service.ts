import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../persistence/prisma.service";

export type IdempotencyClaim =
  | { kind: "claimed"; recordId: string }
  | {
      kind: "existing";
      recordId: string;
      status: string;
      fingerprint: string;
      responseCode: number | null;
      responseBody: Prisma.JsonValue | null;
    };

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(input: {
    scope: string;
    key: string;
    fingerprint: string;
    expiresAt: Date;
  }): Promise<IdempotencyClaim> {
    try {
      const record = await this.prisma.idempotencyRecord.create({
        data: {
          scope: input.scope,
          key: input.key,
          fingerprint: input.fingerprint,
          status: "IN_PROGRESS",
          expiresAt: input.expiresAt,
        },
        select: { id: true },
      });
      return { kind: "claimed", recordId: record.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({
        where: { scope_key: { scope: input.scope, key: input.key } },
      });

      return {
        kind: "existing",
        recordId: existing.id,
        status: existing.status,
        fingerprint: existing.fingerprint,
        responseCode: existing.responseCode,
        responseBody: existing.responseBody,
      };
    }
  }

  async complete(
    recordId: string,
    responseCode: number,
    responseBody: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: { status: "COMPLETED", responseCode, responseBody },
    });
  }

  async fail(recordId: string): Promise<void> {
    await this.prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: { status: "FAILED" },
    });
  }
}
