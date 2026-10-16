// إعداد اختبارات برنامج ميراكوس.
// التشغيل: من داخل مجلد qa →  npm ci  ثم  npx playwright test
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'ar',
    // محلياً يمكن تحديد متصفح آخر عبر CHROMIUM_PATH، وفي GitHub Actions يُستخدم متصفح Playwright
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'] }
      : {},
  },
  // يخدم ملفات المستودع كما هي، بدون أي بناء أو تعديل
  webServer: {
    command: 'npx http-server .. -p 4174 -s -c-1',
    url: 'http://127.0.0.1:4174/',
    reuseExistingServer: !process.env.CI,
  },
});
