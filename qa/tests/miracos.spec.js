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

  test('نص عامود ونص قاعدة ونص تاج = نص مساحة العامود', async ({ page }) => {
    const t = await totals(page, [
      { type: 'نص عامود', rows: [{ l: 0.3, w: 2.5, count: 2 }] },
      { type: 'نص قاعدة', rows: [{ l: 0.5, w: 0.25 }] },
      { type: 'نص تاج', rows: [{ l: 0.5, w: 0.3 }] },
    ]);
    expect(t['نص عامود']).toBeCloseTo(0.3 * 3.14 * 2.5 / 2 * 2, 9);
    expect(t['نص قاعدة']).toBeCloseTo(0.5 * 3.14 * 0.25 / 2, 9);
    expect(t['نص تاج']).toBeCloseTo(0.5 * 3.14 * 0.3 / 2, 9);
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

test('ورقة قياس فاضية: متر مربع، 30 سطر، النتيجة فاضية، وبتطلع ورقة A4 وحدة', async ({ page }) => {
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => window.printBlankMeasSheet())]);
  await pop.waitForLoadState();
  expect(await pop.locator('tbody tr').count()).toBe(30);
  expect(await pop.locator('thead').innerText()).toContain('النتيجة (م²)');
  expect((await pop.locator('tbody').innerText()).replace(/[\s\d]/g, '')).toBe('');
  await pop.emulateMedia({ media: 'print' });
  const pdf = await pop.pdf({ preferCSSPageSize: true, printBackground: true, path: process.env.SHEET_PDF || undefined });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBe(1);
});

test('ورقة قياس فاضية متر طول: بلا عمود العرض، 30 سطر، ورقة وحدة', async ({ page }) => {
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => window.printBlankMeasSheet('ml'))]);
  await pop.waitForLoadState();
  const head = await pop.locator('thead').innerText();
  expect(head).toContain('النتيجة (م.ط)');
  expect(head).not.toContain('العرض');
  expect(await pop.locator('tbody tr').count()).toBe(30);
  expect(await pop.locator('tbody tr').first().locator('td').count()).toBe(5);
  await pop.emulateMedia({ media: 'print' });
  const pdf = await pop.pdf({ preferCSSPageSize: true, printBackground: true, path: process.env.SHEET_PDF || undefined });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(1);
});

test('حاسبة القياسات: الجداول تحت أزرار الحفظ، والإجمالي بس للجداول الموجودة', async ({ page }) => {
  const r = await page.evaluate(() => {
    const bar = document.getElementById('measActionsBar'), wrap = document.getElementById('measTablesWrap');
    const after = !!(bar.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING);
    const el = document.createElement('div');
    renderMeasTotals([{ type: 'مربع', rows: [{ l: '2', w: '1.5', count: '1' }] }], el);
    const one = el.innerText;
    renderMeasTotals([{ type: 'مربع', rows: [] }, { type: 'طول', rows: [] }], el);
    const two = el.innerText;
    renderMeasTotals([], el);
    return { after, one, two, none: el.innerText.trim(), hidden: el.style.display };
  });
  expect(r.after).toBe(true);
  expect(r.one).toContain('إجمالي متر مربع');
  expect(r.one).not.toContain('متر طول');
  expect(r.one).not.toContain('مكعب');
  expect(r.two).toContain('متر طول');
  expect(r.two).not.toContain('مكعب');
  expect(r.none).toBe('');
  expect(r.hidden).toBe('none');
});

// ---- الطباعة: لا ورقة تانية فاضية ولا «الباقي» لحاله (حتى لو المتصفح ما بعت حدث beforeprint متل سفاري الآيفون) ----
const pdfPages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const fakeRcp = n => ({ id:'pp'+n, no:300+n, name:'زبون تجريبي', phone:'+213 550 12 34 56', address:'دالي ابراهيم', date:'2026-10-16', duration:15,
  items:Array.from({length:n},(_,i)=>({qty:2,desc:'رخام كرارا '+(i+1),price:1500,amount:3000})), total:3000*n, discount:0, remaining:3000*n-1000,
  payments:[{id:'pm',date:'2026-10-16',amount:1000}] });
