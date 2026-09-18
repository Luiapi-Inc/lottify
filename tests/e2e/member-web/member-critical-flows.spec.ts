import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";

const baseURL = "http://127.0.0.1:3101";
const FAR_FUTURE = "2099-09-18T16:00:00.000Z";
const NOW = "2026-09-18T04:00:00.000Z";

const member = {
  memberId: "member-e2e-1",
  phone: "0812345678",
  status: "ACTIVE",
  passwordEnrolled: true,
};

const productVersion = {
  id: "pv1",
  version: 1,
  revision: 1,
  state: "PUBLISHED",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  timezone: "Asia/Bangkok",
  scheduleTemplateRef: "schedule-thai",
  resultSchemaVersionRef: "result-v1",
  settlementRuleVersionRef: "settlement-v1",
  defaultPayoutPolicyRef: "payout-v1",
  defaultLimitPolicyRef: "limit-v1",
  defaultRestrictionPolicyRef: "restriction-v1",
  enabledBetTypes: [{ betTypeId: "bt1", betTypeVersionId: "btv1" }],
};

const betTypeVersion = {
  id: "btv1",
  version: 1,
  revision: 1,
  state: "PUBLISHED",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  canonicalNumberFormat: "3 digits",
  validationPattern: "^\\d{3}$",
  defaultPayout: { multiplier: 500 },
  minStakeMinor: "100",
  maxStakeMinor: "100000",
  limitPolicyRef: "limit-v1",
  restrictionPolicyRef: "restriction-v1",
  settlementRuleVersionRef: "settlement-v1",
};

const drawBetType = {
  betTypeId: "bt1",
  betTypeCode: "THREE_TOP",
  betTypeVersionId: "btv1",
  canonicalNumberFormat: "3 digits",
  validationPattern: "^\\d{3}$",
  payout: { multiplier: 500 },
  minStakeMinor: "100",
  maxStakeMinor: "100000",
  limitPolicyRef: "limit-v1",
  restrictionPolicyRef: "restriction-v1",
  settlementRuleVersionRef: "settlement-v1",
};

const draw = {
  id: "d1",
  productId: "p1",
  productVersionId: "pv1",
  occurrenceIdentity: "THAI-2099-09-18",
  localDate: "2099-09-18",
  state: "OPEN",
  version: 3,
  openAt: "2099-09-18T00:00:00.000Z",
  cutoffAt: FAR_FUTURE,
  drawAt: "2099-09-18T16:30:00.000Z",
  provenance: "E2E_CONTROLLED_FIXTURE",
  timezone: "Asia/Bangkok",
  scheduleTemplateRef: "schedule-thai",
  resultSchemaVersionRef: "result-v1",
  settlementRuleVersionRef: "settlement-v1",
  defaultPayoutPolicyRef: "payout-v1",
  defaultLimitPolicyRef: "limit-v1",
  defaultRestrictionPolicyRef: "restriction-v1",
  resultSourceRef: null,
  overrideRevisionRef: "override-0",
  cutoff: { cutoffAt: FAR_FUTURE },
  serverNow: NOW,
  allowedActions: ["CLOSE"],
  betTypes: [drawBetType],
};

const quoteLine = {
  betTypeId: "bt1",
  betTypeCode: "THREE_TOP",
  betTypeVersionId: "btv1",
  canonicalNumber: "007",
  stakeMinor: "15000",
  resolvedPayout: { multiplier: 500 },
  payoutSource: "DRAW_SNAPSHOT",
  restrictions: [],
};

const quote = {
  id: "q1",
  memberId: member.memberId,
  drawId: draw.id,
  productId: draw.productId,
  productVersionId: draw.productVersionId,
  currency: "THB",
  totalStakeMinor: "15000",
  status: "QUOTED",
  cutoffAt: FAR_FUTURE,
  serverNow: NOW,
  expiresAt: FAR_FUTURE,
  lines: [quoteLine],
};

function order(state: "QUOTED" | "CONFIRMED" | "SETTLED", id = "o1") {
  return {
    id,
    memberId: member.memberId,
    quoteId: quote.id,
    drawId: draw.id,
    productId: draw.productId,
    productVersionId: draw.productVersionId,
    currency: "THB",
    state,
    version: state === "QUOTED" ? 1 : 2,
    allowedActions: state === "QUOTED" ? ["CONFIRM"] : state === "CONFIRMED" ? ["CANCEL"] : [],
    totalStakeMinor: "15000",
    cutoffAt: FAR_FUTURE,
    quoteExpiresAt: FAR_FUTURE,
    reservationId: state === "QUOTED" ? null : "reservation-1",
    stakeTransactionId: state === "QUOTED" ? null : "ledger-stake-1",
    refundTransactionId: null,
    rejectionReason: null,
    cancellationReason: null,
    confirmedAt: state === "QUOTED" ? null : "2026-09-18T04:05:00.000Z",
    cancelledAt: null,
    rejectedAt: null,
    receiptId: state === "QUOTED" ? null : `receipt-${id}`,
    lines: [quoteLine],
    createdAt: "2026-09-18T04:04:00.000Z",
    updatedAt: "2026-09-18T04:05:00.000Z",
  };
}

