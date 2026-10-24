// اختبارات برنامج ميراكوس: الحسابات (الوصولات، الفواتير، القياسات)، الطباعة، والواجهة.
// الشبكة مقطوعة عمداً: لا اتصال بـ Firebase إطلاقاً، فلا يمكن أن يُكتب أو يُقرأ أي شيء من البيانات الحقيقية.
const { test, expect } = require('@playwright/test');
const { openOffline, scrollbarOnRight, horizontalOverflow } = require('./helpers');

// "7.200,5 دج" ← 7200.5
const num = s => Number(String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));

test.beforeEach(async ({ page }) => {
  const { res, errors } = await openOffline(page, '/');
  expect(res.status()).toBe(200);
  expect(errors, 'أخطاء JavaScript غير متوقعة عند فتح البرنامج').toEqual([]);
});

test('البرنامج يفتح على شاشة الدخول بدون أخطاء', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'دخول' })).toBeVisible();
  await expect(page).toHaveTitle(/إدارة الحسابات/);
});

test('البرنامج غير مفهرس في محركات البحث', async ({ page }) => {
  const robots = await page.$eval('meta[name="robots"]', e => e.content).catch(() => '');
  expect(robots).toMatch(/noindex/i);
});

test.describe('حساب الوصل', () => {
  const run = (page, rows, discount) => page.evaluate(({ rows, discount }) => {
    document.getElementById('itemsBody').innerHTML = rows.map(([q, p]) =>
      `<tr><td><input class="it-qty" value="${q}"></td><td><input class="it-price" value="${p}"></td></tr>`).join('');
    document.getElementById('rcpDiscount').value = discount;
    recalcTotals();
    return {
      total: document.getElementById('itemsTotalDisplay').textContent,
      sub: document.getElementById('itemsSubtotalDisplay').textContent,
    };
  }, { rows, discount });

  test('المجموع مع خصم', async ({ page }) => {
    const r = await run(page, [[2, 1500], [3.5, 1200]], 200);
    expect(num(r.sub)).toBe(7200);
    expect(num(r.total)).toBe(7000);
  });

  test('خصم أكبر من المجموع لا يعطي رقماً سالباً', async ({ page }) => {
    const r = await run(page, [[1, 5000]], 9000);
    expect(num(r.total)).toBe(0);
  });

  test('الأرقام الكبيرة تُكتب بفواصل صحيحة', async ({ page }) => {
    const r = await run(page, [[1, 1234567]], 0);
    expect(r.total).toContain('1.234.567');
  });
});

test.describe('حساب الفاتورة وعرض السعر', () => {
  const run = (page, type, rows, payments) => page.evaluate(({ type, rows, payments }) => {
    document.getElementById('invDocType').value = type;
    document.getElementById('invItemsBody').innerHTML = rows.map(([q, p]) =>
      `<tr><td><input class="inv-it-qty" value="${q}"></td><td><input class="inv-it-price" value="${p}"></td></tr>`).join('');
    document.getElementById('invPaymentsBody').innerHTML = payments.map(a =>
      `<tr><td><input class="inv-pm-amount" value="${a}"></td></tr>`).join('');
    const r = recalcInvoiceTotals();
    return { ...r, remaining: document.getElementById('invRemainingDisplay').textContent };
  }, { type, rows, payments });

  test('فاتورة: الضريبة 19% والباقي بعد الدفعات', async ({ page }) => {
    const r = await run(page, 'facture', [[10, 2500]], [10000]);
    expect(r.ht).toBe(25000);
    expect(r.tva).toBeCloseTo(4750, 6);
    expect(r.ttc).toBeCloseTo(29750, 6);
    expect(r.paid).toBe(10000);
    expect(num(r.remaining)).toBe(19750);
  });

  test('عرض سعر مبسط: بدون ضريبة', async ({ page }) => {
    const r = await run(page, 'simple', [[4, 3000], [1, 500]], []);
    expect(r.ht).toBe(12500);
    expect(r.tva).toBe(0);
    expect(r.ttc).toBe(12500);
  });

  test('دفعات أكثر من المبلغ تظهر كرقم سالب واضح', async ({ page }) => {
    const r = await run(page, 'simple', [[1, 1000]], [1500]);
    expect(num(r.remaining)).toBe(-500);
  });
});