for (const [n, pages] of [[1,1],[18,1],[20,1],[21,2],[35,2]]) {
  test(`طباعة وصل فيه ${n} بند = ${pages} ورقة، والمجموع والباقي ما بينقسموا`, async ({ page }) => {
    await page.evaluate(r => { receipts.push(r); viewReceipt(r.id); }, fakeRcp(n));
    await page.waitForTimeout(150);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdfPages(pdf)).toBe(pages);
    // صندوق المجموع بكامله على نفس الورقة (ما بينكسر بالنص)
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#receiptPrintArea .totals-box')).breakInside)).toBe('avoid');
  });
}

test.describe('الزبائن والفواتير على الجوال والكمبيوتر', () => {
  for (const [w, h] of [[1366, 800], [390, 844], [360, 740]]) {
    test(`بلا تحريك يمين/يسار بعرض ${w}، وكل المعلومات والأزرار موجودة، والهاتف ما بينقلب`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const out = await page.evaluate(() => {
        document.getElementById('loginScreen').style.display = 'none';
        for (let i = 1; i <= 3; i++) receipts.push({ id:'c'+i, no:400+i, name:'عبد الرحمن بن محمد الجزائري '+i, phone:'+213 550 12 34 5'+i, date:'2026-10-01', duration:20,
          items:[{qty:2,desc:'نافورة رخام بيج مع حوض دائري قطر 120 سم وتفاصيل نحت',price:150000,amount:300000}], total:300000, discount:0, remaining:200000, payments:[] });
        invoices.push({ id:'ci', docType:'devis', no:'D9', date:'2026-10-01', clientName:'زبون فاتورة', clientPhone:'0661 22 33 44', items:[], ttc:500000, remaining:500000, payments:[] });
        document.querySelector('.nav-item[data-view="customers"]').click(); renderReceiptsTable(); renderInvoicesTable();
        const w = document.getElementById('receiptsTableWrap'), iw = document.getElementById('invoicesTableWrap');
        const ph = w.querySelector('bdi.ph');
        return { rcp: w.scrollWidth - w.clientWidth, inv: iw.scrollWidth - iw.clientWidth, page: document.documentElement.scrollWidth - innerWidth,
          text: w.innerText, buttons: w.querySelectorAll('.row-actions button').length, phDir: ph && getComputedStyle(ph).direction, phText: ph && ph.textContent };
      });
      expect(out.rcp).toBeLessThanOrEqual(1); expect(out.inv).toBeLessThanOrEqual(1); expect(out.page).toBeLessThanOrEqual(1);
      for (const t of ['403', '300.000 دج', '200.000 دج']) expect(out.text).toContain(t);
      expect(out.buttons).toBeGreaterThanOrEqual(12);
      expect(out.phDir).toBe('ltr'); expect(out.phText).toBe('+213 550 12 34 53');
    });
  }
});