function receipt(orderId = "o1") {
  return {
    id: `receipt-${orderId}`,
    orderId,
    memberId: member.memberId,
    orderVersion: 2,
    contentDigest: `sha256-${orderId}-accepted-terms`,
    terms: {
      productId: draw.productId,
      productVersionId: draw.productVersionId,
      drawReference: draw.occurrenceIdentity,
      drawCutoffAt: FAR_FUTURE,
      currency: "THB",
      totalStakeMinor: "15000",
      acceptedAt: "2026-09-18T04:05:00.000Z",
      lines: [{
        betTypeCode: quoteLine.betTypeCode,
        betTypeVersionId: quoteLine.betTypeVersionId,
        canonicalNumber: quoteLine.canonicalNumber,
        stakeMinor: quoteLine.stakeMinor,
        resolvedPayout: quoteLine.resolvedPayout,
      }],
      acceptedRestrictions: [],
    },
    issuedAt: "2026-09-18T04:05:01.000Z",
  };
}

const payoutDestination = {
  id: "pd1",
  memberId: member.memberId,
  type: "BANK_ACCOUNT",
  bankCode: "KBANK",
  accountNumberMasked: "••••4821",
  accountHolderName: "สมาชิกทดสอบ",
  currency: "THB",
  status: "VERIFIED",
  verificationEvidenceRef: "verification-e2e-1",
  verifiedAt: "2026-09-17T10:00:00.000Z",
  version: 1,
  createdAt: "2026-09-17T09:00:00.000Z",
  updatedAt: "2026-09-17T10:00:00.000Z",
};

function withdrawal(state: string) {
  return {
    id: "w1",
    memberId: member.memberId,
    payoutDestinationId: payoutDestination.id,
    amountMinor: "300000",
    feeMinor: "0",
    currency: "THB",
    state,
    version: state === "COMPLETED" ? 4 : 1,
    eligibilityOutcome: "ALLOW",
    eligibilityReasonCodes: ["ELIGIBLE"],
    requiresApproval: false,
    ledgerTransactionId: state === "COMPLETED" ? "ledger-withdrawal-1" : null,
    payoutEvidenceRef: state === "COMPLETED" ? "provider-proof-1" : null,
    failureReason: null,
    decisionReason: null,
    allowedActions: state === "REQUESTED" || state === "REVIEWING" ? { member: ["cancel"] } : { member: [] },
    eligibilityEvidenceRefs: ["readiness-e2e-1"],
    createdAt: "2026-09-18T04:10:00.000Z",
    updatedAt: "2026-09-18T04:11:00.000Z",
  };
}

type SeenRequest = { method: string; path: string; idempotencyKey?: string };

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([{ name: "lottify_member_session", value: "e2e-session", url: baseURL }]);
  await installBaseApi(page);
});

