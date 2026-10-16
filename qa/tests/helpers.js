// أدوات مشتركة للاختبارات.
// القاعدة الأهم: الاختبارات لا تتصل بأي شيء خارج الجهاز (لا Firebase ولا Google ولا غيره)،
// حتى لا تلمس البيانات الحقيقية أبداً. كل طلب لغير الخادم المحلي يُلغى.

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

// أخطاء متوقعة لأن الشبكة مقطوعة عمداً أثناء الاختبار
const EXPECTED_OFFLINE_ERRORS = [
  /firebase is not defined/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /net::ERR_/i,
  /Load failed/i,
];

async function openOffline(page, url) {
  await page.route(u => !LOCAL.test(u.href), route => route.abort());
  const errors = [];
  page.on('pageerror', e => {
    if (!EXPECTED_OFFLINE_ERRORS.some(rx => rx.test(e.message))) errors.push(e.message);
  });
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { res, errors };
}

// شريط التمرير على اليمين بالكمبيوتر = اتجاه الصفحة الجذرية ltr مع بقاء المحتوى rtl
async function scrollbarOnRight(page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).direction === 'ltr' &&
    getComputedStyle(document.body).direction === 'rtl');
}

// العناصر التي تخرج عن عرض الشاشة وتسبب تمريراً أفقياً على الجوال
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= W + 1) return [];
    return [...document.querySelectorAll('body *')]
      .filter(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > W + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed';
      })
      .slice(0, 5)
      .map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')));
  });
}

module.exports = { openOffline, scrollbarOnRight, horizontalOverflow };
