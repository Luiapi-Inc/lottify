(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const icon = (name) => {
    const icons = {
      home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 12 3l8.5 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
      buy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5A2.5 2.5 0 0 1 7 3h10a2.5 2.5 0 0 1 2.5 2.5v2.2a2.8 2.8 0 0 0 0 5.6v5.2A2.5 2.5 0 0 1 17 21H7a2.5 2.5 0 0 1-2.5-2.5v-5.2a2.8 2.8 0 0 0 0-5.6z"/><path d="M9 7.5h6M9 11h6M9 14.5h4"/></svg>',
      slips: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-2.2-1.5-2 1.5-1.8-1.5-1.8 1.5-2-1.5L6 21z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
      wallet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 8h13.5A2.5 2.5 0 0 1 20 10.5V14h-5a3 3 0 0 1 0-6h5"/><circle cx="15" cy="11" r=".8"/></svg>',
      account: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
      bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 10a5.5 5.5 0 1 1 11 0c0 5 2 5.5 2 7h-15c0-1.5 2-2 2-7Z"/><path d="M9.5 20h5"/></svg>'
    };
    return icons[name] || '';
  };

  function renderShell() {
    if (document.body.dataset.auth === 'true' || $('.app-shell')) return;
    const page = document.body.dataset.page || 'home';
    const titles = {
      home: ['สวัสดีครับ', 'ขอให้วันนี้เป็นวันที่ดี'],
      buy: ['ซื้อหวย', 'เลือกงวด ตรวจราคา แล้วค่อยยืนยัน'],
      slips: ['โพยของฉัน', 'ใบรับรายการ ผล และประวัติ'],
      wallet: ['กระเป๋า', 'เงินสด โบนัส และรายการทั้งหมด'],
      account: ['บัญชีของฉัน', 'ข้อมูลสมาชิกและความปลอดภัย'],
    };
    const [title, subtitle] = titles[page] || titles.home;
    const currentMain = $('main');
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.innerHTML = `
      <aside class="sidebar">
        <a class="brand" href="index.html" aria-label="Lottify หน้าแรก"><span class="brand-mark">L</span><span>Lottify</span><small>iOS concept</small></a>
        <nav class="nav" aria-label="เมนูหลัก">
          <a href="index.html" data-nav="home"><span class="nav-icon">${icon('home')}</span><span>หน้าแรก</span></a>
          <a href="buy.html" data-nav="buy"><span class="nav-icon">${icon('buy')}</span><span>ซื้อหวย</span></a>
          <a href="slips.html" data-nav="slips"><span class="nav-icon">${icon('slips')}</span><span>โพยของฉัน</span></a>
          <a href="wallet.html" data-nav="wallet"><span class="nav-icon">${icon('wallet')}</span><span>กระเป๋า</span></a>
          <a href="account.html" data-nav="account"><span class="nav-icon">${icon('account')}</span><span>บัญชี</span></a>
        </nav>
        <a class="sidebar-promo" href="promotions.html"><strong>สิทธิ์โบนัสของคุณ</strong><span>ดูเงื่อนไขและความคืบหน้ายอดเล่น</span></a>
        <div class="sidebar-foot">Lottify Member · iOS-inspired interactive mockup</div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div class="topbar-title"><strong>${title}</strong><span>${subtitle}</span></div>
          <div class="topbar-actions">
            <input class="search" aria-label="ค้นหา" placeholder="ค้นหาหวย งวด หรือเมนู..." />
            <a class="icon-btn" href="index.html#alerts" aria-label="การแจ้งเตือน">${icon('bell')}<i class="notification-dot"></i></a>
            <a class="member-chip" href="account.html"><span class="avatar">ล</span><div><strong>คุณสมาชิก</strong><small>ระดับทั่วไป</small></div></a>
          </div>
        </header>
      </div>`;
    document.body.insertBefore(shell, currentMain);
    $('.workspace', shell).appendChild(currentMain);
    const mobile = document.createElement('nav');
    mobile.className = 'mobile-nav';
    mobile.setAttribute('aria-label', 'เมนูหลักมือถือ');
    mobile.innerHTML = `
      <a href="index.html" data-nav="home"><span class="nav-icon">${icon('home')}</span><span>หน้าแรก</span></a>
      <a href="buy.html" data-nav="buy"><span class="nav-icon">${icon('buy')}</span><span>ซื้อหวย</span></a>
      <a href="slips.html" data-nav="slips"><span class="nav-icon">${icon('slips')}</span><span>โพย</span></a>
      <a href="wallet.html" data-nav="wallet"><span class="nav-icon">${icon('wallet')}</span><span>กระเป๋า</span></a>
      <a href="account.html" data-nav="account"><span class="nav-icon">${icon('account')}</span><span>บัญชี</span></a>`;
    document.body.appendChild(mobile);
  }

  function setActiveNavigation() {
    const page = document.body.dataset.page;
    $$('[data-nav]').forEach((link) => {
      link.classList.toggle('active', link.dataset.nav === page);
    });
  }

  function setupCountdowns() {
    $$('[data-countdown]').forEach((node) => {
      let seconds = Number(node.dataset.countdown || 0);
      const render = () => {
        if (seconds <= 0) {
          node.textContent = 'หมดเวลา';
          node.classList.add('expired');
          return;
        }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        node.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        seconds -= 1;
      };
      render();
      window.setInterval(render, 1000);
    });
  }

  function setupTabs() {
    $$('[data-tabs]').forEach((group) => {
      const tabs = $$('.tab', group);
      tabs.forEach((tab) => tab.addEventListener('click', () => {
        tabs.forEach((item) => item.classList.toggle('active', item === tab));
        const filter = tab.dataset.filter;
        $$('[data-filter-item]').forEach((item) => {
          item.hidden = filter !== 'all' && item.dataset.filterItem !== filter;
        });
      }));
    });
  }

  function setupAmountChips() {
    $$('[data-amount-group]').forEach((group) => {
      const target = document.getElementById(group.dataset.amountTarget);
      if (!target) return;
      $$('.chip-btn', group).forEach((chip) => chip.addEventListener('click', () => {
        target.value = chip.dataset.amount;
        $$('.chip-btn', group).forEach((item) => item.classList.toggle('active', item === chip));
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }));
    });
  }

  function setupMethods() {
    $$('[data-methods]').forEach((group) => {
      $$('.method', group).forEach((method) => method.addEventListener('click', () => {
        $$('.method', group).forEach((item) => item.classList.toggle('active', item === method));
      }));
    });
  }

  function setupBetBuilder() {
    const form = $('[data-bet-builder]');
    if (!form) return;
    const numberInput = $('#bet-number');
    const amountInput = $('#bet-amount');
    const list = $('#bet-lines');
    const totalNodes = $$('[data-bet-total]');
    const countNode = $('#bet-count');
    const errorNode = $('#bet-error');
    const keypad = $('[data-number-keypad]');
    const betType = $('#bet-type');
    const bulkInput = $('#bet-bulk');
    const bulkButton = $('[data-add-bulk]');
    const applyAmountAll = $('[data-apply-amount-all]');
    const helperFeedback = $('#helper-feedback');
    let lines = [];

    const payoutFor = (number) => number.length === 3 ? 900 : 95;
    const requiredDigits = () => betType?.value.includes('2 ตัว') ? 2 : 3;
    const currentAmount = () => Number(amountInput.value);
    const isValidAmount = (amount) => Number.isFinite(amount) && amount >= 10;
    const unique = (values) => [...new Set(values)];
    const permutations = (value) => {
      const result = new Set();
      const walk = (prefix, rest) => {
        if (!rest.length) {
          result.add(prefix);
          return;
        }
        [...rest].forEach((digit, index) => {
          walk(prefix + digit, rest.slice(0, index) + rest.slice(index + 1));
        });
      };
      walk('', value);
      return [...result];
    };
    const addNumbers = (numbers, amount) => {
      let merged = 0;
      numbers.forEach((number) => {
        const existing = lines.find((line) => line.number === number);
        if (existing) {
          existing.amount += amount;
          existing.mergedCount = (existing.mergedCount || 1) + 1;
          merged += 1;
        } else {
          lines.push({ number, amount, mergedCount: 1 });
        }
      });
      render();
      return merged;
    };
    const render = () => {
      list.innerHTML = lines.map((line, index) => `
        <div class="bet-line">
          <div><span class="muted small">เลข</span><div class="bet-number">${line.number}</div>${line.mergedCount > 1 ? `<span class="merge-badge">รวม ${line.mergedCount} รายการซ้ำ</span>` : ''}</div>
          <div><span class="muted small">จำนวนเงิน</span><div><strong>${line.amount.toLocaleString('th-TH')} บาท</strong></div></div>
          <div><span class="muted small">อัตราจ่าย</span><div class="payout">x${payoutFor(line.number)}</div></div>
          <button class="button secondary" type="button" data-remove-line="${index}">ลบ</button>
        </div>`).join('');
      const total = lines.reduce((sum, line) => sum + line.amount, 0);
      totalNodes.forEach((node) => { node.textContent = `${total.toLocaleString('th-TH')} บาท`; });
      countNode.textContent = `${lines.length} รายการ`;
      $$('[data-remove-line]', list).forEach((button) => button.addEventListener('click', () => {
        lines.splice(Number(button.dataset.removeLine), 1);
        render();
      }));
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const number = numberInput.value.trim();
      const amount = currentAmount();
      const digits = requiredDigits();
      if (!new RegExp(`^\\d{${digits}}$`).test(number)) {
        errorNode.textContent = `กรอกเลข ${digits} หลักให้ตรงกับประเภทที่เลือก`;
        return;
      }
      if (!isValidAmount(amount)) {
        errorNode.textContent = 'จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ';
        return;
      }
      errorNode.textContent = '';
      const merged = addNumbers([number], amount);
      helperFeedback.textContent = merged ? `รวมเลขซ้ำ ${merged} รายการเข้ากับรายการเดิมแล้ว` : 'เพิ่มเลขลงรายการแล้ว';
      numberInput.value = '';
    });

    if (keypad) {
      const syncNumberInput = (value) => {
        numberInput.value = value.replace(/\D/g, '').slice(0, Number(numberInput.maxLength || 3));
        errorNode.textContent = '';
        numberInput.dispatchEvent(new Event('input', { bubbles: true }));
        numberInput.focus({ preventScroll: true });
      };

      $$('[data-key]', keypad).forEach((button) => button.addEventListener('click', () => {
        syncNumberInput(`${numberInput.value}${button.dataset.key}`);
      }));

      $('[data-key-action="clear"]', keypad)?.addEventListener('click', () => {
        syncNumberInput('');
      });

      $('[data-key-action="backspace"]', keypad)?.addEventListener('click', () => {
        syncNumberInput(numberInput.value.slice(0, -1));
      });
    }

    numberInput.addEventListener('input', () => {
      numberInput.value = numberInput.value.replace(/\D/g, '').slice(0, Number(numberInput.maxLength || 3));
      if (errorNode.textContent) errorNode.textContent = '';
    });

    betType?.addEventListener('change', () => {
      const digits = requiredDigits();
      numberInput.maxLength = digits;
      numberInput.value = numberInput.value.slice(0, digits);
      $$('[data-helper="run-front"], [data-helper="run-back"]').forEach((button) => {
        button.disabled = digits !== 2;
      });
      helperFeedback.textContent = digits === 2
        ? 'ประเภท 2 ตัว: ใช้กลับเลข สลับเลข รูดหน้า และรูดหลังได้'
        : 'ประเภท 3 ตัว: ใช้กลับเลขและสลับเลขได้ · รูดหน้า/หลังใช้กับประเภท 2 ตัว';
    });

    $$('[data-helper]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.helper;
      const value = numberInput.value.trim();
      const amount = currentAmount();
      const digits = requiredDigits();
      if (!isValidAmount(amount)) {
        errorNode.textContent = 'จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ';
        return;
      }

      let generated = [];
      if (action === 'reverse' || action === 'permute') {
        if (!new RegExp(`^\\d{${digits}}$`).test(value)) {
          errorNode.textContent = `กรอกเลข ${digits} หลักก่อนใช้ตัวช่วยนี้`;
          return;
        }
        generated = action === 'reverse' ? [value.split('').reverse().join('')] : permutations(value);
      } else {
        if (digits !== 2) {
          errorNode.textContent = 'รูดหน้า/รูดหลังใช้กับประเภท 2 ตัว';
          return;
        }
        if (!/^\d{1,2}$/.test(value)) {
          errorNode.textContent = 'กรอกอย่างน้อย 1 หลักก่อนใช้รูดหน้า/รูดหลัง';
          return;
        }
        const fixed = action === 'run-front' ? value[0] : value[value.length - 1];
        generated = Array.from({ length: 10 }, (_, index) => action === 'run-front' ? `${fixed}${index}` : `${index}${fixed}`);
      }

      generated = unique(generated);
      errorNode.textContent = '';
      const merged = addNumbers(generated, amount);
      const labels = { reverse: 'กลับเลข', permute: 'สลับเลข', 'run-front': 'รูดหน้า', 'run-back': 'รูดหลัง' };
      helperFeedback.textContent = `${labels[action]}: เพิ่ม ${generated.length} เลข${merged ? ` · รวมเลขซ้ำ ${merged} รายการ` : ''}`;
    }));

    bulkButton?.addEventListener('click', () => {
      const amount = currentAmount();
      const digits = requiredDigits();
      if (!isValidAmount(amount)) {
        errorNode.textContent = 'จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ';
        return;
      }
      const rawTokens = (bulkInput.value || '').split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
      const valid = rawTokens.filter((token) => new RegExp(`^\\d{${digits}}$`).test(token));
      const invalidCount = rawTokens.length - valid.length;
      if (!valid.length) {
        errorNode.textContent = `ไม่พบเลข ${digits} หลักที่เพิ่มได้`;
        return;
      }
      errorNode.textContent = '';
      const merged = addNumbers(valid, amount);
      helperFeedback.textContent = `เพิ่มหลายเลข ${valid.length} รายการ${merged ? ` · รวมเลขซ้ำ ${merged} รายการ` : ''}${invalidCount ? ` · ข้าม ${invalidCount} รายการที่รูปแบบไม่ตรง` : ''}`;
      bulkInput.value = '';
    });

    applyAmountAll?.addEventListener('click', () => {
      const amount = currentAmount();
      if (!isValidAmount(amount)) {
        errorNode.textContent = 'จำนวนเงินขั้นต่ำ 10 บาทต่อรายการ';
        return;
      }
      lines.forEach((line) => { line.amount = amount; });
      render();
      helperFeedback.textContent = `ใช้ ${amount.toLocaleString('th-TH')} บาทกับทุกเลขแล้ว`;
    });

    betType?.dispatchEvent(new Event('change'));
    render();
  }

  function setupQuoteConfirm() {
    const checkbox = $('#quote-accept');
    const button = $('#confirm-bet');
    const timer = $('[data-quote-timer]');
    const failure = $('[data-quote-failure]');
    const demo = $('[data-quote-demo]');
    if (!checkbox || !button || !timer || !failure) return;

    const acceptRow = $('[data-quote-accept-row]');
    const stepStatus = $('[data-quote-step-status]');
    const quoteId = $('[data-quote-id]');
    const payoutMain = $('[data-quote-payout-main]');
    const payoutSecondary = $('[data-quote-payout-secondary]');
    const maxMain = $('[data-quote-max-main]');
    const maxSecondary = $('[data-quote-max-secondary]');
    const validation = $('[data-quote-validation]');
    const cash = $('[data-quote-cash]');
    let seconds = Number(timer.dataset.quoteSeconds || 118);
    let state = 'normal';
    let changedReviewed = false;
    let timerHandle = null;

    const formatTime = (value) => {
      const m = Math.floor(value / 60);
      const s = value % 60;
      return '00:' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    };

    const setConfirmEnabled = (enabled) => {
      button.classList.toggle('disabled', !enabled);
      button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    };

    const sync = () => {
      const canConfirm = state === 'normal' && checkbox.checked;
      setConfirmEnabled(canConfirm);
    };

    const resetAcceptance = () => {
      checkbox.checked = false;
      sync();
    };

    const setDemoActive = (nextState) => {
      $$('.chip-btn', demo || document).forEach((chip) => chip.classList.toggle('active', chip.dataset.quoteState === nextState));
    };

    const restoreBaseQuote = () => {
      payoutMain.textContent = 'x900';
      payoutSecondary.textContent = 'x95';
      maxMain.textContent = '90,000 บาท';
      maxSecondary.textContent = '4,750 บาท';
      cash.textContent = '120.00 บาท';
      validation.className = 'notice success';
      validation.innerHTML = '<b>✓</b><div><strong>ตรวจข้อจำกัดแล้ว</strong>รายการนี้ผ่านข้อจำกัดเลขและวงเงิน ณ เวลาสร้าง Quote</div>';
      acceptRow.hidden = false;
    };

    const showFailure = (kind) => {
      state = kind;
      changedReviewed = false;
      resetAcceptance();
      restoreBaseQuote();
      failure.hidden = false;
      setDemoActive(kind);

      const configs = {
        expired: {
          tone: 'warning', icon: '⌛', title: 'Quote หมดอายุแล้ว',
          copy: 'ข้อเสนอนี้ใช้ยืนยันต่อไม่ได้ กรุณาขอ Quote ใหม่เพื่อให้ระบบตรวจราคา ข้อจำกัด และยอดเงินอีกครั้ง',
          actions: '<button class="button primary" type="button" data-quote-requote>ขอ Quote ใหม่</button><a class="button secondary" href="bet.html">กลับแก้รายการ</a>'
        },
        closed: {
          tone: 'danger', icon: '!', title: 'งวดนี้ปิดรับแล้ว',
          copy: 'ระบบหยุดการยืนยันรายการนี้แล้ว เพราะงวดผ่านเวลาปิดรับ กรุณาเลือกงวดที่ยังเปิดรับ',
          actions: '<a class="button primary" href="buy.html">เลือกงวดใหม่</a>'
        },
        changed: {
          tone: 'warning', icon: '↻', title: 'ข้อเสนอมีการเปลี่ยนแปลง',
          copy: 'อัตราจ่ายเปลี่ยนจาก x900 เป็น x850 และ x95 เป็น x90 ก่อน Confirm คุณต้องตรวจข้อเสนอใหม่และยอมรับอีกครั้ง ระบบจะไม่ยืนยันให้อัตโนมัติ',
          actions: '<button class="button primary" type="button" data-quote-review-change>ตรวจข้อเสนอใหม่</button><a class="button secondary" href="bet.html">กลับแก้รายการ</a>'
        },
        funds: {
          tone: 'warning', icon: '฿', title: 'ยอดเงินไม่เพียงพอ',
          copy: 'ต้องใช้เงิน 150.00 บาท แต่ยอดที่ใช้ได้ขณะนี้เหลือ 95.00 บาท ขาดอีก 55.00 บาท',
          actions: '<a class="button primary" href="deposit.html">เติมเงิน 55.00 บาท</a><a class="button secondary" href="bet.html">ลดจำนวนเงินเดิมพัน</a>'
        },
        eligibility: {
          tone: 'warning', icon: 'i', title: 'ต้องดำเนินการก่อนยืนยัน',
          copy: 'รายการนี้ยังยืนยันไม่ได้เนื่องจากมีข้อกำหนดของบัญชีที่ต้องดำเนินการ ระบบจะบล็อกเฉพาะการซื้อหวย ไม่ล็อกบริการอื่นที่ยังใช้งานได้',
          actions: '<a class="button primary" href="account.html">ดูสิ่งที่ต้องดำเนินการ</a><a class="button secondary" href="bet.html">กลับแก้เลข/รายการ</a>'
        }
      };
      const config = configs[kind];
      failure.className = 'quote-failure quote-failure-' + config.tone;
      failure.innerHTML = '<div class="quote-failure-icon">' + config.icon + '</div><div class="quote-failure-copy"><strong>' + config.title + '</strong><span>' + config.copy + '</span></div><div class="quote-failure-actions">' + config.actions + '</div>';
      acceptRow.hidden = true;
      stepStatus.textContent = kind === 'closed' ? 'งวดปิดแล้ว' : kind === 'expired' ? 'หมดอายุ' : 'ต้องตรวจใหม่';

      if (kind === 'changed') {
        payoutMain.textContent = 'x850';
        payoutSecondary.textContent = 'x90';
        maxMain.textContent = '85,000 บาท';
        maxSecondary.textContent = '4,500 บาท';
        validation.className = 'notice warning';
        validation.innerHTML = '<b>!</b><div><strong>เงื่อนไขใหม่ยังไม่ได้รับการยอมรับ</strong>ตรวจอัตราจ่ายที่อัปเดต แล้วกด “ตรวจข้อเสนอใหม่” ก่อนยืนยัน</div>';
      }
      if (kind === 'funds') cash.textContent = '65.00 บาท';

      $('[data-quote-requote]', failure)?.addEventListener('click', () => activateNormal(true));
      $('[data-quote-review-change]', failure)?.addEventListener('click', () => reviewChangedQuote());
    };

    const activateNormal = (requote = false) => {
      state = 'normal';
      changedReviewed = false;
      failure.hidden = true;
      failure.innerHTML = '';
      restoreBaseQuote();
      resetAcceptance();
      setDemoActive('normal');
      stepStatus.textContent = 'เหลือเวลาจำกัด';
      if (requote) {
        seconds = 120;
        quoteId.textContent = 'Quote #QT-20260910-001843';
      }
      timer.textContent = formatTime(seconds);
    };

    const reviewChangedQuote = () => {
      state = 'normal';
      changedReviewed = true;
      failure.hidden = true;
      failure.innerHTML = '';
      acceptRow.hidden = false;
      payoutMain.textContent = 'x850';
      payoutSecondary.textContent = 'x90';
      maxMain.textContent = '85,000 บาท';
      maxSecondary.textContent = '4,500 บาท';
      validation.className = 'notice info';
      validation.innerHTML = '<b>i</b><div><strong>กำลังใช้ข้อเสนอฉบับใหม่</strong>อัตราจ่ายใหม่ถูกแสดงครบแล้ว กรุณาตรวจเลข ยอดเงิน และอัตราจ่าย แล้วติ๊กยอมรับอีกครั้ง</div>';
      stepStatus.textContent = 'ตรวจข้อเสนอใหม่';
      setDemoActive('changed');
      resetAcceptance();
    };

    checkbox.addEventListener('change', sync);
    button.addEventListener('click', (event) => {
      if (state !== 'normal' || !checkbox.checked) event.preventDefault();
    });

    demo?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-quote-state]');
      if (!target) return;
      const next = target.dataset.quoteState;
      if (next === 'normal') activateNormal(false);
      else showFailure(next);
    });

    timerHandle = window.setInterval(() => {
      if (state !== 'normal') return;
      seconds -= 1;
      if (seconds <= 0) {
        seconds = 0;
        timer.textContent = 'หมดเวลา';
        showFailure('expired');
        return;
      }
      timer.textContent = formatTime(seconds);
    }, 1000);

    const params = new URLSearchParams(window.location.search);
    const initial = params.get('state');
    if (['expired', 'closed', 'changed', 'funds', 'eligibility'].includes(initial)) showFailure(initial);
    else activateNormal(false);
  }

  function setupSlipCancellation() {
    const orderId = 'ORD-20260910-843201';
    const storageKey = 'lottify-mock-cancelled-' + orderId;
    const overlay = $('[data-cancel-overlay]');
    const trigger = $('[data-slip-cancel]');
    const orderStatus = $('[data-order-status]');
    const orderNotice = $('[data-order-notice]');
    const cancelHistory = $('[data-cancel-history]');
    const listRow = $('[data-order-row="' + orderId + '"]');
    const listStatus = $('[data-list-order-status]', listRow || document);
    const listRefund = $('[data-list-refund]', listRow || document);

    const isCancelled = () => {
      try { return window.localStorage.getItem(storageKey) === 'cancelled'; }
      catch (_) { return false; }
    };

    const persistCancelled = () => {
      try { window.localStorage.setItem(storageKey, 'cancelled'); }
      catch (_) {}
    };

    const applyCancelledState = () => {
      if (orderStatus) {
        orderStatus.className = 'status success';
        orderStatus.textContent = 'ยกเลิกแล้ว · คืนเงินแล้ว';
      }
      if (orderNotice) {
        orderNotice.className = 'notice success';
        orderNotice.innerHTML = '<b>✓</b><div><strong>โพยนี้ยกเลิกและคืนเงินแล้ว</strong>ใบรับรายการเดิมยังคงอยู่ และประวัติการยกเลิกถูกเก็บแยกตามลำดับเหตุการณ์</div>';
      }
      if (cancelHistory) cancelHistory.hidden = false;
      if (trigger) {
        trigger.disabled = true;
        trigger.textContent = 'ยกเลิกแล้ว';
      }
      if (listStatus) {
        listStatus.className = 'status neutral';
        listStatus.textContent = 'ยกเลิกแล้ว';
      }
      if (listRefund) listRefund.hidden = false;
    };

    if (isCancelled()) applyCancelledState();
    if (!overlay || !trigger) return;

    const review = $('[data-cancel-review]', overlay);
    const pending = $('[data-cancel-pending]', overlay);
    const success = $('[data-cancel-success]', overlay);
    const confirmButton = $('[data-cancel-confirm]', overlay);
    const doneButton = $('[data-cancel-done]', overlay);

    const show = (node) => {
      [review, pending, success].forEach((item) => { if (item) item.hidden = item !== node; });
    };
    const close = () => {
      overlay.hidden = true;
      document.body.classList.remove('cancel-modal-open');
    };

    trigger.addEventListener('click', () => {
      if (isCancelled()) {
        applyCancelledState();
        return;
      }
      show(review);
      overlay.hidden = false;
      document.body.classList.add('cancel-modal-open');
      confirmButton?.focus();
    });

    $$('[data-cancel-close]', overlay).forEach((button) => button.addEventListener('click', close));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

    confirmButton?.addEventListener('click', () => {
      show(pending);
      if (orderStatus) {
        orderStatus.className = 'status warning';
        orderStatus.textContent = 'กำลังยกเลิก · รอคืนเงิน';
      }
      trigger.disabled = true;
      window.setTimeout(() => {
        persistCancelled();
        applyCancelledState();
        show(success);
      }, 650);
    });

    doneButton?.addEventListener('click', close);
  }

  function setupOtp() {
    const inputs = $$('.otp-grid input');
    if (!inputs.length) return;
    const form = $('[data-onboarding-otp-form]');
    const submit = $('[data-onboarding-otp-submit]');
    const error = $('[data-onboarding-otp-error]');
    const sync = () => {
      const complete = inputs.map((input) => input.value).join('').length === 6;
      if (submit) {
        submit.disabled = !complete;
        submit.classList.toggle('disabled', !complete);
      }
      if (complete && error) error.textContent = '';
    };
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 1);
        if (input.value && inputs[index + 1]) inputs[index + 1].focus();
        sync();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus();
      });
    });
    form?.addEventListener('submit', (event) => {
      const code = inputs.map((input) => input.value).join('');
      if (code.length !== 6) {
        event.preventDefault();
        if (error) error.textContent = 'กรอกรหัส OTP ให้ครบ 6 หลักก่อนดำเนินการต่อ';
        inputs.find((input) => !input.value)?.focus();
        sync();
        return;
      }
      try { window.localStorage.setItem('lottify-onboarding-phone', 'verified'); } catch (_) {}
    });
    sync();
  }

  function setupSecuritySelfService() {
    const overlay = $('[data-security-overlay]');
    if (!overlay) return;

    const review = $('[data-security-review]', overlay);
    const verify = $('[data-security-verify]', overlay);
    const success = $('[data-security-success]', overlay);
    const title = $('[data-security-title]', overlay);
    const copy = $('[data-security-copy]', overlay);
    const noteCopy = $('[data-security-note-copy]', overlay);
    const startButton = $('[data-security-start]', overlay);
    const verifyButton = $('[data-security-verify-button]', overlay);
    const error = $('[data-security-error]', overlay);
    const successTitle = $('[data-security-success-title]', overlay);
    const successCopy = $('[data-security-success-copy]', overlay);
    const reference = $('[data-security-reference]', overlay);
    const sessionCount = $('#session-count');
    let active = null;

    const configs = {
      revoke: (trigger) => ({
        title: 'ออกจากระบบ ' + trigger.dataset.device + '?',
        copy: 'อุปกรณ์นี้จะใช้เซสชันเดิมต่อไม่ได้ และต้องเข้าสู่ระบบใหม่หากต้องการใช้งานอีกครั้ง',
        note: 'เพื่อป้องกันการออกจากระบบโดยไม่ตั้งใจ ระบบจะขอ OTP ก่อนดำเนินการ',
        startLabel: 'ส่ง OTP เพื่อยืนยัน',
        requiresVerification: true,
        successTitle: 'ออกจากระบบอุปกรณ์แล้ว',
        successCopy: trigger.dataset.device + ' ถูกยกเลิกเซสชันเรียบร้อยแล้ว',
      }),
      'logout-all': () => ({
        title: 'ออกจากระบบทุกอุปกรณ์?',
        copy: 'เซสชันทั้งหมดรวมถึงอุปกรณ์นี้จะถูกยกเลิก หลังดำเนินการคุณต้องเข้าสู่ระบบใหม่',
        note: 'รายการนี้กระทบทุกอุปกรณ์ ระบบจะขอ OTP ก่อนดำเนินการ',
        startLabel: 'ส่ง OTP เพื่อยืนยัน',
        requiresVerification: true,
        successTitle: 'ออกจากระบบทุกอุปกรณ์แล้ว',
        successCopy: 'เซสชันทั้งหมดถูกยกเลิกแล้ว กรุณาเข้าสู่ระบบใหม่เมื่อต้องการใช้งาน',
      }),
      recovery: () => ({
        title: 'เริ่มคำขอกู้คืนบัญชี?',
        copy: 'ใช้กรณีที่คุณเข้าถึงช่องทางเดิมไม่ได้ ระบบจะบันทึกคำขอและแจ้งข้อมูลหรือหลักฐานที่ต้องใช้ในขั้นตอนถัดไป',
        note: 'การยืนยันเบอร์ใหม่เพียงอย่างเดียวไม่ถือว่ากู้คืนสำเร็จ และระบบจะไม่เปลี่ยนข้อมูลสำคัญจนกว่าการตรวจสอบจะเสร็จ',
        startLabel: 'เริ่มคำขอ',
        requiresVerification: false,
        successTitle: 'สร้างคำขอกู้คืนแล้ว',
        successCopy: 'เก็บเลขอ้างอิงนี้ไว้เพื่อตรวจสถานะหรือใช้เมื่อติดต่อเจ้าหน้าที่',
      }),
    };

    const showState = (node) => {
      [review, verify, success].forEach((item) => { item.hidden = item !== node; });
    };

    const updateSessionCount = () => {
      if (!sessionCount) return;
      const count = $('[data-device-row]').length;
      sessionCount.textContent = count + ' เซสชัน';
      sessionCount.classList.toggle('success', count > 0);
      sessionCount.classList.toggle('neutral', count === 0);
    };

    const close = () => {
      overlay.hidden = true;
      document.body.classList.remove('security-modal-open');
      active = null;
      error.textContent = '';
    };

    const complete = () => {
      if (!active) return;
      const action = active.action;
      const trigger = active.trigger;
      const config = active.config;
      reference.hidden = true;
      reference.innerHTML = '';

      if (action === 'revoke') {
        const row = document.querySelector('[data-device-row="' + trigger.dataset.deviceId + '"]');
        row?.remove();
        if (trigger.dataset.deviceId === 'android') $('.security-device-alert')?.remove();
        updateSessionCount();
      }

      if (action === 'logout-all') {
        const list = $('[data-device-list]');
        if (list) list.innerHTML = '<div class="notice success"><b>✓</b><div><strong>ออกจากระบบทุกอุปกรณ์แล้ว</strong>เซสชันทั้งหมดถูกยกเลิก กรุณาเข้าสู่ระบบใหม่</div></div>';
        $('.security-device-alert')?.remove();
        updateSessionCount();
      }

      if (action === 'recovery') {
        reference.hidden = false;
        reference.innerHTML = '<strong>เลขอ้างอิง REC-20260910-001</strong>สถานะ: รับคำขอแล้ว · รอขั้นตอนตรวจสอบถัดไป';
      }

      successTitle.textContent = config.successTitle;
      successCopy.textContent = config.successCopy;
      const done = $('[data-security-done]', overlay);
      done.textContent = action === 'logout-all' ? 'ไปหน้าเข้าสู่ระบบ' : 'เสร็จสิ้น';
      showState(success);
    };

    const open = (trigger) => {
      const action = trigger.dataset.securityAction;
      const configFactory = configs[action];
      if (!configFactory) return;
      const config = configFactory(trigger);
      active = { action, trigger, config };
      title.textContent = config.title;
      copy.textContent = config.copy;
      noteCopy.textContent = config.note;
      startButton.textContent = config.startLabel;
      reference.hidden = true;
      error.textContent = '';
      showState(review);
      overlay.hidden = false;
      document.body.classList.add('security-modal-open');
      startButton.focus();
    };

    $$('[data-security-action]').forEach((trigger) => {
      trigger.addEventListener('click', () => open(trigger));
    });

    $$('[data-security-close]', overlay).forEach((button) => button.addEventListener('click', close));
    $('[data-security-back]', overlay)?.addEventListener('click', () => showState(review));

    startButton.addEventListener('click', () => {
      if (!active) return;
      if (!active.config.requiresVerification) {
        complete();
        return;
      }
      $$('[data-security-otp] input', overlay).forEach((input) => { input.value = ''; });
      error.textContent = '';
      showState(verify);
      $('[data-security-otp] input', overlay)?.focus();
    });

    verifyButton.addEventListener('click', () => {
      const code = $$('[data-security-otp] input', overlay).map((input) => input.value).join('');
      if (code.length !== 6) {
        error.textContent = 'กรอกรหัส OTP ให้ครบ 6 หลัก';
        return;
      }
      error.textContent = '';
      complete();
    });

    $('[data-security-done]', overlay)?.addEventListener('click', () => {
      if (active?.action === 'logout-all') {
        window.location.href = 'login.html';
        return;
      }
      close();
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !overlay.hidden) close();
    });
  }

  function setupReferral() {
    const linkInput = $('[data-referral-link]');
    const copyButton = $('[data-referral-copy]');
    const shareButton = $('[data-referral-share]');
    const feedback = $('[data-referral-feedback]');

    const copyReferral = async () => {
      if (!linkInput) return false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(linkInput.value);
        } else {
          linkInput.select();
          document.execCommand('copy');
          window.getSelection()?.removeAllRanges();
        }
        if (feedback) feedback.innerHTML = '<strong>คัดลอกลิงก์แล้ว</strong> ส่งให้เพื่อนได้ทันที';
        return true;
      } catch (_) {
        if (feedback) feedback.innerHTML = '<strong>คัดลอกอัตโนมัติไม่ได้</strong> แตะช่องลิงก์ค้างไว้เพื่อคัดลอก';
        return false;
      }
    };

    copyButton?.addEventListener('click', copyReferral);
    shareButton?.addEventListener('click', async () => {
      if (!linkInput) return;
      if (navigator.share) {
        try {
          await navigator.share({ title: 'สมัครสมาชิก Lottify', text: 'สมัครผ่านลิงก์แนะนำของฉัน', url: linkInput.value });
          if (feedback) feedback.innerHTML = '<strong>เปิดเมนูแชร์แล้ว</strong> เลือกแอปที่ต้องการส่งลิงก์';
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      await copyReferral();
    });

    const registerNotice = $('[data-referral-register]');
    if (registerNotice) {
      const params = new URLSearchParams(window.location.search);
      const code = (params.get('ref') || '').trim().slice(0, 32);
      if (code) {
        registerNotice.hidden = false;
        const codeNode = $('[data-referral-register-code]', registerNotice);
        if (codeNode) codeNode.textContent = 'รหัสแนะนำ: ' + code;
        const form = $('form', document);
        if (form) form.action = 'otp.html?ref=' + encodeURIComponent(code);
      }
    }
  }

  function setupMemberProfile() {
    const storageKey = 'lottify-member-profile';
    const defaults = { name: 'คุณ สมาชิก', birthdate: '1990-01-01', province: 'กรุงเทพมหานคร' };
    let profile = defaults;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) profile = { ...defaults, ...JSON.parse(stored) };
    } catch (_) {}

    $$('[data-member-display-name]').forEach((node) => { node.textContent = profile.name; });
    $$('.member-chip strong').forEach((node) => { node.textContent = profile.name; });

    const form = $('[data-member-profile-form]');
    if (!form) return;
    const nameInput = $('[data-member-name-input]', form);
    const birthdateInput = $('[data-member-birthdate-input]', form);
    const provinceInput = $('[data-member-province-input]', form);
    const success = $('[data-member-profile-success]', form);

    nameInput.value = profile.name;
    birthdateInput.value = profile.birthdate;
    provinceInput.value = profile.province;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name || !birthdateInput.value || !provinceInput.value) {
        success.hidden = false;
        success.classList.remove('success');
        success.classList.add('warning');
        success.innerHTML = '<b>!</b><div><strong>กรอกข้อมูลให้ครบ</strong>ชื่อ วันเกิด และจังหวัดเป็นข้อมูลพื้นฐานที่จำเป็น</div>';
        return;
      }
      profile = { name, birthdate: birthdateInput.value, province: provinceInput.value };
      try { window.localStorage.setItem(storageKey, JSON.stringify(profile)); } catch (_) {}
      success.hidden = false;
      success.classList.remove('warning');
      success.classList.add('success');
      success.innerHTML = '<b>✓</b><div><strong>บันทึกข้อมูลแล้ว</strong>ข้อมูลสมาชิกใน mockup ถูกอัปเดตแล้ว</div>';
      $$('.member-chip strong').forEach((node) => { node.textContent = profile.name; });
    });
  }


  function setupOnboardingFlow() {
    const params = new URLSearchParams(window.location.search);
    const referralCode = params.get('ref');
    const from = params.get('from');
    const withReferral = (target) => {
      if (!referralCode) return target;
      const url = new URL(target, window.location.href);
      url.searchParams.set('ref', referralCode);
      return url.pathname.split('/').pop() + url.search;
    };

    $$('[data-preserve-ref]').forEach((form) => {
      if (referralCode && form.tagName === 'FORM') form.action = withReferral(form.getAttribute('action'));
    });

    const termsForm = $('[data-terms-form]');
    if (termsForm) {
      const checkbox = $('[data-terms-accept]', termsForm);
      const submit = $('[data-terms-submit]', termsForm);
      const error = $('[data-terms-error]', termsForm);
      if (from === 'account') checkbox.checked = true;
      let phoneVerified = from === 'account';
      try { phoneVerified = phoneVerified || window.localStorage.getItem('lottify-onboarding-phone') === 'verified'; } catch (_) {}

      const sync = () => {
        const accepted = checkbox.checked && phoneVerified;
        checkbox.disabled = !phoneVerified;
        submit.classList.toggle('disabled', !accepted);
        submit.disabled = !accepted;
        if (!phoneVerified) error.innerHTML = 'ยืนยันเบอร์โทรด้วย OTP ก่อนยอมรับข้อตกลง · <a class="text-link" href="register.html">กลับไปเริ่มสมัคร</a>';
        if (accepted) error.textContent = '';
      };
      checkbox.addEventListener('change', sync);
      termsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!phoneVerified || !checkbox.checked) {
          error.textContent = 'ต้องยอมรับข้อตกลงที่มีผลก่อนดำเนินการต่อ';
          sync();
          return;
        }
        try { window.localStorage.setItem('lottify-onboarding-terms', 'accepted'); } catch (_) {}
        window.location.href = from === 'account' ? 'account.html' : withReferral('profile.html');
      });
      if (from === 'account') submit.textContent = 'บันทึกและกลับบัญชี →';
      sync();
    }

    const profileForm = $('[data-onboarding-profile-form]');
    if (profileForm) {
      const nameInput = $('[data-onboarding-name]', profileForm);
      const birthdateInput = $('[data-onboarding-birthdate]', profileForm);
      const provinceInput = $('[data-onboarding-province]', profileForm);
      const error = $('[data-onboarding-profile-error]', profileForm);
      try {
        const stored = JSON.parse(window.localStorage.getItem('lottify-member-profile') || 'null');
        if (stored) {
          nameInput.value = stored.name || nameInput.value;
          birthdateInput.value = stored.birthdate || birthdateInput.value;
          provinceInput.value = stored.province || provinceInput.value;
        }
      } catch (_) {}

      profileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        let termsAccepted = false;
        try { termsAccepted = window.localStorage.getItem('lottify-onboarding-terms') === 'accepted'; } catch (_) {}
        if (!termsAccepted) {
          error.innerHTML = 'ต้องยอมรับข้อตกลงที่มีผลก่อนกรอกข้อมูลขั้นตอนนี้ · <a class="text-link" href="terms.html">ไปที่ข้อตกลง</a>';
          return;
        }
        const profile = {
          name: nameInput.value.trim(),
          birthdate: birthdateInput.value,
          province: provinceInput.value,
        };
        if (!profile.name || !profile.birthdate || !profile.province) {
          error.textContent = 'กรอกข้อมูลที่ระบบแสดงว่าเป็นข้อมูลจำเป็นให้ครบก่อนประเมินความพร้อม';
          return;
        }
        error.textContent = '';
        try {
          window.localStorage.setItem('lottify-member-profile', JSON.stringify(profile));
          window.localStorage.setItem('lottify-onboarding-profile', 'complete');
        } catch (_) {}
        window.location.href = withReferral('eligibility.html');
      });
    }

    const eligibilityPage = $('[data-eligibility-page]');
    if (eligibilityPage) {
      const states = { phone: false, terms: false, profile: false };
      try {
        states.phone = window.localStorage.getItem('lottify-onboarding-phone') === 'verified';
        states.terms = window.localStorage.getItem('lottify-onboarding-terms') === 'accepted';
        states.profile = window.localStorage.getItem('lottify-onboarding-profile') === 'complete';
      } catch (_) {}
      Object.entries(states).forEach(([key, complete]) => {
        const row = $('[data-readiness="' + key + '"]', eligibilityPage);
        if (!row) return;
        const icon = $('[data-readiness-icon]', row);
        const status = $('[data-readiness-status]', row);
        icon.textContent = complete ? '✓' : '!';
        icon.className = 'readiness-icon ' + (complete ? 'success' : 'warning');
        status.textContent = complete ? 'ครบแล้ว' : 'ยังไม่ครบ';
        status.className = 'status ' + (complete ? 'success' : 'warning');
      });

      const foundationReady = states.phone && states.terms && states.profile;
      const firstMissing = !states.phone ? { href: 'register.html', label: 'ยืนยันเบอร์โทร →' } : !states.terms ? { href: 'terms.html', label: 'ยอมรับข้อตกลง →' } : { href: 'profile.html', label: 'กรอกข้อมูลที่จำเป็น →' };
      ['bet', 'deposit', 'withdraw'].forEach((key) => {
        const card = $('[data-capability="' + key + '"]', eligibilityPage);
        if (!card || foundationReady) return;
        const status = $('[data-capability-status]', card);
        const copy = $('[data-capability-copy]', card);
        const action = $('[data-capability-action]', card);
        card.classList.add('warning');
        status.textContent = 'ยังไม่พร้อม';
        status.className = 'status warning';
        copy.textContent = 'ขั้นตอน onboarding ที่จำเป็นยังไม่ครบ จึงยังประเมิน capability นี้เป็นพร้อมใช้งานไม่ได้';
        action.href = firstMissing.href;
        action.textContent = firstMissing.label;
      });

      if (foundationReady) {
        const withdrawCard = $('[data-capability="withdraw"]', eligibilityPage);
        const status = $('[data-capability-status]', withdrawCard);
        const copy = $('[data-capability-copy]', withdrawCard);
        const action = $('[data-capability-action]', withdrawCard);
        let kycState = 'required';
        try { kycState = window.localStorage.getItem('lottify-kyc-status') || 'required'; } catch (_) {}
        if (kycState === 'verified') {
          withdrawCard.classList.remove('warning');
          status.textContent = 'ใช้งานได้';
          status.className = 'status success';
          copy.textContent = 'KYC ปัจจุบันยืนยันแล้ว โดยระบบยังต้องประเมิน Withdrawal eligibility และ verification freshness ซ้ำตอนทำรายการ';
          action.href = 'withdraw.html';
          action.textContent = 'ไปถอนเงิน →';
        } else {
          withdrawCard.classList.add('warning');
          status.textContent = kycState === 'rejected' ? 'ยังไม่ผ่าน' : 'มีเงื่อนไข';
          status.className = 'status ' + (kycState === 'rejected' ? 'danger' : 'warning');
          copy.textContent = kycState === 'rejected'
            ? 'ผล KYC ล่าสุดไม่ผ่าน บริการถอนเงินยังใช้ไม่ได้จนกว่าจะมีผลใหม่ตาม policy; ซื้อหวยและฝากเงินยังประเมินแยกกัน'
            : 'ตัวอย่างปัจจุบันต้องยืนยันตัวตนสำหรับการถอน การขาด KYC ไม่บล็อกการซื้อหวยหรือฝากเงินโดยอัตโนมัติ';
          action.href = 'kyc.html';
          action.textContent = 'ดูสถานะ KYC →';
        }
      }
    }
  }

  function setupAccountVerificationSummary() {
    const kycStatus = $('[data-account-kyc-status]');
    const kycCopy = $('[data-account-kyc-copy]');
    if (kycStatus && kycCopy) {
      let state = 'required';
      try { state = window.localStorage.getItem('lottify-kyc-status') || 'required'; } catch (_) {}
      const states = {
        required: ['ต้องดำเนินการ', 'warning', 'จำเป็นก่อนถอนเงินครั้งแรก'],
        submitted: ['ส่งข้อมูลแล้ว', 'info', 'รับข้อมูลแล้ว · รอผล authoritative'],
        review: ['กำลังตรวจสอบ', 'warning', 'Verification Case อยู่ระหว่างตรวจสอบ'],
        more_info: ['ต้องเพิ่มข้อมูล', 'warning', 'ต้องส่งข้อมูลเพิ่มเติมก่อนประเมินต่อ'],
        rejected: ['ไม่ผ่าน', 'danger', 'ผล KYC ล่าสุดไม่ผ่าน · บริการที่ต้องใช้ KYC ยังถูกจำกัด'],
        verified: ['ยืนยันแล้ว', 'success', 'KYC ยืนยันแล้ว · ระบบยังประเมิน eligibility ตามรายการ'],
      };
      const config = states[state] || states.required;
      kycStatus.textContent = config[0];
      kycStatus.className = 'status ' + config[1];
      kycCopy.textContent = config[2];
    }

    const bankCopy = $('[data-account-bank-copy]');
    if (bankCopy) {
      try {
        const stored = JSON.parse(window.localStorage.getItem('lottify-bank-destination') || 'null');
        if (stored?.bank && stored?.account) bankCopy.textContent = stored.bank + ' ••••' + stored.account.slice(-4) + ' · ยืนยันแล้ว';
      } catch (_) {}
    }
  }

  function setupSearch() {
    const input = $('.search');
    if (!input) return;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && input.value.trim()) {
        window.alert(`Mockup: ค้นหา “${input.value.trim()}”`);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderShell();
    setActiveNavigation();
    setupCountdowns();
    setupTabs();
    setupAmountChips();
    setupMethods();
    setupBetBuilder();
    setupQuoteConfirm();
    setupSlipCancellation();
    setupOtp();
    setupSecuritySelfService();
    setupReferral();
    setupOnboardingFlow();
    setupMemberProfile();
    setupAccountVerificationSummary();
    setupSearch();
  });
})();