test("Quote → Confirm → Receipt uses server-resolved terms and idempotent mutations", async ({ page }, testInfo) => {
  const seen: SeenRequest[] = [];
  await installApi(page, seen, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/v1/member/products") return json(route, { items: [{ id: "p1", versions: [{ id: "pv1", version: 1, revision: 1, state: "PUBLISHED", effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null }] }], nextCursor: null });
    if (method === "GET" && path === "/api/v1/member/bet-types") return json(route, { items: [{ id: "bt1", code: "THREE_TOP", versions: [{ id: "btv1", version: 1, revision: 1, state: "PUBLISHED", effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null }] }], nextCursor: null });
    if (method === "GET" && path === "/api/v1/member/products/p1") return json(route, { id: "p1", versions: [productVersion] });
    if (method === "GET" && path === "/api/v1/member/products/p1/draws") return json(route, { items: [draw], nextCursor: null });
    if (method === "GET" && path === "/api/v1/member/draws/d1") return json(route, draw);
    if (method === "GET" && path === "/api/v1/member/draws/d1/eligibility") return json(route, { eligible: true, cutoffAt: FAR_FUTURE, serverNow: NOW });
    if (method === "GET" && path === "/api/v1/member/bet-types/bt1") return json(route, { id: "bt1", code: "THREE_TOP", versions: [betTypeVersion] });
    if (method === "POST" && path === "/api/v1/member/draws/d1/quotes") return json(route, quote);
    if (method === "GET" && path === "/api/v1/member/quotes/q1") return json(route, quote);
    if (method === "POST" && path === "/api/v1/member/quotes/q1/orders") return json(route, order("QUOTED"));
    if (method === "POST" && path === "/api/v1/member/orders/o1/confirm") return json(route, order("CONFIRMED"));
    if (method === "GET" && path === "/api/v1/member/orders/o1") return json(route, order("CONFIRMED"));
    if (method === "GET" && path === "/api/v1/member/orders/o1/receipt") return json(route, receipt());
    if (method === "GET" && path === "/api/v1/member/orders/o1/settlement") return json(route, { orderId: "o1", outcome: null, payoutMinor: "0", batchState: null, authoritative: false });
    return false;
  });

  await page.goto("/buy");
  await expect(page.getByRole("heading", { name: "เลือก Product และ Draw จากระบบ" })).toBeVisible();
  await page.getByRole("link", { name: /กรอกเลขสำหรับ Draw นี้/ }).click();

  await page.getByLabel("เลข", { exact: true }).fill("007");
  await page.getByLabel("จำนวนเงินต่อเลข (บาท)").fill("150");
  await page.getByRole("button", { name: "+ เพิ่มเลขนี้" }).click();
  await expect(page.getByText("007", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /สร้าง Quote จาก API/ }).click();

  await expect(page).toHaveURL(/\/buy\/quote\?quoteId=q1/);
  await expect(page.getByText("DRAW_SNAPSHOT").first()).toBeVisible();
  await expect(page.getByText("500", { exact: false }).first()).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /ยืนยันซื้อ/ }).click();

  await expect(page).toHaveURL(/\/buy\/receipt\?orderId=o1/);
  await expect(page.getByRole("heading", { name: "ระบบรับรายการแล้ว" })).toBeVisible();
  await expect(page.getByText("sha256-o1-accepted-terms")).toBeVisible();
  await expect(page.getByText("PENDING", { exact: true })).toBeVisible();
  await capture(page, testInfo, "quote-confirm-receipt.png");

  const quoteMutation = seen.find((item) => item.method === "POST" && item.path.endsWith("/draws/d1/quotes"));
  const createOrderMutation = seen.find((item) => item.method === "POST" && item.path.endsWith("/quotes/q1/orders"));
  const confirmMutation = seen.find((item) => item.method === "POST" && item.path.endsWith("/orders/o1/confirm"));
  expect(quoteMutation?.idempotencyKey).toBeTruthy();
  expect(createOrderMutation?.idempotencyKey).toBeTruthy();
  expect(confirmMutation?.idempotencyKey).toBeTruthy();
});

test("expired Quote blocks confirmation and exposes the recovery path", async ({ page }, testInfo) => {
  const expired = { ...quote, id: "q-expired", status: "EXPIRED", expiresAt: "2026-01-01T00:00:00.000Z" };
  await installApi(page, [], async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/v1/member/quotes/q-expired") return json(route, expired);
    return false;
  });

  await page.goto("/buy/quote?quoteId=q-expired");
  await expect(page.getByText("Quote ใช้ต่อไม่ได้")).toBeVisible();
  await expect(page.getByRole("button", { name: /ยืนยันซื้อ/ })).toBeDisabled();
  await expect(page.getByRole("link", { name: /แก้รายการ/ })).toBeVisible();
  await capture(page, testInfo, "quote-expired-recovery.png");
});

