# Lottify v1 — Lead Agent Action Items

ตรวจจากเอกสารใน repository เมื่อ 2026-09-15 โดยคง modality ตามต้นฉบับ และไม่สร้าง task ภายนอก

## Action items

| ID | Proposed outcome | Owner | Due date | Dependency | Acceptance condition | Risk | Citation |
|---|---|---|---|---|---|---|---|
| L-01 | ระบุ disposition ของไฟล์ untracked docs/implementation/zero-default-fee-persistence-goal.md และ .hermes/ ว่าจะเก็บ, stage ในงานถัดไป หรือทิ้ง | unresolved — owner ต้องยืนยัน | unresolved | การตัดสินใจของเจ้าของ workspace | git status --short เหลือเฉพาะไฟล์ที่ตั้งใจเก็บ และไม่มีไฟล์ untracked ถูกนับเป็น candidate โดยบังเอิญ | สถานะ branch อาจปะปนกับงาน local | .hermes/status/2026-09-15-project-status.md, Baseline table |
| L-02 | ตรวจ root cause ของ GitHub Actions CI run ล่าสุด และทำให้มี successful candidate CI ที่ตรงกับ commit ที่จะรับรอง | Lead + release-gate-agent | blocked | ต้องมี external runner/infrastructure พร้อมใช้งาน | verify และ container-smoke ผ่านใน run เดียวกัน พร้อม migration, integration, scans, build และ container smoke logs | candidate run 35002766554 บน e5c8b322 fail ทั้งสอง jobs ก่อนมี steps/logs แม้ workflow ถูกเปิดกลับ; local green ใช้แทน CI ไม่ได้ | .hermes/status/2026-09-15-project-status.md, .github/workflows/ci.yml |
| L-03 | เปิด PostgreSQL/Redis ตาม CI environment และเก็บ integration evidence ของชุดที่ local skip | qa-agent + backend-agent | unresolved | ต้องมี services และ test env | รัน RUN_INTEGRATION_TESTS=1 pnpm test หรือชุด opt-in ที่กำหนด; ผลต้องระบุ 235 skipped ที่หายไปหรือเหตุผลที่ยัง skip พร้อม machine-readable evidence | Local pnpm test ผ่าน 427 แต่ skip 235 integration tests | .hermes/status/2026-09-15-project-status.md, .github/workflows/ci.yml (RUN_INTEGRATION_TESTS) |
| L-04 | สร้าง requirement matrix ครบสำหรับ active domains โดย map requirement → implementation checkpoint → test/evidence → CI run → gap | lead-agent + memory-context-agent | unresolved | ต้องใช้ Ticket 16, Ticket 19 และ checkpoint ปัจจุบัน | ทุก active domain มี row ที่ cite path/section และไม่มี release-critical requirement ที่ไม่มี verification route | Ticket 16 ระบุว่าไม่มี release-critical requirement ใดขาด verification route | .hermes/status/2026-09-15-project-status.md, .scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md:41-43 |
| L-05 | ปิดหรือทำให้ชัดเจนเรื่อง Lottery Configuration/Draw acceptance gaps | backend-agent + frontend-agent; reviewers: domain-agent, api-contract-agent, qa-agent, quality-gate-agent | unresolved | ต้องคง shared publication/API boundary single-writer | มี independent review, full immutable-candidate CI/fresh-migration evidence และ applicable Admin UI/E2E evidence; Issue #24 จึงค่อยพิจารณา acceptance | Checkpoint ปัจจุบันยังระบุ Issue #24 open และไม่ใช่ Production GO | docs/implementation/lottery-configuration-status.md:113,123,133 |
| L-06 | แยก decision package สำหรับ non-zero fee semantics และ recovery/debt lifecycle ก่อน implementation | financial-integrity-agent + domain-agent | unresolved | ต้องมี Payments vertical/source decision; ห้าม Writer เดา policy | มี approved decision ครอบคลุม payer, gross/net, Withdrawal Reservation inclusion, fee-account allocation และ debt/recovery lifecycle หรือบันทึกว่า source-blocked อย่างเป็นทางการ | การ implement ก่อนตัดสินใจอาจสร้าง financial contract ผิด | docs/implementation/financial-core-status.md:44,48-57, docs/implementation/zero-default-fee-persistence-goal.md:35,38 |
| L-07 | เติม Identity/Eligibility acceptance evidence ที่ยังขาด | security-agent + qa-agent | unresolved | ต้องมี policy decision สำหรับ age/jurisdiction และ anomalous-device risk; official CI ต้องกลับมาใช้ได้ | Ticket 16 evidence ครบสำหรับ OTP abuse/rate-limit, anomalous-device risk, age/jurisdiction policy และ official CI; ห้าม invent threshold | Identity/Eligibility ยัง incomplete และมี source-blocked policy | docs/implementation/identity-eligibility-status.md:75-85 |
| L-08 | ตรวจ operational release gates: PITR restore, reconciliation freshness, security scans, sensitive-log review และ critical workflow evidence | release-gate-agent + security-agent + qa-agent | unresolved | ต้องรอ business vertical evidence ที่ roadmap กำหนด | Ticket 13/16 matrix ผ่าน; restore proof ตรวจ Ledger invariants/schema/references; ไม่มี unresolved Critical findings; production-like failure/recovery evidence ครบ | Production GO ถูก block ด้วย restore/security/recovery obligations | .scratch/lottify-v1-specification/issues/13-non-functional-targets-and-release-gates.md:18,24-25, .scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md:26 |

## Explicit blockers and ambiguities

- External CI blocker: candidate run 35002766554 ถูกเปิด workflow แล้วแต่ยัง fail ก่อน runner steps/logs; จึงยังไม่ควรสรุปว่าเป็น code failure โดยตรง.
- Source-blocked policy: concrete age/jurisdiction thresholds, anomalous-device behavior, non-zero fee allocation และ debt/recovery lifecycle ยังไม่มีข้อกำหนดที่อนุมัติ; ห้ามสร้าง implementation policy จาก inference (docs/implementation/identity-eligibility-status.md:81, docs/implementation/financial-core-status.md:50-52).
- Acceptance wording: local tests ที่ผ่านไม่เท่ากับ milestone acceptance หรือ Production GO; ทุก action ต้องรักษา evidence scope ของ Ticket 16 (docs/implementation/lottery-configuration-status.md:123, .scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md:41-43).

## Recommended Lead dispatch order

1. L-01 — cleanly classify workspace state.
2. L-02 — resolve/confirm CI external blocker.
3. L-03 — collect integration evidence in a controlled environment.
4. L-04 — build the cross-domain requirement/evidence matrix.
5. L-06 and L-07 — resolve integrity/security/source-blocked decisions before dependent writers.
6. L-05 — run the Lottery acceptance package with required independent reviewers.
7. L-08 — perform the release/operational gate only after prerequisites are accepted.