test.describe('حساب القياسات', () => {
  const totals = (page, tables) => page.evaluate(t => computeMeasTotalsFrom(t), tables);

  test('متر مربع وطول ومكعب وعامود', async ({ page }) => {
    const t = await totals(page, [
      { type: 'مربع', rows: [{ l: 2, w: 1.5, count: 2 }, { l: 1, w: 1 }] },
      { type: 'طول', rows: [{ l: 3.25 }] },
      { type: 'مكعب', rows: [{ l: 1, w: 0.5, h: 0.2 }] },
      { type: 'عامود', rows: [{ l: 0.3, w: 2.5 }] },
    ]);
    expect(t['مربع']).toBeCloseTo(7, 9);
    expect(t['طول']).toBeCloseTo(3.25, 9);
    expect(t['مكعب']).toBeCloseTo(0.1, 9);
    expect(t['عامود']).toBeCloseTo(0.3 * 3.14 * 2.5, 9);
  });

  test('الدائرة بالقطر البراني والزاوية الطول × العرض', async ({ page }) => {
    const t = await totals(page, [
      { type: 'دائرة', rows: [{ l: 1.2, w: 0.8 }] },
      { type: 'زاوية', rows: [{ l: 0.4, w: 0.4 }] },
    ]);
    expect(t['دائرة']).toBeCloseTo(1.2, 9);
    expect(t['زاوية']).toBeCloseTo(0.16, 9);
  });

  test('العدد صفر لا يُحسب، والخانة الفارغة تعني قطعة واحدة', async ({ page }) => {
    const t = await totals(page, [{ type: 'مربع', rows: [{ l: 2, w: 2, count: 0 }, { l: 1, w: 1, count: '' }, { l: 1, w: 2, count: '3' }] }]);
    expect(t['مربع']).toBeCloseTo(0 + 1 + 6, 9);
  });

  test('سطر عدده صفر لا يدخل ورقة المعمل', async ({ page }) => {
    const pieces = await page.evaluate(() => calcToFactoryOrder([{ type: 'مربع', rows: [{ l: 2, w: 1, count: 0 }, { l: 1, w: 1, count: 2 }] }], '', '').pieces);
    expect(pieces.length).toBe(1);
    expect(Number(pieces[0].count)).toBe(2);
  });
});

test.describe('عرض الوصل وطباعته (بيانات وهمية في الذاكرة فقط)', () => {
  const FAKE = {
    id: 'qa-test', no: 77, name: 'زبون تجريبي <img src=x onerror="window.__xss=1">', phone: '0550000000',
    date: '2026-10-16', items: [{ qty: 2, desc: 'رخام كرارا', price: 1500, amount: 3000 }],
    total: 3000, discount: 0, remaining: 2000, payments: [{ date: '2026-10-16', amount: 1000 }],
  };
  const open = page => page.evaluate(r => {
    receipts.push(r); viewReceipt(r.id);
    return document.getElementById('viewReceiptOverlay').innerText;
  }, FAKE);

  test('الوصل يعرض البنود والمجموع والدفعات والباقي', async ({ page }) => {
    const text = await open(page);
    expect(text).toContain('رخام كرارا');
    expect(text).toContain('3.000 دج');
    expect(text).toContain('1.000 دج');
    expect(text).toContain('2.000 دج');
  });

  test('اسم الزبون لا يمكن أن يشغّل كوداً (حماية من XSS)', async ({ page }) => {
    const text = await open(page);
    expect(text).toContain('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('طباعة الوصل PDF بحجم A4', async ({ page }) => {
    await open(page);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.length).toBeGreaterThan(20_000);
  });
});

test.describe('على الكمبيوتر', () => {
  test.use({ viewport: { width: 1366, height: 800 } });
  test('شريط التمرير على اليمين', async ({ page }) => {
    expect(await scrollbarOnRight(page)).toBe(true);
  });
});