// ---- صورة المنتج بالوصل وبالطلبية (بيانات وهمية، بلا سحابة) ----
test.describe('صورة المنتج', () => {
  // صورة PNG كبيرة (2400×1600) لتجربة الضغط والتصغير
  const bigPng = async page => Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d');
    for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${i * 9},60%,50%)`; x.fillRect(i * 60, 0, 60, 1600); } return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  test('إضافة صورة → بتنحفظ مع الوصل، بتطلع بالورقة ≤ 10×10 سم مع اسم المنتج، والوصل القصير ورقة وحدة', async ({ page }) => {
    await page.evaluate(() => { document.getElementById('loginScreen').style.display = 'none'; openReceiptModal(null);
      document.getElementById('rcpName').value = 'زبون صورة'; const r = document.querySelector('#itemsBody tr');
      r.querySelector('.it-desc').value = 'شمينة رخام بيج 180×120 سم'; r.querySelector('.it-qty').value = 1; r.querySelector('.it-price').value = 250000; recalcTotals(); });
    const btn = page.locator('#receiptOverlay [data-ph-add]');
    await expect(btn).toHaveText(/إضافة صورة/);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
    await chooser.setFiles({ name: 'p.png', mimeType: 'image/png', buffer: await bigPng(page) });
    await expect(page.locator('#receiptOverlay [data-ph-list] img')).toHaveCount(1);
    // الاسم بينحط تلقائياً من أول بند، وبيقدر يعدّله
    await expect(page.locator('#receiptOverlay [data-ph-cap="0"]')).toHaveValue('شمينة رخام بيج 180×120 سم');
    await page.click('#btnSaveReceipt');
    await expect(page.locator('#receiptOverlay')).not.toHaveClass(/show/);
    const id = await page.evaluate(() => receipts.find(r => r.name === 'زبون صورة').id);
    const saved = await page.evaluate(id => receipts.find(r => r.id === id).productPhotos, id);
    expect(saved.length).toBe(1); expect(saved[0].id).toMatch(/^mirsam_drw_/);
    // الصورة الكبيرة (2400×1600) انضغطت: أقل من 380KB
    expect(await page.evaluate(() => document.querySelector('#receiptOverlay [data-ph-list] img').src.length)).toBeLessThan(380000);
    await page.evaluate(id => viewReceipt(id), id);
    const im = page.locator('#receiptPrintArea .prod-photo-block img');
    await expect(im).toBeVisible();
    await expect(page.locator('#receiptPrintArea .prod-photo-block .cap')).toHaveText('شمينة رخام بيج 180×120 سم');
    await page.emulateMedia({ media: 'print' });
    const box = await im.boundingBox();
    expect(box.width).toBeLessThanOrEqual(378 + 1); expect(box.height).toBeLessThanOrEqual(378 + 1); // 100mm = 378px
    expect(Math.abs(box.width / box.height - 1.5)).toBeLessThan(0.02); // بلا تشويه
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdfPages(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  });
  test('تحويل الوصل لـ Devis وإرساله للمعمل: نفس الصورة (نفس الرقم) بلا نسخة جديدة', async ({ page }) => {
    const out = await page.evaluate(() => {
      const r = { id: 'pr1', no: 501, name: 'زبون', phone: '', date: '2026-10-20', items: [{ qty: 1, desc: 'نافورة', price: 1, amount: 1 }], total: 1, discount: 0, remaining: 1, payments: [],
        productPhotos: [{ id: 'mirsam_drw_x1', caption: 'نافورة 120 سم' }] };
      receipts.push(r);
      const d = docFromReceipt(r); convertDocTo('simple', d);
      return { doc: d.photos, form: [...document.querySelectorAll('#invoiceOverlay [data-ph-list] [data-ph-cap]')].map(t => t.value) };
    });
    expect(out.doc).toEqual([{ id: 'mirsam_drw_x1', caption: 'نافورة 120 سم' }]);
    expect(out.form).toEqual(['نافورة 120 سم']);
  });
});

test('حالات الطلبية الخمسة، وتأخر الاستلام بالأحمر حسب عدد الأيام بالإعدادات، والتسليم بيوقف العلامة', async ({ page }) => {
  const day = 864e5, now = Date.now();
  const r = await page.evaluate(({ day, now }) => {
    settings.pickupLateDays = 5;
    const no = window.__fjobsTest([
      { id: 'a', no: 1, status: 'بدون تنفيذ', at: 1 },
      { id: 'b', no: 2, status: 'قيد التنفيذ', at: 2 },
      { id: 'c', no: 3, status: 'تم التنفيذ', at: 3, doneAt: now - 2 * day },                // خلصت من يومين: مش متأخرة
      { id: 'd', no: 4, status: 'جاهزة للاستلام', at: 4, doneAt: now - 9 * day, notifiedAt: now - 6 * day, cust: { name: 'متأخر' } }, // انبلّغ من 6 أيام: متأخرة
      { id: 'e', no: 5, status: 'تم التسليم', at: 5, doneAt: now - 30 * day, notifiedAt: now - 29 * day, deliveredAt: now - 1 * day }, // انسلّمت: لا
    ]);
    const late = [...document.querySelectorAll('#view-fjobs [data-late="1"]')].length;
    const hd = [...document.querySelectorAll('#view-fjobs [data-sthd]')].map(h => h.textContent.replace(/[^؀-ۿ ]/g, '').trim());
    const opts = [...document.querySelectorAll('#view-fjobs select[data-f] option')].map(o => o.value);
    const panel = document.getElementById('latePickupPanel');
    const st = window.__orderStatus;
    return { late, hd, opts, panelShown: panel.style.display !== 'none', panelText: panel.innerText,
      norm: ['جاهز', 'تم التسليم', 'تم التنفيذ', 'شي غلط'].map(st.normSt) };
  }, { day, now });
  expect(r.hd).toEqual(['بدون تنفيذ', 'قيد التنفيذ', 'تم التنفيذ', 'جاهزة للاستلام', 'تم التسليم']);
  expect(r.late).toBe(1);
  expect(r.panelShown).toBe(true);
  expect(r.panelText).toContain('متأخر');
  expect(r.panelText).toContain('من 6 يوم');
  expect(r.opts).toEqual(expect.arrayContaining(['قيد التنفيذ', 'تم التنفيذ', 'جاهزة للاستلام', 'تم التسليم', 'late']));
  // «تم التسليم» بتضل «تم التسليم» (ما بتنقلب «تم التنفيذ»)، و«جاهز» القديمة = جاهزة للاستلام
  expect(r.norm).toEqual(['جاهزة للاستلام', 'تم التسليم', 'تم التنفيذ', 'بدون تنفيذ']);
});

// ---- تحويل Devis لوصل: الدفعة بتنتقل (ما بتختفي وما بتنحسب مرتين) ----
test.describe('تحويل Devis إلى وصل مع الدفعات', () => {
  const run = (page, paid) => page.evaluate(async paid => {
    document.getElementById('loginScreen').style.display = 'none';
    const inv = { id: 'dv1', docType: 'simple', no: 'S0099', date: '2026-10-01', clientName: 'زبون الدوفي', clientPhone: '0550', clientAddress: '',
      items: [{ qty: 1, desc: 'نافورة رخام', unit: '', price: 100000, amount: 100000 }], ht: 100000, tva: 0, ttc: 100000,
      payments: paid ? [{ id: 'pmD', date: '2026-10-02', amount: paid, method: 'نقدي' }] : [], remaining: 100000 - paid };
    invoices.push(inv);
    if (paid) paymentHistory.push({ id: 'h1', paymentId: 'pmD', loggedAt: '2026-10-02T10:00:00Z', date: '2026-10-02', customerName: 'زبون الدوفي', amount: paid, method: 'نقدي', docType: 'Devis', docNo: 'S0099' });
    const sumAll = () => receipts.reduce((s, r) => s + getReceiptPayments(r).reduce((a, p) => a + Number(p.amount), 0), 0) + invoices.reduce((s, i) => s + (i.payments || []).reduce((a, p) => a + Number(p.amount), 0), 0);
    const before = sumAll();
    window.confirm = () => true;
    convertInvoiceToReceipt('dv1');
    const formRemaining = document.getElementById('paymentsBody').querySelectorAll('tr').length;
    const fromLabel = (document.querySelector('#paymentsBody .pm-from') || {}).textContent || '';
    // ضغط الحفظ مرتين بسرعة
    document.getElementById('btnSaveReceipt').click(); document.getElementById('btnSaveReceipt').click();
    await new Promise(r => setTimeout(r, 400));
    const rcps = receipts.filter(r => r.name === 'زبون الدوفي');
    const r = rcps[0], v = invoices.find(i => i.id === 'dv1');
    // تحويل تاني لنفس الدوفي: ما في دفعات بتنتقل مرة تانية
    convertInvoiceToReceipt('dv1');
    const second = document.getElementById('paymentsBody').querySelectorAll('tr').length;
    document.getElementById('receiptOverlay').classList.remove('show');
    viewInvoice('dv1');
    return { receipts: rcps.length, rPays: getReceiptPayments(r), rRemaining: r.remaining, vPays: v.payments, vMoved: (v.movedPayments || []).map(p => [p.id, p.amount, p.date, p.toReceiptNo]),
      conv: v.convertedTo && v.convertedTo.receiptNo === r.no, before, after: sumAll(), hist: paymentHistory.filter(h => h.paymentId === 'pmD').map(h => [h.docType, h.amount, h.date]),
      formRemaining, fromLabel, second, invView: document.getElementById('invoicePrintArea').innerText };
  }, paid);

  test('دوفي 100,000 عليه دفعة 30,000 → الوصل: الدفعة نفسها والباقي 70,000، والمجموع ما تغيّر', async ({ page }) => {
    const r = await run(page, 30000);
    expect(r.receipts).toBe(1);                       // ضغطتين على الحفظ = وصل واحد
    expect(r.rPays.length).toBe(1);
    expect(r.rPays[0]).toMatchObject({ id: 'pmD', date: '2026-10-02', amount: 30000, method: 'نقدي' });
    expect(r.rRemaining).toBe(70000);
    expect(r.vPays).toEqual([]);                      // ما بتنحسب مرتين
    expect(r.vMoved).toEqual([['pmD', 30000, '2026-10-02', r.vMoved[0][3]]]);
    expect(r.conv).toBe(true);
    expect(r.after).toBe(r.before);                   // مجموع المقبوضات بلوحة التحكم نفسه
    expect(r.hist).toEqual([['وصل', 30000, '2026-10-02']]); // سطر واحد بالسجل، صار يشاور عالوصل
    expect(r.fromLabel).toContain('Devis رقم S0099');
    expect(r.second).toBe(0);                         // التحويل التاني ما بينقل الدفعة مرة تانية
    expect(r.invView).toContain('انتقلت للوصل رقم');
  });
  test('دوفي بلا دفعة → وصل بلا دفعات والباقي 100,000', async ({ page }) => {
    const r = await run(page, 0);
    expect(r.rPays).toEqual([]); expect(r.rRemaining).toBe(100000); expect(r.after).toBe(r.before);
  });
  test('دوفي مدفوع بالكامل → الوصل مدفوع بالكامل والباقي 0', async ({ page }) => {
    const r = await run(page, 100000);
    expect(r.rPays.length).toBe(1); expect(r.rRemaining).toBe(0); expect(r.vPays).toEqual([]); expect(r.after).toBe(r.before);
  });
});

test('تقرير الدفعات المشكوك فيها: بيلقط التكرار الحقيقي والمشتبه، وما بيعدّل أي بيانات', async ({ page }) => {
  const r = await page.evaluate(() => {
    const R = [
      { id: 'r1', no: 10, name: 'أحمد', total: 100000, remaining: 70000, payments: [{ id: 'P1', date: '2026-10-02', amount: 30000 }] },          // نفس P1 على الدوفي كمان
      { id: 'r2', no: 11, name: 'سمير', total: 50000, remaining: 20000, payments: [{ id: 'P2', date: '2026-10-03', amount: 30000 }] },          // تحويل قديم: انعادت كتابتها
      { id: 'r3', no: 12, name: 'كريم', total: 40000, remaining: 0, payments: [{ id: 'P3', date: '2026-10-05', amount: 20000 }, { id: 'P4', date: '2026-10-05', amount: 20000 }] },
      { id: 'r4', no: 13, name: 'نظيف', total: 10000, remaining: 5000, payments: [{ id: 'P5', date: '2026-10-06', amount: 5000 }] },
      { id: 'r5', no: 14, name: 'غلط بالباقي', total: 10000, remaining: 10000, payments: [{ id: 'P6', date: '2026-10-07', amount: 4000 }] },
    ];
    const I = [
      { id: 'i1', docType: 'simple', no: 'S1', clientName: 'أحمد', ttc: 100000, remaining: 70000, payments: [{ id: 'P1', date: '2026-10-02', amount: 30000 }] },
      { id: 'i2', docType: 'simple', no: 'S2', clientName: 'سمير', ttc: 50000, remaining: 20000, convertedTo: { receiptNo: 11 }, payments: [{ id: 'Q2', date: '2026-10-01', amount: 30000 }] },
    ];
    const H = [...R, ...I].flatMap(d => d.payments.map(p => ({ id: 'h' + p.id + d.id, paymentId: p.id, amount: p.amount, date: p.date, customerName: d.name || d.clientName, docType: d.no && d.clientName ? 'Devis' : 'وصل', docNo: d.no })));
    const snap = JSON.stringify([R, I, H]);
    const out = computePaymentAudit(R, I, H);
    return { out, untouched: snap === JSON.stringify([R, I, H]) };
  });
  expect(r.untouched).toBe(true);
  const has = (lvl, name, rx) => r.out.some(x => x.level === lvl && x.name === name && rx.test(x.why));
  expect(has('مؤكد', 'أحمد', /نفس الدفعة/)).toBe(true);
  expect(has('مشتبه', 'سمير', /تحوّل للوصل 11/)).toBe(true);
  expect(has('مشتبه', 'كريم', /نفس المبلغ ونفس التاريخ مرتين/)).toBe(true);
  expect(has('غير مطابق', 'غلط بالباقي', /الباقي المحفوظ/)).toBe(true);
  expect(r.out.some(x => x.name === 'نظيف')).toBe(false);
  // كل سطر فيه الأعمدة المطلوبة
  for (const x of r.out) for (const k of ['ref', 'name', 'devNo', 'rcpNo', 'amount', 'date', 'why']) expect(x).toHaveProperty(k);
  // الواجهة بتفتح وفيها العناوين المطلوبة
  await page.evaluate(() => { receipts.push({ id: 'ux', no: 90, name: 'س', total: 10, remaining: 0, payments: [{ id: 'D', date: '2026-10-01', amount: 10 }] });
    invoices.push({ id: 'uy', docType: 'simple', no: 'S9', clientName: 'س', ttc: 10, remaining: 0, payments: [{ id: 'D', date: '2026-10-01', amount: 10 }] });
    document.getElementById('btnPaymentAudit').click(); });
  const head = await page.locator('#paymentAuditOverlay').innerText();
  for (const t of ['رقم السجل', 'اسم الزبون', 'رقم الدوفي', 'رقم الوصل', 'قيمة الدفعة', 'تاريخ الدفعة', 'سبب الاشتباه', 'قراءة فقط']) expect(head).toContain(t);
});

test.describe('البحث الشامل', () => {
  const seed = page => page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none';
    receipts.push({ id: 'g1', no: 321, name: 'عبد الرحمن بلقاسم', phone: '0550 12 34 56', address: 'الشراقة', date: '2026-10-01', items: [{ qty: 1, desc: 'نافورة موديل F-204 رخام بيج', price: 1, amount: 1 }], total: 1, remaining: 0, payments: [] });
    receipts.push({ id: 'g2', no: 322, name: 'فاطمة الزهراء', phone: '+213 661 00 11 22', address: 'دالي ابراهيم', date: '2026-10-02', items: [{ qty: 1, desc: 'شمينة رخام', price: 1, amount: 1 }], total: 1, remaining: 0, payments: [] });
    invoices.push({ id: 'g3', docType: 'simple', no: 'S0450', date: '2026-10-03', clientName: 'عبدالرحمن بلقاسم', clientPhone: '0550123456', clientAddress: '', items: [{ qty: 1, desc: 'جرن حمام', unit: '', price: 1, amount: 1 }], ttc: 1, remaining: 1, payments: [] });
    priceCategories.push({ id: 'c1', name: 'نوافير' }); priceList.push({ id: 'p1', categoryId: 'c1', type: 'نافورة F-204', measurement: '120 سم', color: 'بيج', price: 90000 });
  });
  const titles = (page, q) => page.evaluate(q => globalSearch(q).map(x => x.type + ':' + x.title), q);

  test('رقم الموديل بيجيب المنتج والوصل المرتبطين فيه', async ({ page }) => {
    await seed(page);
    const r = await titles(page, 'f204');
    expect(r.some(t => t.startsWith('وصل:وصل 321'))).toBe(true);
    expect(r.some(t => t.startsWith('منتج / موديل:'))).toBe(true);
  });
  test('الهاتف بأي كتابة (مسافات، 0 أو 213+، أرقام عربية) بيجيب الوصل والدوفي', async ({ page }) => {
    await seed(page);
    for (const q of ['0550123456', '550 12 34 56', '+213550123456', '٠٥٥٠١٢٣٤٥٦']) {
      const r = await titles(page, q);
      expect(r.some(t => t.includes('وصل 321')), q).toBe(true);
      expect(r.some(t => t.includes('Devis S0450')), q).toBe(true);
    }
    expect((await titles(page, '661001122')).some(t => t.includes('وصل 322'))).toBe(true);
  });
  test('الاسم مع اختلاف المسافات والهمزة، ورقم الدوفي والوصل والعنوان', async ({ page }) => {
    await seed(page);
    const r = await titles(page, 'عبدالرحمن');
    expect(r.some(t => t.includes('وصل 321'))).toBe(true); expect(r.some(t => t.includes('S0450'))).toBe(true);
    expect((await titles(page, 'فاطمه')).some(t => t.includes('وصل 322'))).toBe(true);
    expect((await titles(page, 's0450')).length).toBe(1);
    expect((await titles(page, '٣٢٢')).some(t => t.includes('وصل 322'))).toBe(true);
    expect((await titles(page, 'دالي إبراهيم')).some(t => t.includes('وصل 322'))).toBe(true);
  });
  test('خانة البحث على لوحة التحكم بتعرض النتائج وبتفتح الوصل، وبلا تمرير أفقي على الجوال', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seed(page);
    await page.fill('#globalSearchInput', 'بلقاسم');
    await expect(page.locator('#globalSearchResults [data-gs]')).toHaveCount(2);
    await page.locator('#globalSearchResults [data-gs]').first().click();
    await expect(page.locator('#viewReceiptOverlay.show, #viewInvoiceOverlay.show')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
});

test('لوحة واتساب: بتفرّق بين التواصلات والزبائن (نفس الرقم بأي كتابة = زبون واحد)، وبتقول بوضوح إنها مش من واتساب نفسه', async ({ page }) => {
  test.skip(await page.evaluate(() => FS_DOC === 'factory'), 'المعمل ما بيشوف أرقام الزبائن — اللوحة بالمعرض بس');
  const r = await page.evaluate(() => {
    const today = localDate(), mo = today.slice(0, 7) + '-01' === today ? today : today.slice(0, 7) + '-01';
    const L = [
      { id: 'a', phone: '0550 12 34 56', name: 'أحمد', date: today, at: 3 },
      { id: 'b', phone: '+213550123456', name: 'أحمد', date: today, at: 2 },   // نفس الزبون
      { id: 'c', phone: '0661 00 11 22', name: 'سمير', date: mo, at: 1 },
      { id: 'd', phone: '0770 99 88 77', name: 'قديم', date: '2025-01-05', at: 0 },
    ];
    window.__waTest(L);
    return { st: waStats(L), text: document.getElementById('waPanel').innerText };
  });
  expect(r.st.allContacts).toBe(4); expect(r.st.allCustomers).toBe(3);
  expect(r.st.dayContacts).toBe(r.st.dayCustomers === 1 ? 2 : r.st.dayContacts); expect(r.st.dayCustomers).toBeGreaterThanOrEqual(1);
  expect(r.st.monthCustomers).toBeGreaterThanOrEqual(1);
  expect(r.text).toContain('مش العدد الحقيقي');
  expect(r.text).toContain('3 زبون');
  expect(r.text).toContain('4 تواصل');
});
