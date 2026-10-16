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
  // خلل معروف: لا توجد علامة noindex، والبرنامج منشور على github.io فقد تظهر صفحة الدخول في غوغل
  test.fail(true, 'خلل معروف: علامة noindex ناقصة');
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

  test('العدد صفر لا يُحسب', async ({ page }) => {
    // خلل معروف: كتابة 0 في خانة العدد تُحسب كأنها 1
    test.fail(true, 'خلل معروف: العدد 0 يُحسب 1');
    const t = await totals(page, [{ type: 'مربع', rows: [{ l: 2, w: 2, count: 0 }] }]);
    expect(t['مربع']).toBe(0);
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