test.describe('على الجوال', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('لا يوجد تمرير أفقي', async ({ page }) => {
    expect(await horizontalOverflow(page)).toEqual([]);
  });
});

test.describe('الأرقام اللاتينية والأقواس وتأخر السداد', () => {
  test('الأرقام العربية المكتوبة تتحول إلى 0-9 (نص ورقم عشري)', async ({ page }) => {
    await page.evaluate(() => document.querySelectorAll('.view').forEach(v => v.classList.add('active')));
    await page.locator('#customerSearch').focus();
    await page.keyboard.type('هاتف ٠٥٥١٢');
    expect(await page.locator('#customerSearch').inputValue()).toBe('هاتف 05512');
    await page.locator('#rcpDiscount').evaluate(e => e.closest('[class*=overlay]')?.classList.add('show'));
    await page.locator('#rcpDiscount').focus();
    await page.keyboard.type('١٢٫٥');
    expect(await page.locator('#rcpDiscount').inputValue()).toBe('12.5');
  });

  test('البيان يأخذ اتجاهه من أول حرف (الأقواس بمكانها)', async ({ page }) => {
    const dir = await page.evaluate(() => {
      receipts.push({ id: 'bidi', no: 5, name: 'س', date: '2026-10-16', items: [{ qty: 1, desc: 'نافورة (قطر 1.20 م)', price: 1, amount: 1 }], remaining: 0, payments: [] });
      viewReceipt('bidi');
      const td = [...document.querySelectorAll('#viewReceiptOverlay td')].find(t => t.textContent.includes('نافورة'));
      return td && td.getAttribute('dir');
    });
    expect(dir).toBe('auto');
  });

  test('الزبون المستلم وعليه دين: يظهر عدد أيام التأخر، والأكثر تأخراً أولاً', async ({ page }) => {
    const r = await page.evaluate(() => {
      const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      receipts.push({ id: 'a', no: 1, name: 'زبون جديد', delivered: true, deliveredDate: ago(2), total: 100, remaining: 50, items: [], payments: [] });
      receipts.push({ id: 'b', no: 2, name: 'زبون قديم', delivered: true, deliveredDate: ago(30), total: 100, remaining: 80, items: [], payments: [] });
      receipts.push({ id: 'c', no: 3, name: 'زبون مسدد', delivered: true, deliveredDate: ago(40), total: 100, remaining: 0, items: [], payments: [] });
      renderDashboard();
      return [...document.querySelectorAll('#deliveredDueList tbody tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim());
    });
    expect(r.length).toBe(2);
    expect(r[0]).toContain('زبون قديم');
    expect(r[0]).toContain('متأخر 30 يوم');
    expect(r[1]).toContain('متأخر 2 يوم');
  });
});

test('خانات الأرقام والتواريخ لغتها إنكليزية (أرقام 0-9 حتى على متصفح عربي)', async ({ page }) => {
  const notLatn = await page.$$eval('input[type=number],input[type=date]', els => els.filter(e => e.getAttribute('lang') !== 'en').length);
  expect(notLatn).toBe(0);
  const later = await page.evaluate(async () => { const i = document.createElement('input'); i.type = 'number'; document.body.appendChild(i); await new Promise(r => setTimeout(r, 50)); return i.getAttribute('lang'); });
  expect(later).toBe('en');
});

test('الأسماء: العرض المبسط اسمه Devis، والرسمي اسمه Facture proforma (المفاتيح بالبيانات كما هي)', async ({ page }) => {
  expect(await page.$eval('option[value="simple"]', o => o.textContent)).toMatch(/^Devis/);
  expect(await page.$eval('option[value="devis"]', o => o.textContent)).toContain('Facture proforma');
  expect(await page.evaluate(() => [CONV_TARGETS.simple, CONV_TARGETS.devis])).toEqual(['Devis', 'Facture proforma']);
});

test('الطلبيات: الافتراضي «الكل»', async ({ page }) => {
  const sel = page.locator('#view-fjobs select[data-f]');
  await expect(sel).toHaveCount(1);
  expect(await sel.inputValue()).toBe('all');
  expect(await sel.locator('option').first().getAttribute('value')).toBe('all');
});

test('البرنامج بيفتح بنافذة وحدة (ما بيفتح نافذة جديدة كل مرة)', async ({ request }) => {
  const m = await (await request.get('/manifest.json')).json();
  expect(m.launch_handler.client_mode[0]).toBe('focus-existing');
});

test('الطلبيات بالكل مرتّبة: بدون تنفيذ، بعدين قيد التنفيذ، بعدين تم التنفيذ', async ({ page }) => {
  const r = await page.evaluate(() => {
    const no = window.__fjobsTest([
      { id: 'a', no: 1, status: 'تم التنفيذ', at: 5 }, { id: 'b', no: 2, status: 'قيد التنفيذ', at: 4 },
      { id: 'c', no: 3, status: 'بدون تنفيذ', at: 3 }, { id: 'd', no: 4, status: 'قيد التنفيذ', at: 6 }, { id: 'e', no: 5, status: 'بدون تنفيذ', at: 7 },
    ]);
    return { no, hd: [...document.querySelectorAll('#view-fjobs [data-sthd]')].map(h => h.textContent) };
  });
  expect(r.hd.map(t => t.replace(/[^؀-ۿ ]/g, '').trim())).toEqual(['بدون تنفيذ', 'قيد التنفيذ', 'تم التنفيذ']);
  expect(r.no.length).toBe(5);
});

test('المشاركة: نافذة فيها «إرسال على واتساب» و«حفظ الصورة على الجهاز»، والحفظ بينزّل الصورة', async ({ page }) => {
  await page.evaluate(() => {
    receipts.push({ id: 'r1', no: 70, name: 'سفيان', phone: '', address: '', date: '2026-10-15', items: [], discount: 0, total: 0, paid: 0, remaining: 0, payments: [] });
    viewReceipt('r1');
    window.__sharePrep = { kind: 'rcp', id: 'r1', blob: new Blob(['x'], { type: 'image/jpeg' }), promise: Promise.resolve(null) };
  });
  await page.evaluate(() => document.getElementById('btnShareReceipt').click());
  const ov = page.locator('#shareChoiceOverlay');
  await expect(ov.getByText('إرسال على واتساب')).toBeVisible();
  await page.evaluate(() => { window.__saved = []; const o = downloadBlob; window.downloadBlob = (bl, n) => { window.__saved.push(n); return o(bl, n); }; });
  await Promise.all([page.waitForEvent('download'), ov.getByText('حفظ الصورة على الجهاز').click()]);
  expect(await page.evaluate(() => window.__saved)).toEqual(['وصل-70.jpg']);
  await expect(ov).toHaveCount(0);
});

test('التقارير: تقرير الشهر وملخص عام والمصاريف حسب الفئة مطوية افتراضياً', async ({ page }) => {
  for (const id of ['periodReportBox', 'repSummaryBox', 'expByCategoryBox']) {
    const box = page.locator('#' + id);
    await expect(box).toHaveCount(1);
    expect(await box.evaluate(e => e.tagName === 'DETAILS' && !e.open), id).toBe(true);
  }
});

test('التقارير: تقرير شهر / 6 أشهر / سنة يحسب الفترة الصحيحة', async ({ page }) => {
  const r = await page.evaluate(() => {
    const mk = (id, date, total, pay) => ({ id, no: 900, name: 'تجربة', date, items: [{ qty: 1, desc: 'رخام', price: total, amount: total }],
      total, discount: 0, remaining: total - pay, payments: [{ date, amount: pay }] });
    receipts.push(mk('q1', '2026-10-05', 1000, 400), mk('q2', '2026-06-10', 2000, 2000), mk('q3', '2026-02-01', 5000, 1000), mk('q4', '2025-12-20', 9000, 9000));
    expenses.push({ id: 'e1', date: '2026-10-03', amount: 100 }, { id: 'e2', date: '2026-03-03', amount: 50 });
    const box = document.getElementById('periodReportBox'); box.open = true;
    const k = box.querySelector('[data-k]'), m = box.querySelector('[data-m]');
    const read = () => [...box.querySelectorAll('[data-o] > div > div')].map(c => [...c.children].map(x => x.textContent));
    const set = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event('change')); };
    const out = {};
    set(k, 'm'); set(m, '2026-10'); out.m = read();
    set(k, '6'); set(m, '2026-10'); out.six = read();
    set(k, 'y'); out.yv = m.value; set(m, '2026'); out.y = read();
    set(k, 'm'); out.back = m.value;
    return out;
  });
  const val = (rows, label) => num(rows.find(x => x[0].startsWith(label))[1]);
  expect(val(r.m, 'عدد الوصولات')).toBe(1);
  expect(val(r.m, 'المقبوض')).toBe(400);
  expect(val(r.six, 'عدد الوصولات')).toBe(2);       // 05/2026 → 10/2026
  expect(val(r.six, 'مجموع الشغل')).toBe(3000);
  expect(val(r.y, 'عدد الوصولات')).toBe(3);         // سنة 2026 كاملة
  expect(val(r.y, 'المقبوض')).toBe(3400);
  expect(val(r.y, 'المصاريف')).toBe(150);
  expect(r.yv).toBe('2026');
  expect(r.back).toMatch(/^\d{4}-\d{2}$/);
});

