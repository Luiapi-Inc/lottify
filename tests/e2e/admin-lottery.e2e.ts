import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

type VersionState = 'DRAFT' | 'REVIEW' | 'PUBLISHED';

type LotteryVersion = {
  id: string;
  version: number;
  revision: number;
  state: VersionState;
  effectiveFrom: string;
  effectiveUntil: string | null;
  timezone: string;
  scheduleTemplateRef: string;
  resultSchemaVersionRef: string;
  defaultPayoutPolicyRef: string;
  defaultLimitPolicyRef: string;
  defaultRestrictionPolicyRef: string;
  settlementRuleVersionRef: string;
  reason: string;
  enabledBetTypes: unknown[];
};

type MockState = {
  version: LotteryVersion;
  submitKeys: string[];
  approveKeys: string[];
  reauthBodies: unknown[];
  denyApproval: boolean;
};

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';

function createState(initial: VersionState): MockState {
  return {
    version: {
      id: VERSION_ID,
      version: 1,
      revision: initial === 'DRAFT' ? 1 : 2,
      state: initial,
      effectiveFrom: '2026-10-01T02:00:00.000Z',
      effectiveUntil: null,
      timezone: 'Asia/Bangkok',
      scheduleTemplateRef: 'THAI_GOVERNMENT',
      resultSchemaVersionRef: 'thai-government-result-v1',
      defaultPayoutPolicyRef: 'payout-policy-v1',
      defaultLimitPolicyRef: 'limit-policy-v1',
      defaultRestrictionPolicyRef: 'restriction-policy-v1',
      settlementRuleVersionRef: 'settlement-rules-v1',
      reason: 'Initial governed configuration',
      enabledBetTypes: [],
    },
    submitKeys: [],
    approveKeys: [],
    reauthBodies: [],
    denyApproval: false,
  };
}

function resource(state: MockState) {
  return {
    id: PRODUCT_ID,
    versions: [{ ...state.version }],
  };
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installAdminApiMock(page: Page, state: MockState) {
  await page.route('**/api/v1/admin/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1/admin/', '');
    const method = request.method();

    if (path === 'auth/refresh' && method === 'POST') {
      return json(route, 200, { accessToken: 'admin-access-token' });
    }
    if (path === 'auth/me' && method === 'GET') {
      return json(route, 200, {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'reviewer@example.test',
        name: 'Release Reviewer',
        role: 'SUPER_ADMIN',
        capabilities: [
          'lottery-configuration.read',
          'lottery-configuration.create',
          'lottery-configuration.submit',
          'lottery-configuration.approve',
        ],
      });
    }
    if (path === 'lottery/products' && method === 'GET') {
      return json(route, 200, { items: [resource(state)], nextCursor: null });
    }
    if (path === `lottery/products/${PRODUCT_ID}` && method === 'GET') {
      return json(route, 200, resource(state));
    }
    if (
      path === `lottery/product-versions/${VERSION_ID}/submit` &&
      method === 'POST'
    ) {
      state.submitKeys.push(request.headers()['idempotency-key'] ?? '');
      const body = request.postDataJSON() as { expectedVersion?: number };
      expect(body.expectedVersion).toBe(state.version.revision);
      state.version = {
        ...state.version,
        state: 'REVIEW',
        revision: state.version.revision + 1,
      };
      return json(route, 200, { state: 'REVIEW' });
    }
    if (path === 'auth/reauth' && method === 'POST') {
      const body = request.postDataJSON();
      state.reauthBodies.push(body);
      return json(route, 200, {
        evidenceRef: 'admin-reauth:e2e',
        expiresAt: '2026-10-01T03:00:00.000Z',
      });
    }
    if (
      path === `lottery/product-versions/${VERSION_ID}/approve` &&
      method === 'POST'
    ) {
      state.approveKeys.push(request.headers()['idempotency-key'] ?? '');
      if (state.denyApproval) {
        return json(route, 409, {
          code: 'MAKER_CHECKER_VIOLATION',
          message: 'ผู้สร้างเวอร์ชันไม่สามารถอนุมัติเวอร์ชันเดียวกันได้',
          correlationId: 'corr-maker-checker-e2e',
        });
      }
      const body = request.postDataJSON() as { expectedVersion?: number };
      expect(body.expectedVersion).toBe(state.version.revision);
      state.version = {
        ...state.version,
        state: 'PUBLISHED',
        revision: state.version.revision + 1,
      };
      return json(route, 200, { state: 'PUBLISHED' });
    }

    return json(route, 404, {
      code: 'UNMOCKED_ROUTE',
      message: `${method} ${path} is not mocked`,
    });
  });
}

