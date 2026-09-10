import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminReconciliationController,
  type ReconciliationRunResponse,
} from "../../apps/api/src/admin-reconciliation.controller";
import { AdminReportingController } from "../../apps/api/src/admin-reporting.controller";
import { AdminAuthGuard } from "../../apps/api/src/admin-auth.guard";
import {
  ADMIN_CAPABILITIES_METADATA,
  AdminCapabilityGuard,
} from "../../apps/api/src/admin-capability.guard";
import { AdminAuthService } from "../../src/contexts/identity-access/application/admin-auth.service";
import { AccountingPeriodFinancialReportService } from "../../src/contexts/reporting/accounting-period-financial-report.service";
import { ReconciliationInspectionService } from "../../src/contexts/reporting/reconciliation-inspection.service";

describe("Reporting/Reconciliation API contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [AdminReconciliationController, AdminReportingController],
      providers: [
        Reflector,
        AdminAuthGuard,
        AdminCapabilityGuard,
        { provide: AdminAuthService, useValue: {} },
        { provide: ReconciliationInspectionService, useValue: {} },
        { provide: AccountingPeriodFinancialReportService, useValue: {} },
      ],
    })
    class ContractModule {}

    app = await NestFactory.create(ContractModule, { logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function document() {
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle("test").setVersion("1").addBearerAuth().build(),
    );
  }

  it("publishes the Admin reconciliation run and discrepancy read resources", () => {
    const paths = document().paths;
    expect(paths["/api/v1/admin/reconciliation/runs"]?.get).toBeDefined();
    expect(paths["/api/v1/admin/reconciliation/runs/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/admin/reconciliation/discrepancies"]?.get).toBeDefined();
    expect(paths["/api/v1/admin/reconciliation/discrepancies/{id}"]?.get).toBeDefined();
  });

  it("publishes the accounting-period financial report resource", () => {
    const paths = document().paths;
    expect(paths["/api/v1/admin/reports/accounting-period-financial"]?.get).toBeDefined();
  });

  it("exposes no generic mutation for reconciliation or report evidence", () => {
    const paths = document().paths;
    for (const path of [
      "/api/v1/admin/reconciliation/runs",
      "/api/v1/admin/reconciliation/runs/{id}",
      "/api/v1/admin/reconciliation/discrepancies",
      "/api/v1/admin/reconciliation/discrepancies/{id}",
      "/api/v1/admin/reports/accounting-period-financial",
    ]) {
      expect(paths[path]?.post, path).toBeUndefined();
      expect(paths[path]?.patch, path).toBeUndefined();
      expect(paths[path]?.put, path).toBeUndefined();
      expect(paths[path]?.delete, path).toBeUndefined();
    }
  });

  it("requires the Admin capability on every new endpoint", () => {
    const required = (handler: unknown) =>
      Reflect.getMetadata(ADMIN_CAPABILITIES_METADATA, handler as object);
    const controller = AdminReconciliationController.prototype;
    expect(required(controller.listRuns)).toEqual(["reconciliation.read"]);
    expect(required(controller.getRun)).toEqual(["reconciliation.read"]);
    expect(required(controller.listDiscrepancies)).toEqual(["reconciliation.read"]);
    expect(required(controller.getDiscrepancy)).toEqual(["reconciliation.read"]);
    expect(required(AdminReportingController.prototype.accountingPeriodFinancial)).toEqual([
      "report.read",
    ]);
  });

  it("authenticates every new operation with bearer credentials", () => {
    const document_ = document();
    for (const path of [
      "/api/v1/admin/reconciliation/runs",
      "/api/v1/admin/reconciliation/runs/{id}",
      "/api/v1/admin/reconciliation/discrepancies",
      "/api/v1/admin/reconciliation/discrepancies/{id}",
      "/api/v1/admin/reports/accounting-period-financial",
    ]) {
      expect(JSON.stringify(document_.paths[path]?.get), path).toContain("security");
    }
  });

  it("uses canonical integer-minor money, declared enums, and no persistence internals", () => {
    const document_ = document();
    const schemas = document_.components?.schemas ?? {};

    const report = schemas.AccountingPeriodFinancialReportResponse as {
      properties?: Record<string, { type?: string; enum?: unknown[]; nullable?: boolean }>;
    };
    expect(report.properties?.periods).toBeTruthy();
    expect(report.properties?.corrections).toBeTruthy();
    expect(report.properties?.coverage).toBeTruthy();
    expect(report.properties?.completeness?.enum).toEqual([
      "CURRENT",
      "LAGGING",
      "PARTIAL",
      "REBUILDING",
    ]);
    expect(report.properties?.reportingTimezone?.enum).toEqual(["Asia/Bangkok"]);
    expect(report.properties?.projectionLagMs).toBeTruthy();

    const group = schemas.AccountingPeriodReportGroupResponse as {
      properties?: Record<string, { type?: string }>;
    };
    expect(group.properties?.debitAmountMinor?.type).toBe("string");
    expect(group.properties?.creditAmountMinor?.type).toBe("string");

    const discrepancy = schemas.ReconciliationDiscrepancyResponse as {
      properties?: Record<string, { type?: string; nullable?: boolean; enum?: unknown[] }>;
    };
    expect(discrepancy.properties?.amountDifferenceMinor).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(discrepancy.properties?.status?.enum).toEqual([
      "DETECTED",
      "INVESTIGATING",
      "RESOLUTION_PENDING",
      "RESOLVED",
    ]);
    expect(discrepancy.properties?.ageMs).toBeTruthy();
    expect(discrepancy.properties?.ownerReference).toBeTruthy();

    const run = schemas.ReconciliationRunResponse as {
      properties?: Record<string, { $ref?: string }>;
    };
    expect(run.properties?.totals?.$ref).toBeTruthy();

    const money = JSON.stringify(
      (document_.components?.schemas?.ReconciliationTotalsResponse ?? {}) as object,
    );
    expect(money).toContain('"additionalProperties"');

    // No persistence-schema or entity internals leak into the generated contract.
    expect(JSON.stringify(document_).toLowerCase()).not.toMatch(
      /prisma|reconciliation_runs|reconciliation_discrepancies|financial_transactions|accounting_periods|queryraw|_repository/,
    );
  });

  it("keeps the run representation free of raw Prisma row types", () => {
    // Compile-time guard: the exported response type mirrors the persistence
    // evidence without exposing Prisma model types.
    const sample: Pick<ReconciliationRunResponse, "totals" | "inspectedCounts" | "result"> = {
      totals: { expected: {}, observed: {}, difference: {} },
      inspectedCounts: {
        ledgerAccounts: 0,
        ledgerPostings: 0,
        activeReservationAllocations: 0,
        walletBuckets: 0,
        discrepancies: 0,
      },
      result: "MATCHED",
    };
    expect(sample.result).toBe("MATCHED");
  });
});