test("Withdrawal stays non-final until an authoritative refreshed state reports COMPLETED", async ({ page }, testInfo) => {
  const seen: SeenRequest[] = [];
  let withdrawalReads = 0;
  await installApi(page, seen, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (method === "GET" && path === "/api/v1/member/payout-destinations") return json(route, { items: [payoutDestination] });
    if (method === "POST" && path === "/api/v1/member/withdrawals/preflight") return json(route, {
      balanceReady: true,
      availableMinor: "1000000",
      minValid: true,
      maxValid: true,
      outcome: "ALLOW",
      reasonCodes: ["ELIGIBLE"],
      policyVersion: "withdrawal-policy-e2e",
      evaluatedAt: NOW,
      validUntil: FAR_FUTURE,
    });
    if (method === "POST" && path === "/api/v1/member/withdrawals") return json(route, withdrawal("REQUESTED"));
    if (method === "GET" && path === "/api/v1/member/withdrawals/w1") {
      withdrawalReads += 1;
      return json(route, withdrawal(withdrawalReads === 1 ? "REVIEWING" : "COMPLETED"));
    }
    return false;
  });

  await page.goto("/wallet/withdraw");
  await expect(page.getByText("ธนาคารกสิกรไทย · ••••4821")).toBeVisible();
  await expect(page.getByText("ถอนได้", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /ตรวจเงื่อนไขและยืนยัน/ }).click();

  await expect(page).toHaveURL(/\/wallet\/withdraw\/status\?id=w1/);
  await expect(page.getByRole("heading", { name: "กำลังตรวจสอบคำขอถอนเงิน" })).toBeVisible();
  await expect(page.getByText("ยังไม่ถือว่าถอนสำเร็จ", { exact: false })).toBeVisible();
  await capture(page, testInfo, "withdrawal-reviewing.png");

  await page.getByRole("button", { name: "ตรวจสถานะล่าสุด" }).click();
  await expect(page.getByRole("heading", { name: "ถอนเงินสำเร็จ" })).toBeVisible();
  await expect(page.getByText("provider-proof-1")).toHaveCount(0);
  await capture(page, testInfo, "withdrawal-completed.png");

  const createMutation = seen.find((item) => item.method === "POST" && item.path.endsWith("/withdrawals"));
  expect(createMutation?.idempotencyKey).toBeTruthy();
});

test("Withdrawal denial renders server reason and prevents submission", async ({ page }, testInfo) => {
  await installApi(page, [], async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/v1/member/payout-destinations") return json(route, { items: [payoutDestination] });
    if (request.method() === "POST" && path === "/api/v1/member/withdrawals/preflight") return json(route, {
      balanceReady: false,
      availableMinor: "50000",
      minValid: true,
      maxValid: true,
      outcome: "DENY",
      reasonCodes: ["INSUFFICIENT_FUNDS"],
      policyVersion: "withdrawal-policy-e2e",
      evaluatedAt: NOW,
      validUntil: FAR_FUTURE,
    });
    return false;
  });

  await page.goto("/wallet/withdraw");
  await expect(page.getByText("ยอดเงินสดที่ถอนได้ไม่พอ")).toBeVisible();
  await expect(page.getByRole("button", { name: /ตรวจเงื่อนไขและยืนยัน/ })).toBeDisabled();
  await capture(page, testInfo, "withdrawal-denied.png");
});

test("Slip detail exposes immutable accepted terms and authoritative settlement outcome", async ({ page }, testInfo) => {
  const correctedOrderId = "o-corrected";
  await installApi(page, [], async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === `/api/v1/member/orders/${correctedOrderId}`) return json(route, order("SETTLED", correctedOrderId));
    if (request.method() === "GET" && path === `/api/v1/member/orders/${correctedOrderId}/receipt`) return json(route, receipt(correctedOrderId));
    if (request.method() === "GET" && path === `/api/v1/member/orders/${correctedOrderId}/settlement`) return json(route, { orderId: correctedOrderId, outcome: "WIN", payoutMinor: "50000", batchState: "COMPLETED", authoritative: true });
    return false;
  });

  await page.goto(`/slips/detail?id=${correctedOrderId}`);
  await expect(page.getByRole("heading", { name: "รายละเอียดโพยและผลล่าสุด" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Immutable Receipt" })).toBeVisible();
  await expect(page.getByText(`sha256-${correctedOrderId}-accepted-terms`)).toBeVisible();
  await expect(page.getByText("AUTHORITATIVE", { exact: true })).toBeVisible();
  await expect(page.getByText("WIN", { exact: true })).toBeVisible();
  await capture(page, testInfo, "slip-authoritative-settlement.png");
});

async function installBaseApi(page: Page) {
  await page.route("**/api/v1/member/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/v1/member/auth/refresh") {
      return json(route, { accessToken: "e2e-access-token" });
    }
    if (request.method() === "GET" && path === "/api/v1/member/auth/me") {
      return json(route, member);
    }
    await route.fallback();
  });
}

async function installApi(
  page: Page,
  seen: SeenRequest[],
  handler: (route: Route) => Promise<false | void>,
) {
  await page.route("**/api/v1/member/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    seen.push({ method: request.method(), path, idempotencyKey: request.headers()["idempotency-key"] });
    const handled = await handler(route);
    if (handled === false) await route.fallback();
  });
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function capture(page: Page, testInfo: TestInfo, filename: string) {
  await assertVisualLayout(page, testInfo);
  const directory = join(process.cwd(), ".hermes", "evidence", "member-web-e2e", "screenshots", testInfo.project.name);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, filename), fullPage: true });
}