test('الطلبيات: فتح الصفحة (من الجرس أو القائمة) بيشيل الرقم الأحمر، و«جديد» بيضل خلال الزيارة', async ({ page }) => {
  const r = await page.evaluate(() => {
    const other = 'xx-other', now = Date.now();
    window.__fjobsTest([
      { id: 'a', no: 1, at: now - 5000, status: 'بدون تنفيذ', upd: { by: other, at: now + 60000, txt: 'تعديل' } }, // ساعة الجهاز التاني متقدمة
      { id: 'b', no: 2, at: now - 4000, status: 'قيد التنفيذ', upd: { by: other, at: now - 1000, txt: 'تعديل' } },
    ]);
    window.__fjobsShow();
    const after = window.__fjobsBadge();
    document.querySelector('.nav-item[data-view="reports"]').click();
    window.__fjobsShow();
    return { after, again: window.__fjobsBadge() };
  });
  expect(r.after.shown).toBe(false);
  expect(r.after.fb).toBe(false);
  expect(r.after.fresh).toBe(2);
  expect(r.again.shown).toBe(false);
  expect(r.again.fresh).toBe(0);
});

test('الأكثر مبيعاً: بيعدّ الكمية المباعة (عدد الجرون) مش عدد الوصولات، والمتر لحاله', async ({ page }) => {
  const list = await page.evaluate(() => tsAggregate([
    { r: { name: 'أ', no: 1, items: [
      { qty: 3, desc: 'جرن رخام 60 سم', amount: 30000 },
      { qty: 2, desc: 'باسان صغير', amount: 10000 },
      { qty: 25.5, desc: 'تغليف واجهة حجر', amount: 50000 },
      { qty: 1, desc: 'خصم', amount: -5000 } ] }, d: null },
    { r: { name: 'ب', no: 2, items: [
      { qty: '4', desc: 'جرن مربع', amount: 40000 },
      { qty: 12, desc: 'كورنيش', unit: 'ml', amount: 12000 },
      { qty: 2, desc: 'كورنيش زاوية', unit: 'Pièce', amount: 4000 },
      { qty: 10, desc: 'بلاط رخام', measType: 'مربع', amount: 9000 },
      { qty: 1, desc: 'نقل', amount: 3000 } ] }, d: null },
  ]).map(s => [s.name, tsQtyText(s), s.sales.length]));
  const get = n => list.find(x => x[0] === n);
  expect(get('جرن')).toEqual(['جرن', '9 قطعة', 2]);        // 3 + 2 + 4 جرون، مش 2 وصل
  expect(get('واجهة')[1]).toBe('25.5 م²');
  expect(get('كورنيش')[1]).toBe('2 قطعة + 12 م.ط');
  expect(get('أرضية')[1]).toBe('10 م²');
  expect(get('نقل')[1]).toBe('1 قطعة');                   // حتى البنود بلا قسم بتنحسب
  expect(list[0][0]).toBe('جرن');
  expect(list.some(x => x[0] === 'خصم')).toBe(false);
});
