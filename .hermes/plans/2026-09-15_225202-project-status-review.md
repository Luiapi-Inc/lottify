# แผนตรวจสถานะโปรเจกต์ Lottify

## Goal

จัดทำรายงานสถานะปัจจุบันของ Lottify ที่ตรวจสอบย้อนกลับได้ ครอบคลุม Git, implementation checkpoints, source-of-truth requirements, build/test/CI health และช่องว่างที่ยังค้างอยู่ โดยไม่แก้ไขโค้ดหรือเอกสารผลิตภัณฑ์

## Current context / assumptions

- Workspace คือ `/home/ubuntu/lottify` และ branch ปัจจุบันคือ `main` ที่ `HEAD=0fcf1b707080386a772dcd778ec9c478494f9b4e`.
- Working tree มีไฟล์ที่ยังไม่ tracked คือ `docs/implementation/zero-default-fee-persistence-goal.md`; ต้องแยกออกจากสถานะของ branch และไม่แก้ไขหรือนับเป็นผลงานของการตรวจครั้งนี้โดยอัตโนมัติ.
- เอกสารกำกับหลักคือ `AGENTS.md`, `CONTEXT.md`, `README.md`, roadmap ` .scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md`, workflows `02-end-to-end-business-workflows.md`, traceability `16-acceptance-criteria-and-test-traceability.md`, active checkpoints ใน `docs/implementation/` และ ADR ที่เกี่ยวข้อง.
- งานนี้เป็น read-only status review; ผลลัพธ์ควรเป็นรายงานหรือสรุป ไม่ใช่การแก้บั๊ก การ migrate database หรือการ deploy.

## Architecture / proposed approach

เริ่มจากสร้าง baseline ที่ immutable (branch, commit, working tree, runtime/tool versions) แล้วเทียบ implementation checkpoints กับ roadmap และ acceptance traceability เพื่อแยก “มีโค้ดแล้ว”, “มีหลักฐานแล้ว” และ “ยังขาดหลักฐาน”. จากนั้นตรวจสุขภาพแบบ deterministic ด้วยคำสั่งที่ repo รองรับ (`pnpm check` หรือการรันขั้นย่อยที่ปลอดภัย) พร้อมแยกปัญหาจาก environment/dependency ออกจาก regression จริง สุดท้ายจัดกลุ่มผลลัพธ์ตาม criticality และส่งมอบรายการ gap ที่มี path, requirement และคำสั่งตรวจซ้ำได้.

## Step-by-step tasks

1. **สร้าง review baseline (2–5 นาที)**
   - อ่าน `/home/ubuntu/lottify/AGENTS.md`, `/home/ubuntu/lottify/CONTEXT.md`, `/home/ubuntu/lottify/README.md` และบันทึกข้อจำกัดของการตรวจ.
   - รัน:
     ```bash
     cd /home/ubuntu/lottify
     git branch --show-current
     git rev-parse HEAD
     git status --short --branch
     node --version
     pnpm --version
     ```
   - ผลที่คาดหวัง: ได้ branch/commit/dirty paths และเวอร์ชันเครื่องมือที่อ้างอิงได้; ห้ามใช้ `git clean`, reset หรือคำสั่งเขียนใด ๆ.

2. **รวบรวม implementation checkpoint และความคืบหน้า (2–5 นาที)**
   - ตรวจไฟล์ `docs/implementation/*.md` ทั้งหมด โดยจัดหมวดสถานะ, intended result, current state, evidence และ open gaps.
   - ตรวจไฟล์ที่ยังไม่ tracked แยกต่างหากด้วย `git diff --no-index /dev/null docs/implementation/zero-default-fee-persistence-goal.md || true` และระบุชัดว่าเป็น local/untracked evidence.
   - ผลที่คาดหวัง: ตาราง checkpoint → domain/capability → stated status → evidence paths → unresolved gaps โดยไม่สรุปจากชื่อไฟล์เพียงอย่างเดียว.

3. **เทียบ roadmap กับ implementation (2–5 นาที)**
   - อ่าน `.scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md` และค้นหา reference ไปยัง checkpoint, issue, ADR และ capability ด้วย:
     ```bash
     rg -n "(status|checkpoint|accept|evidence|gap|TODO|blocked|in progress|complete)" \
       .scratch/lottify-v1-specification/issues/19-implementation-roadmap-and-delivery-sequencing.md \
       docs/implementation docs/adr
     ```
   - ผลที่คาดหวัง: รายการ requirement/phase ที่ roadmap ระบุว่าเสร็จหรือค้าง พร้อม checkpoint หรือ path ที่รองรับ/ขัดแย้ง.

4. **ตรวจ acceptance traceability และ critical-path obligations (2–5 นาที)**
   - อ่าน `.scratch/lottify-v1-specification/issues/16-acceptance-criteria-and-test-traceability.md` และ `.scratch/lottify-v1-specification/issues/02-end-to-end-business-workflows.md`.
   - สร้าง matrix ต่อ requirement สำคัญ: requirement ID → planned implementation → tests/evidence → actual result → gap.
   - ตรวจเป็นพิเศษ financial ledger/wallet, reservation, idempotency, settlement/finalization, migration compatibility, API contract และ security ตามข้อกำหนดในเอกสาร.
   - ผลที่คาดหวัง: ห้ามประกาศ “ผ่าน” เพียงเพราะ test suite เขียว หากไม่มี requirement evidence.