async function assertVisualLayout(page: Page, testInfo: TestInfo) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const masthead = document.querySelector<HTMLElement>(".member-masthead");
    const dockNav = document.querySelector<HTMLElement>(".dock-nav");
    const mobileNav = document.querySelector<HTMLElement>(".mobile-nav");
    const main = document.querySelector<HTMLElement>("main#main");
    const heading = main?.querySelector<HTMLElement>("h1, h2") ?? null;

    const displayOf = (element: HTMLElement | null) => element ? getComputedStyle(element).display : "missing";
    const rectOf = (element: HTMLElement | null) => element ? element.getBoundingClientRect().toJSON() : null;

    return {
      viewportWidth: root.clientWidth,
      viewportHeight: root.clientHeight,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      mastheadDisplay: displayOf(masthead),
      mastheadRect: rectOf(masthead),
      dockNavDisplay: displayOf(dockNav),
      dockNavRect: rectOf(dockNav),
      dockNavLinks: dockNav ? Array.from(dockNav.querySelectorAll<HTMLElement>("a")).map((link) => link.getBoundingClientRect().toJSON()) : [],
      mobileNavDisplay: displayOf(mobileNav),
      mobileNavRect: rectOf(mobileNav),
      mobileNavLinks: mobileNav ? Array.from(mobileNav.querySelectorAll<HTMLElement>("a")).map((link) => link.getBoundingClientRect().toJSON()) : [],
      headingRect: rectOf(heading),
      overflowElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? "",
          rect: element.getBoundingClientRect().toJSON(),
        }))
        .filter((item) => item.rect.width > 0 && (item.rect.right > root.clientWidth + 1 || item.rect.left < -1))
        .slice(0, 12),
    };
  });

  expect(metrics.scrollWidth, `${testInfo.project.name}: body must not overflow horizontally; offenders=${JSON.stringify(metrics.overflowElements)}`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.headingRect, `${testInfo.project.name}: critical screen must render a visible heading`).not.toBeNull();
  expect(metrics.headingRect?.width ?? 0).toBeGreaterThan(0);
  expect(metrics.headingRect?.height ?? 0).toBeGreaterThan(0);
  expect(metrics.mastheadDisplay, `${testInfo.project.name}: member masthead must remain visible`).not.toBe("none");

  if (metrics.mastheadRect) {
    expect(metrics.mastheadRect.left).toBeGreaterThanOrEqual(0);
    expect(metrics.mastheadRect.right).toBeLessThanOrEqual(metrics.viewportWidth);
  }

  if (testInfo.project.name === "mobile-chrome") {
    expect(metrics.dockNavDisplay, "mobile: desktop dock must be hidden").toBe("none");
    expect(metrics.mobileNavDisplay, "mobile: primary navigation must be visible").not.toBe("none");
    const nav = metrics.mobileNavRect;
    expect(nav, "mobile: navigation bounds must exist").not.toBeNull();
    if (nav) {
      expect(nav.left).toBeGreaterThanOrEqual(0);
      expect(nav.right).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(nav.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    }
    expect(metrics.mobileNavLinks).toHaveLength(5);
    for (const target of metrics.mobileNavLinks) {
      expect(target.width, "mobile: primary navigation tap target width").toBeGreaterThanOrEqual(44);
      expect(target.height, "mobile: primary navigation tap target height").toBeGreaterThanOrEqual(44);
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const overlap = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".mobile-nav");
      const main = document.querySelector<HTMLElement>("main#main");
      if (!nav || !main) return null;
      const candidates = Array.from(main.querySelectorAll<HTMLElement>("a,button,input,select,textarea")).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      const last = candidates.at(-1);
      if (!last) return null;
      const lastRect = last.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return { lastBottom: lastRect.bottom, navTop: navRect.top, tag: last.tagName, text: last.textContent?.trim().slice(0, 80) ?? "" };
    });
    if (overlap) {
      expect(overlap.lastBottom, `mobile: last interactive element must remain above fixed nav (${overlap.tag} ${overlap.text})`).toBeLessThanOrEqual(overlap.navTop - 4);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    expect(metrics.dockNavDisplay, "desktop: floating dock must remain visible").not.toBe("none");
    expect(metrics.mobileNavDisplay, "desktop: mobile navigation must remain hidden").toBe("none");
    expect(metrics.dockNavLinks).toHaveLength(5);
    const dock = metrics.dockNavRect;
    expect(dock, "desktop: dock bounds must exist").not.toBeNull();
    if (dock) {
      expect(dock.left).toBeGreaterThanOrEqual(0);
      expect(dock.right).toBeLessThanOrEqual(metrics.viewportWidth);
      expect(dock.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
    }
  }
}
