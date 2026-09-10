(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function setupKyc() {
    const host = $('[data-kyc-flow]');
    if (!host) return;
    const view = $('[data-kyc-state-view]', host);
    const status = $('[data-kyc-status]');
    const configs = {
      required: { label: 'ต้องดำเนินการ', cls: 'warning', title: 'ต้องยืนยันตัวตนสำหรับบริการนี้', copy: 'เริ่มคำขอ KYC เมื่อคุณต้องใช้ capability ที่ policy ปัจจุบันกำหนด โดยไม่ปิดบริการอื่นที่ยังผ่านเงื่อนไข', action: '<button class="button primary" type="button" data-kyc-next="submitted">เริ่มยืนยันตัวตน</button>' },
      submitted: { label: 'ส่งข้อมูลแล้ว', cls: 'info', title: 'รับข้อมูลแล้ว', copy: 'ระบบรับข้อมูลสำหรับ Verification Case นี้แล้ว และยังไม่ถือว่ายืนยันสำเร็จจนกว่าผลการตรวจจะเป็น authoritative', action: '<button class="button secondary" type="button" data-kyc-next="review">ดูสถานะถัดไป</button>' },
      review: { label: 'กำลังตรวจสอบ', cls: 'warning', title: 'กำลังตรวจสอบข้อมูล', copy: 'ยังไม่มีผลยืนยันสุดท้าย บริการที่ต้องใช้ KYC ยังคงรอ ส่วน capability อื่นใช้ได้ตาม eligibility ของตนเอง', action: '<button class="button secondary" type="button" data-kyc-next="verified">จำลองผลยืนยัน</button>' },
      more_info: { label: 'ต้องเพิ่มข้อมูล', cls: 'warning', title: 'ต้องส่งข้อมูลเพิ่มเติม', copy: 'Verification Case ต้องการข้อมูลเพิ่มก่อนประเมินต่อ ระบบควรบอกสิ่งที่ต้องทำโดยไม่แสดง provider-specific code', action: '<button class="button primary" type="button" data-kyc-next="submitted">ส่งข้อมูลเพิ่มเติม</button>' },
      rejected: { label: 'ไม่ผ่านการตรวจ', cls: 'danger', title: 'การยืนยันตัวตนไม่ผ่าน', copy: 'ผล canonical ของ Verification Case นี้คือ REJECTED บริการที่ต้องใช้ KYC ยังคงใช้ไม่ได้จนกว่าจะมีผลใหม่ตามขั้นตอนที่ policy อนุญาต โดยบริการอื่นยังประเมิน eligibility แยกกัน', action: '<a class="button secondary" href="account.html">กลับบัญชี</a>' },
      verified: { label: 'ยืนยันแล้ว', cls: 'success', title: 'ยืนยันตัวตนแล้ว', copy: 'มีผล KYC ที่ยืนยันแล้วสำหรับ case นี้ แต่ capability สำคัญยังต้องประเมิน eligibility และ freshness อีกครั้งเมื่อทำรายการ', action: '<a class="button primary" href="account.html">กลับบัญชี</a>' },
    };
    const params = new URLSearchParams(location.search);
    let storedState = null;
    try { storedState = window.localStorage.getItem('lottify-kyc-status'); } catch (_) {}
    let state = configs[params.get('state')] ? params.get('state') : (configs[storedState] ? storedState : 'required');
    const render = () => {
      const c = configs[state];
      status.className = 'status ' + c.cls;
      status.textContent = c.label;
      view.innerHTML = '<div class="verification-state-card"><h3>' + c.title + '</h3><p>' + c.copy + '</p><div class="verification-actions">' + c.action + '</div></div>';
      $$('[data-kyc-state]', host).forEach((button) => {
        const active = button.dataset.kycState === state;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      try { window.localStorage.setItem('lottify-kyc-status', state); } catch (_) {}
    };
    host.addEventListener('click', (event) => {
      const switcher = event.target.closest('[data-kyc-state]');
      const next = event.target.closest('[data-kyc-next]');
      if (switcher) state = switcher.dataset.kycState;
      if (next) state = next.dataset.kycNext;
      if (switcher || next) render();
    });
    render();
  }

  function setupBank() {
    const trigger = $('[data-bank-change]');
    const flow = $('[data-bank-flow]');
    if (!trigger || !flow) return;
    const view = $('[data-bank-flow-view]', flow);
    const badge = $('[data-bank-flow-badge]', flow);
    let state = 'reauth';
    let draft = { bank: '', account: '' };
    const currentName = $('[data-bank-current-name]');
    const currentMark = $('[data-bank-current-mark]');

    const maskDestination = (bank, account) => bank + ' ••••' + account.slice(-4);
    const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
    const applyStoredDestination = () => {
      try {
        const stored = JSON.parse(window.localStorage.getItem('lottify-bank-destination') || 'null');
        if (!stored?.bank || !stored?.account) return;
        currentName.textContent = maskDestination(stored.bank, stored.account);
        currentMark.textContent = stored.bank.trim().charAt(0).toUpperCase() || 'B';
      } catch (_) {}
    };
    const render = () => {
      if (state === 'reauth') {
        badge.className = 'status warning'; badge.textContent = 'ต้องยืนยันซ้ำ';
        view.innerHTML = '<div class="bank-flow-steps"><div class="bank-flow-step"><strong>1 · ยืนยันว่าเป็นคุณ</strong><span>รายการเปลี่ยนปลายทางมีความอ่อนไหว ระบบอาจขอ re-auth/OTP ตาม policy</span></div></div><div class="reauth-code" data-reauth-code>' + '<input inputmode="numeric" maxlength="1" aria-label="OTP สำหรับยืนยันซ้ำ" />'.repeat(6) + '</div><div class="field-error" data-reauth-error></div><div class="verification-actions"><button class="button primary" type="button" data-bank-next="details">ยืนยัน OTP →</button><button class="button secondary" type="button" data-bank-cancel>ยกเลิก</button></div>';
      } else if (state === 'details') {
        badge.className = 'status info'; badge.textContent = 'กรอกปลายทางใหม่';
        view.innerHTML = '<div class="bank-flow-steps"><div class="bank-flow-step"><strong>2 · ระบุบัญชีรับเงินใหม่</strong><span>OTP เป็นเพียง re-auth ขั้นตอนนี้ยังต้องระบุปลายทางใหม่และส่งให้ระบบตรวจแยกต่างหาก</span></div></div><div class="form-grid" style="margin-top:14px"><div class="field"><label>ธนาคาร</label><input class="input" data-bank-name value="' + escapeHtml(draft.bank) + '" placeholder="ชื่อธนาคาร" /></div><div class="field"><label>เลขบัญชีรับเงิน</label><input class="input" inputmode="numeric" autocomplete="off" data-bank-account value="' + escapeHtml(draft.account) + '" placeholder="กรอกเลขบัญชี" /></div></div><div class="field-error" data-bank-details-error></div><div class="verification-actions"><button class="button primary" type="button" data-bank-next="review">ตรวจข้อมูลก่อนส่ง →</button><button class="button secondary" type="button" data-bank-cancel>ยกเลิก</button></div>';
      } else if (state === 'review') {
        badge.className = 'status warning'; badge.textContent = 'กำลังตรวจสอบ';
        view.innerHTML = '<div class="bank-flow-steps"><div class="bank-flow-step"><strong>3 · ส่งปลายทางใหม่เพื่อตรวจแล้ว</strong><span>' + escapeHtml(maskDestination(draft.bank, draft.account)) + ' · OTP ผ่านแล้ว แต่ยังไม่ถือว่าปลายทางใหม่ได้รับอนุมัติ ระบบต้องตรวจ verification/risk/eligibility แยกอีกครั้ง</span></div><div class="bank-flow-step"><strong>ปลายทางเดิมยังคงใช้ได้</strong><span>ตัวอย่างนี้ไม่สลับปลายทางจนกว่าผลตรวจของปลายทางใหม่จะยืนยันแล้ว</span></div></div><div class="verification-actions" style="margin-top:14px"><button class="button secondary" type="button" data-bank-next="verified">จำลองผลตรวจผ่าน</button></div>';
      } else {
        badge.className = 'status success'; badge.textContent = 'ยืนยันแล้ว';
        view.innerHTML = '<div class="notice success"><b>✓</b><div><strong>ปลายทางใหม่ผ่านการตรวจแล้ว</strong>' + escapeHtml(maskDestination(draft.bank, draft.account)) + ' เป็นปลายทางปัจจุบันใน mockup และยังต้องผ่าน Withdrawal eligibility ณ เวลาจ่าย</div></div><div class="verification-actions" style="margin-top:14px"><button class="button secondary" type="button" data-bank-cancel>ปิด</button></div>';
      }
    };
    applyStoredDestination();
    trigger.addEventListener('click', () => { state = 'reauth'; draft = { bank: '', account: '' }; flow.hidden = false; render(); });
    flow.addEventListener('input', (event) => {
      if (event.target.matches('[data-reauth-code] input')) event.target.value = event.target.value.replace(/\D/g, '').slice(0,1);
      if (event.target.matches('[data-bank-account]')) event.target.value = event.target.value.replace(/\D/g, '');
    });
    flow.addEventListener('click', (event) => {
      const cancel = event.target.closest('[data-bank-cancel]');
      if (cancel) { flow.hidden = true; return; }
      const next = event.target.closest('[data-bank-next]');
      if (!next) return;
      if (state === 'reauth') {
        const code = $$('[data-reauth-code] input', flow).map((input) => input.value).join('');
        if (code.length !== 6) { $('[data-reauth-error]', flow).textContent = 'กรอกรหัส OTP ให้ครบ 6 หลักเพื่อยืนยันซ้ำ'; return; }
      }
      if (state === 'details') {
        const bank = $('[data-bank-name]', flow).value.trim();
        const account = $('[data-bank-account]', flow).value.trim();
        if (!bank || !account) { $('[data-bank-details-error]', flow).textContent = 'กรอกธนาคารและเลขบัญชีรับเงินก่อนส่งตรวจ'; return; }
        draft = { bank, account };
      }
      state = next.dataset.bankNext;
      if (state === 'verified') {
        try { window.localStorage.setItem('lottify-bank-destination', JSON.stringify(draft)); } catch (_) {}
        applyStoredDestination();
      }
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', () => { setupKyc(); setupBank(); });
})();
