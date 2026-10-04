/* 生成 README 界面截图（输出到 docs/，浅色 3 张 + 深色 1 张）。
   与 make-assets.mjs 同理：用 Playwright Chromium 渲染，可随时重新生成。
   用法：node tests/server.mjs 8322（与测试同端口）后 node scripts/make-screenshots.mjs */
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:8322/'; // 8123 是本机易撞车端口（曾跑过别的应用），统一用测试端口 8322
const browser = await chromium.launch();

async function newPage(theme) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2 });
  await page.addInitScript((t) => localStorage.setItem('kt_theme', t), theme);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  return page;
}

/* 1. 概览 hero（浅色） */
{
  const page = await newPage('light');
  await page.screenshot({ path: 'docs/shot-home.png', clip: { x: 0, y: 0, width: 1200, height: 660 } });
  await page.close();
  console.log('[shots] docs/shot-home.png');
}

/* 2. 专项训练入口（题组列表 + 混合/模拟卷按钮） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.locator('#set-cards .setcard').first().waitFor({ state: 'attached' });
  // 「全部」视图按题型折叠收纳：展开第一组，让列表卡片露出
  await page.evaluate(() => {
    const d = document.querySelector('#set-cards details.typegroup');
    if (d) d.open = true;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/shot-list.png', clip: { x: 0, y: 0, width: 1200, height: 780 } });
  await page.close();
  console.log('[shots] docs/shot-list.png');
}

/* 3. 形式判断训练中（浅色） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  // 筛选到单一题型即为平铺视图，卡片直接可点
  await page.click('#filterbar .fbtn[data-f="bun1"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-practice.png', clip: { x: 0, y: 0, width: 1200, height: 860 } });
  await page.close();
  console.log('[shots] docs/shot-practice.png');
}

/* 4. 組み立て训练 + 逐项解析（浅色） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.click('#filterbar .fbtn[data-f="kumi"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await page.waitForTimeout(300);
  // 全答①后提交，出解析
  const n = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < n; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-explain.png', clip: { x: 0, y: 0, width: 1200, height: 860 } });
  await page.close();
  console.log('[shots] docs/shot-explain.png');
}

/* 5. 模拟卷（浅色） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="practice"]');
  await page.click('#btn-mock');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/shot-mock.png', clip: { x: 0, y: 0, width: 1200, height: 860 } });
  await page.close();
  console.log('[shots] docs/shot-mock.png');
}

/* 6. 文法库（背诵模式：揭示一张卡片） */
{
  const page = await newPage('light');
  await page.click('nav.tabs a[data-page="bunkei"]');
  await page.locator('#bunkei-list .bncard').first().waitFor();
  await page.click('#bn-recite');
  await page.locator('#bunkei-list .bncard').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/shot-bunkei.png', clip: { x: 0, y: 0, width: 1200, height: 860 } });
  await page.close();
  console.log('[shots] docs/shot-bunkei.png');
}

/* 7. 深色模式（概览） */
{
  const page = await newPage('dark');
  await page.screenshot({ path: 'docs/shot-dark.png', clip: { x: 0, y: 0, width: 1200, height: 660 } });
  await page.close();
  console.log('[shots] docs/shot-dark.png');
}

await browser.close();
