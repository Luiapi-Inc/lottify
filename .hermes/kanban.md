# Lottify v1 — Lead Kanban

อัปเดต: 2026-09-15  
แหล่งข้อมูล: [.hermes/action-items/2026-09-15-lottify-lead-actions.md](action-items/2026-09-15-lottify-lead-actions.md)

## Hermes board snapshot

- Authoritative Hermes board: `lottify` — **Lottify v1 Implementation**.
- Latest verified counts from `hermes kanban boards list`: `archived=2`, `done=23`.
- Verified with `hermes kanban stats`: `done=23`; all active statuses (`triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`) are `0`.
- The `default` board was empty in the same snapshot.
- This Markdown file is the Lead working view for current gaps; it is not a replacement for the Hermes board.

## Latest operational update

- GitHub CLI active account: `luiapidev`.
- GitHub credentials are loaded from the CLI keyring; plaintext tokens are not stored in the repository.
- CI has not been rerun after the account switch; L-02 remains Blocked.

## Blocked

- [ ] **L-02 — แก้/ยืนยัน CI blocker**
  - Owner: Lead + release-gate-agent
  - Blocker: GitHub Actions ล่าสุด fail ก่อนเริ่ม job; ต้องตรวจ billing/runner availability
  - Done when: verify และ container-smoke ผ่านใน candidate เดียวกัน

- [ ] **L-06 — ตัดสิน non-zero fee และ debt/recovery semantics**
  - Owner: financial-integrity-agent + domain-agent
  - Blocker: source ยังไม่กำหนด payer, gross/net, allocation และ debt lifecycle
  - Done when: มี approved decision หรือบันทึก source-blocked อย่างเป็นทางการ

- [ ] **L-07 — ปิด Identity/Eligibility evidence gaps**
  - Owner: security-agent + qa-agent
  - Blocker: age/jurisdiction และ anomalous-device policy ยัง source-blocked; official CI ยังไม่พร้อม
  - Done when: Ticket 16 evidence และ policy decisions ครบ

## Ready

- [ ] **L-01 — จำแนก untracked files**
  - Owner: workspace owner / Lead
  - Done when: disposition ของ docs/implementation/zero-default-fee-persistence-goal.md และ .hermes/ ชัดเจน

- [ ] **L-03 — เก็บ integration evidence**
  - Owner: qa-agent + backend-agent
  - Dependency: PostgreSQL/Redis test environment
  - Done when: integration tests ที่เคย skip มีผลรันหรือเหตุผลที่ตรวจสอบได้

- [ ] **L-04 — สร้าง requirement/evidence matrix**
  - Owner: lead-agent + memory-context-agent
  - Dependency: Ticket 16, Ticket 19 และ checkpoints
  - Done when: ทุก active domain มี Requirement → Evidence → Actual Result → Gap

## Backlog

- [ ] **L-05 — Lottery Configuration/Draw acceptance**
  - Owner: backend-agent + frontend-agent
  - Reviewers: domain-agent, api-contract-agent, qa-agent, quality-gate-agent
  - Dependency: CI evidence และ independent review
  - Done when: Issue #24 acceptance gates ครบ

- [ ] **L-08 — Operational release gates**
  - Owner: release-gate-agent + security-agent + qa-agent
  - Dependency: business vertical evidence และ CI
  - Done when: PITR/restore, reconciliation, security, recovery และ critical workflows ผ่าน Ticket 13/16

## Done

- [x] Baseline branch/commit/working tree ถูกบันทึก
- [x] Local typecheck ผ่าน
- [x] Local build ผ่าน
- [x] Status report ถูกสร้าง
- [x] Primary agent roster และ reviewer routing ถูกกำหนด

## Board rules

- Lead Agent เป็นผู้ย้ายการ์ดและตัดสิน acceptance
- การ์ดที่แตะเงิน, schema, transaction หรือ API contract ต้องมี reviewer ตาม routing
- Done ต้องมี evidence ไม่ใช่เพียง test ผ่าน
- ห้ามประกาศ Production GO หากการ์ด release-critical ยังไม่เสร็จ
