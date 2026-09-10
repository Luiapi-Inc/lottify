(function paymentStatusMockup(global) {
  "use strict";

  const VALID_STATES = Object.freeze(["pending", "review_required", "reconciling", "completed"]);
  const VALID_CONNECTIONS = Object.freeze(["online", "stale", "offline"]);

  const STATE_COPY = Object.freeze({
    deposit: {
      pending: {
        badge: "กำลังดำเนินการ",
        badgeClass: "is-pending",
        kicker: "สถานะล่าสุดจากระบบ",
        title: "กำลังรอการยืนยันการชำระเงิน",
        message: "ยังไม่เพิ่มยอดเข้ากระเป๋าจนกว่าจะยืนยันการชำระและบันทึกเครดิตสำเร็จครบถ้วน",
        amount: "ยังไม่เพิ่มยอด",
        noteClass: "",
        noteTitle: "ยังไม่ถือว่าฝากเงินสำเร็จ",
        note: "สถานะ Pending อาจอัปเดตผ่านการเชื่อมต่อแบบเรียลไทม์หรือการตรวจซ้ำ แต่จะไม่สร้างรายการฝากใหม่",
        steps: [
          ["done", "สร้างรายการฝากแล้ว", "ใช้เลขอ้างอิงเดิมติดตามรายการนี้"],
          ["current", "รอการยืนยันการชำระ", "ยังไม่เพิ่มยอดเงินระหว่างรอผลที่ยืนยันได้"],
          ["future", "บันทึกยอดเข้ากระเป๋า", "จะแสดงสำเร็จเมื่อการยืนยันและเครดิตในกระเป๋าครบถ้วน"]
        ]
      },
      review_required: {
        badge: "กำลังตรวจสอบ",
        badgeClass: "is-review",
        kicker: "ต้องตรวจสอบรายการเพิ่มเติม",
        title: "กำลังตรวจสอบรายการฝากเงิน",
        message: "พบข้อมูลที่ยังยืนยันไม่ได้ครบ รายการจึงยังไม่ถูกเพิ่มยอดอัตโนมัติ",
        amount: "ยังไม่เพิ่มยอด",
        noteClass: "is-warning",
        noteTitle: "เก็บเลขอ้างอิงนี้ไว้",
        note: "ไม่ต้องสร้างรายการใหม่ ระบบจะตรวจสอบรายการ DEP-20260910-91208 เดิมและอัปเดตเมื่อทราบผลที่ยืนยันได้",
        steps: [
          ["done", "สร้างรายการฝากแล้ว", "เลขอ้างอิงยังคงเดิม"],
          ["current", "กำลังตรวจสอบ", "ยอดยังไม่ถูกเพิ่มเข้ากระเป๋าระหว่างตรวจสอบ"],
          ["future", "ยืนยันผลและบันทึกยอด", "จะเปลี่ยนเป็นสำเร็จหลังบันทึกเครดิตแล้วเท่านั้น"]
        ]
      },
      reconciling: {
        badge: "กำลังเทียบข้อมูล",
        badgeClass: "is-reconciling",
        kicker: "กำลังตรวจสอบผลให้ตรงกัน",
        title: "กำลังยืนยันผลรายการฝากเงิน",
        message: "ระบบกำลังเทียบข้อมูลของรายการเดิมเพื่อหาผลที่ยืนยันได้ โดยยังไม่เพิ่มยอดซ้ำหรือเพิ่มยอดก่อนทราบผล",
        amount: "ยังไม่เพิ่มยอด",
        noteClass: "is-warning",
        noteTitle: "ยังไม่ต้องทำรายการซ้ำ",
        note: "เมื่อผลชัดเจน ระบบจะดำเนินการกับรายการเดิมเพียงครั้งเดียวและเก็บเลขอ้างอิงเดิมไว้สำหรับติดตาม",
        steps: [
          ["done", "รับรายการไว้แล้ว", "รายการเดิมยังอยู่ระหว่างติดตาม"],
          ["current", "กำลังเทียบข้อมูล", "ยังไม่สรุปสำเร็จจนกว่าผลอ้างอิงจะตรงกัน"],
          ["future", "บันทึกผลครั้งเดียว", "เครดิตที่มองเห็นจะเกิดครั้งเดียวเมื่อยืนยันครบ"]
        ]
      },
      completed: {
        badge: "ฝากเงินสำเร็จ",
        badgeClass: "is-completed",
        kicker: "ยืนยันจากระบบแล้ว",
        title: "ฝากเงินสำเร็จ",
        message: "การชำระเงินได้รับการยืนยันและยอด 1,000.00 บาทถูกบันทึกเข้ากระเป๋าแล้ว",
        amount: "+1,000.00 บาท",
        noteClass: "is-success",
        noteTitle: "เครดิตของรายการนี้แสดงเพียงครั้งเดียว",
        note: "หากระบบได้รับการยืนยันซ้ำ ยอดเงินของรายการ DEP-20260910-91208 จะไม่ถูกเพิ่มซ้ำ",
        steps: [
          ["done", "ยืนยันการชำระแล้ว", "ผลรายการได้รับการยืนยัน"],
          ["done", "บันทึกเครดิตเข้ากระเป๋าแล้ว", "+1,000.00 บาทสำหรับรายการอ้างอิงนี้"],
          ["done", "รายการเสร็จสมบูรณ์", "ติดตามย้อนหลังได้ด้วยเลขอ้างอิงเดิม"]
        ]
      }
    },
    withdrawal: {
      pending: {
        badge: "กำลังดำเนินการ",
        badgeClass: "is-pending",
        kicker: "สถานะล่าสุดจากระบบ",
        title: "กำลังดำเนินการถอนเงิน",
        message: "คำขอถูกบันทึกแล้วและยอด 3,000.00 บาทของรายการถูกพักไว้ระหว่างดำเนินการ",
        amount: "3,000.00 บาท",
        noteClass: "",
        noteTitle: "ยังไม่ถือว่าถอนเงินสำเร็จ",
        note: "รายการจะสำเร็จเมื่อมีหลักฐานการจ่ายเงินและการบันทึกยอดเสร็จครบถ้วนแล้วเท่านั้น",
        steps: [
          ["done", "ส่งคำขอแล้ว", "ยอด 3,000.00 บาทของรายการถูกพักไว้"],
          ["done", "ผ่านการตรวจเงื่อนไขของรายการ", "คำขอเข้าสู่ขั้นตอนดำเนินการจ่ายเงิน"],
          ["current", "กำลังดำเนินการจ่ายเงิน", "ยังไม่สรุปว่าสำเร็จก่อนยืนยันผลและบันทึกยอดครบ"],
          ["future", "ยืนยันและปิดรายการ", "ต้องมีผลการจ่ายเงินและการบันทึกยอดครบถ้วน"]
        ]
      },
      review_required: {
        badge: "ต้องตรวจสอบ",
        badgeClass: "is-review",
        kicker: "รายการต้องได้รับการตรวจสอบเพิ่มเติม",
        title: "กำลังตรวจสอบคำขอถอนเงิน",
        message: "ยอด 3,000.00 บาทของรายการยังคงพักไว้ระหว่างตรวจสอบ และยังไม่ถือว่าถอนสำเร็จ",
        amount: "3,000.00 บาท",
        noteClass: "is-warning",
        noteTitle: "ไม่ต้องส่งคำขอถอนซ้ำ",
        note: "ใช้เลขอ้างอิง WD-20260910-11840 ติดตามรายการเดิม ระบบจะอัปเดตเมื่อการตรวจสอบได้ข้อสรุป",
        steps: [
          ["done", "รับคำขอและพักยอดแล้ว", "ยอดของรายการยังคงถูกพักไว้"],
          ["current", "กำลังตรวจสอบ", "ยังไม่มีผลสำเร็จที่ยืนยันได้"],
          ["future", "ดำเนินการตามผลที่ยืนยันได้", "รายการเดิมจะดำเนินต่อโดยไม่สร้างคำขอใหม่"],
          ["future", "ปิดรายการเมื่อครบเงื่อนไข", "สำเร็จหลังการจ่ายเงินและบันทึกยอดครบเท่านั้น"]
        ]
      },
      reconciling: {
        badge: "กำลังตรวจสอบผล",
        badgeClass: "is-reconciling",
        kicker: "ผลการจ่ายเงินยังไม่ชัดเจน",
        title: "กำลังยืนยันผลรายการถอนเงิน",
        message: "ระบบยังยืนยันผลการจ่ายเงินไม่ได้ จึงคงยอด 3,000.00 บาทของรายการไว้ระหว่างตรวจสอบ",
        amount: "3,000.00 บาท",
        noteClass: "is-warning",
        noteTitle: "ยอดยังคงพักไว้จนกว่าจะทราบผลแน่นอน",
        note: "ระบบจะไม่คืนยอดหรือสรุปว่าสำเร็จจากผลที่ยังไม่ชัดเจน เมื่อยืนยันผลได้แล้วจึงดำเนินการกับรายการเดิมต่อเพียงครั้งเดียว",
        steps: [
          ["done", "คำขออยู่ระหว่างดำเนินการ", "เลขอ้างอิงเดิมยังใช้ติดตามได้"],
          ["current", "กำลังตรวจสอบผลการจ่ายเงิน", "ผลยังไม่ชัดเจนและยอดยังคงพักไว้"],
          ["future", "ยืนยันผลที่ถูกต้อง", "จากนั้นจึงดำเนินการต่อหรือคืนยอดตามผลที่พิสูจน์ได้"],
          ["future", "บันทึกผลครั้งเดียว", "ไม่ทำรายการซ้ำระหว่างที่ผลยังไม่ชัดเจน"]
        ]
      },
      completed: {
        badge: "ถอนเงินสำเร็จ",
        badgeClass: "is-completed",
        kicker: "ยืนยันจากระบบแล้ว",
        title: "ถอนเงินสำเร็จ",
        message: "ผลการจ่ายเงินได้รับการยืนยันและการบันทึกยอดของรายการเสร็จสมบูรณ์แล้ว",
        amount: "ดำเนินการครบแล้ว",
        noteClass: "is-success",
        noteTitle: "รายการปิดสมบูรณ์แล้ว",
        note: "เก็บเลขอ้างอิง WD-20260910-11840 ไว้ใช้ตรวจสอบย้อนหลังหรือแจ้งฝ่ายช่วยเหลือ",
        steps: [
          ["done", "ส่งคำขอและพักยอดแล้ว", "3,000.00 บาท"],
          ["done", "ยืนยันผลการจ่ายเงินแล้ว", "มีผลที่ยืนยันได้สำหรับรายการนี้"],
          ["done", "บันทึกยอดเสร็จแล้ว", "การเปลี่ยนแปลงยอดของรายการเสร็จสมบูรณ์"],
          ["done", "ถอนเงินสำเร็จ", "รายการปิดด้วยเลขอ้างอิงเดิม"]
        ]
      }
    }
  });

  function normalizeSimulation(search, kind) {
    const params = new URLSearchParams(search || "");
    const state = VALID_STATES.includes(params.get("state")) ? params.get("state") : "pending";
    const connection = VALID_CONNECTIONS.includes(params.get("connection")) ? params.get("connection") : "online";
    const requestedNext = params.get("next");
    const next = VALID_STATES.includes(requestedNext) ? requestedNext : null;
    return {
      kind: kind === "withdrawal" ? "withdrawal" : "deposit",
      state,
      connection,
      next
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeSimulation, VALID_STATES, VALID_CONNECTIONS };
  }

  if (!global.document) return;

  const root = global.document.querySelector("[data-payment-status]");
  if (!root) return;

  const kind = root.dataset.kind === "withdrawal" ? "withdrawal" : "deposit";
  let simulation = normalizeSimulation(global.location.search, kind);

  const elements = {
    badge: global.document.getElementById("status-badge"),
    kicker: global.document.getElementById("status-kicker"),
    title: global.document.getElementById("status-title"),
    message: global.document.getElementById("status-message"),
    amount: global.document.getElementById("authoritative-amount"),
    detail: global.document.getElementById("status-detail"),
    timeline: global.document.getElementById("status-timeline"),
    connection: global.document.getElementById("connection-banner"),
    refresh: global.document.getElementById("refresh-status"),
    refreshResult: global.document.getElementById("refresh-result"),
    updated: global.document.getElementById("status-updated")
  };

  function renderConnection(connection) {
    if (connection === "online") {
      elements.connection.hidden = true;
      elements.connection.textContent = "";
      return;
    }

    elements.connection.hidden = false;
    elements.connection.textContent = connection === "offline"
      ? "การเชื่อมต่อขาดหาย สถานะที่เห็นอาจไม่ใช่ข้อมูลล่าสุด กด “ตรวจสถานะล่าสุด” เมื่อเชื่อมต่อได้อีกครั้ง"
      : "ข้อมูลนี้อาจล้าสมัย กด “ตรวจสถานะล่าสุด” เพื่ออ่านสถานะรายการเดิมจากระบบอีกครั้ง";
  }

  function renderTimeline(steps) {
    elements.timeline.replaceChildren();
    steps.forEach(([status, title, detail], index) => {
      const item = global.document.createElement("li");
      item.className = status === "future" ? "" : `is-${status}`;

      const dot = global.document.createElement("span");
      dot.className = "payment-step-dot";
      dot.textContent = status === "done" ? "✓" : String(index + 1);

      const copy = global.document.createElement("div");
      copy.className = "payment-step-copy";
      const strong = global.document.createElement("strong");
      strong.textContent = title;
      const span = global.document.createElement("span");
      span.textContent = detail;
      copy.append(strong, span);
      item.append(dot, copy);
      elements.timeline.append(item);
    });
  }

  function render(nextSimulation) {
    simulation = nextSimulation;
    const copy = STATE_COPY[simulation.kind][simulation.state];

    elements.badge.className = `payment-status-badge ${copy.badgeClass}`;
    elements.badge.textContent = copy.badge;
    elements.kicker.textContent = copy.kicker;
    elements.title.textContent = copy.title;
    elements.message.textContent = copy.message;
    elements.amount.textContent = copy.amount;
    elements.detail.className = `payment-state-note ${copy.noteClass}`.trim();
    elements.detail.replaceChildren();
    const noteTitle = global.document.createElement("strong");
    noteTitle.textContent = copy.noteTitle;
    const note = global.document.createElement("span");
    note.textContent = copy.note;
    elements.detail.append(noteTitle, note);
    renderTimeline(copy.steps);
    renderConnection(simulation.connection);
  }

  function updateQuery(nextSimulation) {
    const params = new URLSearchParams();
    params.set("state", nextSimulation.state);
    if (nextSimulation.connection !== "online") params.set("connection", nextSimulation.connection);
    global.history.replaceState({}, "", `${global.location.pathname}?${params.toString()}`);
  }

  elements.refresh.addEventListener("click", function refreshAuthoritativeStatus() {
    if (simulation.connection === "offline") {
      elements.refreshResult.textContent = "ยังเชื่อมต่อไม่ได้ สถานะเดิมยังคงแสดงไว้โดยไม่สรุปผลใหม่";
      return;
    }

    const previousState = simulation.state;
    const nextState = simulation.next || simulation.state;
    const refreshed = { kind: simulation.kind, state: nextState, connection: "online", next: null };
    render(refreshed);
    updateQuery(refreshed);
    elements.updated.textContent = "ตรวจซ้ำแล้วในโหมดจำลอง";
    elements.refreshResult.textContent = nextState === "completed"
      ? "อ่านสถานะอ้างอิงล่าสุดแล้ว รายการเสร็จสมบูรณ์"
      : previousState === nextState
        ? "อ่านสถานะอ้างอิงล่าสุดแล้ว สถานะยังไม่เปลี่ยน และไม่ได้สร้างรายการใหม่"
        : "อ่านสถานะอ้างอิงล่าสุดแล้ว โดยไม่สร้างรายการใหม่หรือสรุปผลล่วงหน้า";
  });

  render(simulation);
})(typeof window !== "undefined" ? window : globalThis);