5. **ตรวจ source/config และโครงสร้าง implementation (2–5 นาที)**
   - ตรวจ `package.json`, `pnpm-workspace.yaml`, `apps/`, `packages/`, `src/`, `prisma/`, `tests/`, `.github/workflows/` และ `docs/agents/` แบบ read-only.
   - รัน:
     ```bash
     cd /home/ubuntu/lottify
     rg --files apps packages src prisma tests .github/workflows | wc -l
     rg -n "TODO|FIXME|throw new Error\(['\"]Not implemented|describe\.skip|it\.skip|test\.skip" \
       apps packages src prisma tests
     ```
   - ผลที่คาดหวัง: ตัวเลขไฟล์และรายการ stub/skipped tests สำหรับ risk inventory; แยก intentional prototype จาก production gap ด้วยบริบทของไฟล์.

6. **รัน verification แบบไม่เปลี่ยนสถานะ repo (2–5 นาทีต่อคำสั่ง)**
   - ตรวจ environment ก่อน แล้วรันทีละคำสั่งเพื่อเก็บ exact failure:
     ```bash
     cd /home/ubuntu/lottify
     pnpm typecheck
     pnpm test
     pnpm build
     ```
   - หาก prerequisite พร้อมและคำสั่งไม่ทำ migration/deploy ให้รัน `pnpm check`; หากต้องการสร้าง generated output ให้บันทึกว่าเป็น workspace mutation และหยุดก่อนโดยขออนุมัติ เพราะ review นี้ read-only.
   - ผลที่คาดหวัง: exit code, failing package/test, duration และ dependency/environment cause ของแต่ละคำสั่ง; ห้าม retry ซ้ำโดยไม่มี state/evidence ใหม่.

7. **ตรวจ CI และ operational readiness แบบอ่านอย่างเดียว (2–5 นาที)**
   - อ่าน `.github/workflows/*`, `infra/`, `docs/implementation/postgres-pitr-readiness.md` และเอกสาร release/agent workflow ที่เกี่ยวข้อง.
   - เปรียบเทียบ local commands กับ CI commands และระบุสิ่งที่ยังไม่มีหลักฐาน เช่น migration safety, rollback, PITR, observability หรือ deployment gate.
   - ผลที่คาดหวัง: CI/local parity summary และ operational gaps ที่ผูกกับ path/document.

8. **จัดทำรายงานสถานะและ acceptance decision (2–5 นาที)**
   - สรุปเป็นหมวด: Green (evidence ครบ), Yellow (implementation มีแต่ evidence/coverage ไม่ครบ), Red (requirement ยังไม่เสร็จหรือ verification ล้มเหลว), Blocked (รอ external dependency).
   - ทุก gap ต้องมี `Requirement → Evidence → Actual result → Next action` และระบุ owner/criticality หากอนุมานได้จาก repo.
   - ระบุ explicit scope exclusions: ไม่แก้ไฟล์ untracked, ไม่สร้าง migration, ไม่ deploy, ไม่ claim release readiness หาก evidence บังคับยังขาด.

## Tests / validation

งานนี้เป็น status inspection ไม่ใช่ code change จึงไม่มี TDD implementation cycle หรือ commit ที่ต้องทำ. Validation ที่ต้องเก็บเป็นหลักฐานคือ:

- `git status --short --branch` ก่อนและหลัง review ต้องแสดงการเปลี่ยนแปลงเดิมเท่านั้น.
- `pnpm typecheck`, `pnpm test`, `pnpm build` ต้องบันทึก exit code และ output ที่เกี่ยวข้อง.
- ข้อสรุปแต่ละข้อในรายงานต้องชี้กลับไปยังเอกสาร, path, test หรือคำสั่งที่ตรวจได้.
- ถ้าคำสั่งใดสร้างไฟล์ generated/cache ให้ไม่รวมผลนั้นเป็น repository change และรายงานอย่างชัดเจน.

## Risks, tradeoffs, and open questions

- `pnpm test` หรือ `pnpm build` อาจพึ่ง PostgreSQL/Redis/env secrets; failure จาก environment ต้องไม่ถูกตีความเป็น code regression โดยไม่มีการแยกสาเหตุ.
- การตรวจทั้งหมดอาจใช้เวลานานใน monorepo; ควรรันคำสั่งอิสระแบบขนานได้เฉพาะเมื่อไม่แย่ง resource และต้องบันทึกผลแยกกัน.
- `docs/implementation/zero-default-fee-persistence-goal.md` เป็น untracked และอาจเป็นงานที่กำลังทำอยู่ จึงต้องให้เจ้าของยืนยันก่อนรวมใน acceptance status.
- ยังต้องยืนยันว่า “สถานะโปรเจกต์” ต้องการรายงานเฉพาะ repository health หรือรวมสถานะ GitHub Issues, deployment environment และ runtime services ด้วย; แผนนี้ครอบคลุม repo/CI/docs เป็นค่าเริ่มต้น และจะถือ external systems เป็น out of scope หากไม่ได้รับอนุญาต.
