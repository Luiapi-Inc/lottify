import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getEnvironment } from "../config/env";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const env = getEnvironment();
    const connectionUrl = new URL(env.DATABASE_URL);
    const options = connectionUrl.searchParams.get("options") || process.env.PGOPTIONS || "";
    // Pin every pooled connection before its first query: PrismaPg reads dates
    // as UTC, and TIMESTAMP defaults must store UTC wall time. Business calendar
    // boundaries still use Asia/Bangkok. URL options override pg config options,
    // so append here, preserving other startup settings and their precedence.
    connectionUrl.searchParams.set("options", `${options} -c timezone=UTC`.trim());
    super({ adapter: new PrismaPg({ connectionString: connectionUrl.toString() }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