async function openVersionDetail(page: Page) {
  await page.goto('/lottery');
  await expect(page.getByRole('heading', { name: 'ตั้งค่าหวย' })).toBeVisible();
  await expect(page.getByText('Release Reviewer')).toBeVisible();
  await page.getByRole('button', { name: 'ดูรายละเอียด' }).click();
  await expect(page.getByRole('heading', { name: 'รายละเอียดผลิตภัณฑ์' })).toBeVisible();
}

async function attachPublishedEvidence(page: Page, testInfo: TestInfo) {
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach('lottery-published-state', {
    body: screenshot,
    contentType: 'image/png',
  });
}

test.describe('Admin Lottery governed configuration publish', () => {
  test('moves a draft through review + MFA re-auth to published state', async ({ page }, testInfo) => {
    const state = createState('DRAFT');
    await installAdminApiMock(page, state);
    await openVersionDetail(page);

    await expect(page.locator('.lot-impact strong')).toHaveText('v1 · Draft');
    await page.getByRole('button', { name: 'ตรวจแล้ว ส่งอนุมัติ' }).click();

    await expect(page.getByText('ส่งตรวจแล้ว รอผู้มีสิทธิ์อนุมัติ')).toBeVisible();
    await expect(page.locator('.lot-impact strong')).toHaveText('v1 · รออนุมัติ');
    expect(state.submitKeys).toHaveLength(1);
    expect(state.submitKeys[0]).not.toBe('');

    await page.getByRole('button', { name: 'อนุมัติและเผยแพร่' }).click();
    await page.getByLabel('รหัส MFA 6 หลัก').fill('123456');
    await page.getByRole('button', { name: 'ยืนยันอนุมัติและเผยแพร่' }).click();

    await expect(page.getByText('เผยแพร่เวอร์ชันสำเร็จ')).toBeVisible();
    await expect(page.locator('.lot-impact strong')).toHaveText('v1 · เผยแพร่แล้ว');
    await expect(
      page.getByText('เวอร์ชันนี้เผยแพร่แล้ว หากต้องเปลี่ยนการตั้งค่าให้สร้างเวอร์ชันใหม่'),
    ).toBeVisible();

    expect(state.reauthBodies).toEqual([
      { actionClass: 'lottery-configuration.publish', code: '123456' },
    ]);
    expect(state.approveKeys).toHaveLength(1);
    expect(state.approveKeys[0]).not.toBe('');
    expect(state.version.state).toBe('PUBLISHED');

    await attachPublishedEvidence(page, testInfo);
  });

  test('keeps review state and exposes maker-checker denial without leaking internals', async ({ page }) => {
    const state = createState('REVIEW');
    state.denyApproval = true;
    await installAdminApiMock(page, state);
    await openVersionDetail(page);

    await expect(page.locator('.lot-impact strong')).toHaveText('v1 · รออนุมัติ');
    await expect(
      page.getByText('ADMIN ต้องให้ผู้มีสิทธิ์คนอื่นอนุมัติ ระบบตรวจ maker-checker อีกครั้งก่อนเผยแพร่'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'อนุมัติและเผยแพร่' }).click();
    await page.getByLabel('รหัส MFA 6 หลัก').fill('654321');
    await page.getByRole('button', { name: 'ยืนยันอนุมัติและเผยแพร่' }).click();

    const alert = page.locator('.lot-error[role="alert"]');
    await expect(alert).toContainText('ผู้สร้างเวอร์ชันไม่สามารถอนุมัติเวอร์ชันเดียวกันได้');
    await expect(alert).toContainText('MAKER_CHECKER_VIOLATION');
    await expect(alert).toContainText('corr-maker-checker-e2e');
    await expect(page.locator('.lot-impact strong')).toHaveText('v1 · รออนุมัติ');
    await expect(page.getByText('เผยแพร่เวอร์ชันสำเร็จ')).toHaveCount(0);
    expect(state.version.state).toBe('REVIEW');
    expect(state.approveKeys).toHaveLength(1);
    expect(state.approveKeys[0]).not.toBe('');
  });
});
