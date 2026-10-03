/* 冒烟测试：守护核心链路与历史 bug（筛选丢行、未答完提交、导入校验、組み立て无原文渲染） */
import { test, expect } from '@playwright/test';
import { ALL_SETS, BUN1, SHO, FIRST_SET_ID, BUNKEI_N, BUNKEI_HIGH } from './bank-meta.mjs';

// 「全部」视图的题组列表按题型折叠（默认收起）：点击卡片前先展开各组
const openGroups = (page) => page.evaluate(() =>
  document.querySelectorAll('#set-cards details.typegroup').forEach((d) => { d.open = true; }));

test.beforeEach(async ({ context }) => {
  // 拦截 Google Fonts：测试不验证排版，但 headless 下大体积 CJK 字体子集
  // 可能触发重复加载死循环卡住 load 事件；站点本身有系统字体回退，不受影响
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

test('完整链路：筛选 → 作答 → 提交出分 → 列表显示最好成绩', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.hero h1')).toContainText('文法');

  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#page-practice.on')).toBeVisible();

  const cards = page.locator('#set-cards .setcard');
  await expect(cards).toHaveCount(ALL_SETS);

  // 筛选回归：只显示形式判断题组
  await page.click('#filterbar .fbtn[data-f="bun1"]');
  const filtered = page.locator('#set-cards .setcard');
  await expect(filtered).toHaveCount(BUN1);
  for (let i = 0; i < BUN1; i++) {
    await expect(filtered.nth(i).locator('.badge').first()).toContainText('文の文法1');
  }

  await page.click('#filterbar .fbtn[data-f="all"]');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#timer')).toBeVisible();
  // bun1 题组无 passage：句子直接在题面里，不得渲染空原文卡
  await expect(page.locator('#session-body .passage')).toHaveCount(0);

  const qn = await page.locator('#session-body .qblock').count();
  expect(qn).toBeGreaterThan(0);
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }

  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  await expect(page.locator('#session-body .explain')).toHaveCount(qn);

  // 返回列表：刚练过的组应显示「最好成绩」
  await page.click('#btn-back');
  await expect(page.locator('#set-cards .setcard .best').first()).toContainText(/最好成绩 \d+\/\d+/);
});

test('組み立て题组：题面含 ＊ 骨架，文章の文法题组渲染原文', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#filterbar .fbtn[data-f="kumi"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .qstem').first()).toContainText('＊');
  await expect(page.locator('#session-body .passage')).toHaveCount(0);
  await page.click('#btn-back');

  await page.click('#filterbar .fbtn[data-f="sho"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .passage')).toHaveCount(1);
  await expect(page.locator('#session-body .passage')).toContainText('【一】');
});

test('未答完提交先确认，取消后不判分', async ({ page }) => {
  let dialogMsg = null;
  page.on('dialog', async (d) => { dialogMsg = d.message(); await d.dismiss(); });

  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();

  await page.click('#btn-submit');
  expect(dialogMsg).toContain('未作答');
  await expect(page.locator('#session-body .explain')).toHaveCount(0);
  await expect(page.locator('#session-result')).toHaveText('');

  // 全部作答后可直接提交，不再弹确认
  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
});

test('导入校验：缺少 q 字段报错且不入库', async ({ page }) => {
  await page.goto('/#bank');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);

  const bad = [{
    id: 'bad-1', typeKey: 'bun1', title: '缺 q 的题组', minutes: 2,
    questions: [{ label: '近义辨析', options: ['①', '②', '③', '④'], answer: 0 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(bad));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('缺少 q');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);
});

test('导入校验：bun1 带 passage 拒绝、合法题组正常入库', async ({ page }) => {
  await page.goto('/#bank');
  const withPassage = [{
    id: 'bad-2', typeKey: 'bun1', title: '多余的 passage', minutes: 2, passage: '不该有',
    questions: [{ q: '＿＿の句', options: ['①', '②', '③', '④'], answer: 0 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(withPassage));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('passage');

  const good = [{
    id: 'test-import-1', typeKey: 'sho', title: '冒烟测试题组', minutes: 4,
    passage: 'テストの文章である。【一】。確認はここまでだ。【二】。さらに続く。【三】。最後まで書く。【四】。以上。',
    questions: [1, 2, 3, 4].map((n) => ({
      q: `【${'一二三四'[n - 1]}】に入れるのに最もよいものを、①・②・③・④から一つ選びなさい。`,
      label: '文脉衔接', options: ['①', '②', '③', '④'], answer: n % 4,
    })),
  }];
  await page.fill('#bank-import-text', JSON.stringify(good));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('导入成功');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS + 1} 组题`);
});

test('PWA：Service Worker 接管后可完全离线访问', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready); // 等 SW 激活并 claim 页面
  await page.reload(); // 受 SW 接管的这次加载会把 css/js 写入运行时缓存
  await expect(page.locator('.hero h1')).toContainText('文法');

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.hero h1')).toContainText('文法');

  // 离线状态下完整功能可用（js 从缓存加载）
  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#page-practice.on')).toBeVisible();
  await expect(page.locator('#set-cards .setcard')).toHaveCount(ALL_SETS);
});

test('深色模式：切换、记忆、theme-color 同步', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // Playwright 默认 colorScheme=light
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveText('☀️');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#171521');

  await page.reload(); // localStorage 记忆后仍为深色
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.click('#theme-toggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('键盘作答：1-4 选择当前题，Enter 提交', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .qblock.cur')).toHaveCount(1); // 当前题高亮
  await expect(page.locator('.kbd-hint')).toBeVisible();

  const qn = await page.locator('#session-body .qblock').count();
  for (let i = 0; i < qn; i++) {
    await page.keyboard.press('1'); // 每次按 1 选当前题的选项①，当前题自动推进
  }
  for (let i = 0; i < qn; i++) {
    await expect(page.locator('#session-body .qblock').nth(i).locator('.opt').first()).toHaveClass(/sel/);
  }
  await expect(page.locator('#session-body .qblock.cur')).toHaveCount(0); // 全部答完取消高亮

  await page.keyboard.press('Enter');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
});

test('键盘作用域：会话进行中切到其他页，数字/Enter 不暗中作答或交卷', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });

  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await page.locator('#session-body .qblock').first().locator('.opt').first().click(); // 只答第 1 题

  // 切到概览页（session 仍在后台存活）：按数字与 Enter 都不应影响它
  await page.click('nav.tabs a[data-page="home"]');
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  expect(dialogs).toBe(0); // 没有从后台触发提交确认

  // 回到训练页：会话原样保留，作答数仍是 1（数字键没有暗中写入第 2 题）
  await page.click('nav.tabs a[data-page="practice"]');
  await expect(page.locator('#session-view')).toBeVisible();
  const qn = await page.locator('#session-body .qblock').count();
  await expect(page.locator('#btn-submit')).toContainText(`（1/${qn}）`);
});

test('会话草稿：刷新后恢复未提交会话，提交后清除', async ({ page }) => {
  await page.goto('/#practice');
  await openGroups(page);
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();
  await page.locator('#session-body .qblock').first().locator('.opt').first().click(); // 答第 1 题

  await page.reload(); // 模拟误刷新：草稿恢复
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#toast')).toContainText('已恢复');
  const qn = await page.locator('#session-body .qblock').count();
  await expect(page.locator('#btn-submit')).toContainText(`（1/${qn}）`); // 已答进度保留
  await expect(page.locator('#timer')).toBeVisible(); // 计时恢复

  // 继续答完并提交 → 草稿清除
  for (let i = 1; i < qn; i++) {
    await page.locator('#session-body .qblock').nth(i).locator('.opt').first().click();
  }
  await page.click('#btn-submit');
  await expect(page.locator('#session-result')).toContainText(/\d+\s*\/\s*\d+/);
  expect(await page.evaluate(() => localStorage.getItem('kt_session_draft_v1'))).toBeNull();

  // 提交后刷新：不再恢复，显示组列表
  await page.reload();
  await expect(page.locator('#set-list')).toBeVisible();
});

test('会话草稿加固：篡改的下标/答案被兜底，全非法时整份丢弃', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // 部分非法：越界/重复/非整数下标 + 越界答案值 → 过滤后恢复且不崩
  await page.goto('/#practice');
  await page.evaluate((firstId) => {
    localStorage.setItem('kt_session_draft_v1', JSON.stringify({
      mode: 'set', setId: firstId, title: '被篡改的草稿', regen: null,
      groups: [{ setId: firstId, qidx: [0, 99, 'x', 0] }],
      answers: { [firstId + ':0']: 7, [firstId + ':1']: 2 },
      qtimes: {}, startTs: Date.now(), budgetSec: 120,
    }));
  }, FIRST_SET_ID);
  await page.reload();
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-body .qblock')).toHaveCount(1); // 只剩合法下标
  await expect(page.locator('#btn-submit')).toContainText('（0/1）'); // 非法答案值与会话外的键都被剔除

  // 全非法：qidx 全部越界 → 整份草稿丢弃，回到组列表且草稿已清除
  await page.evaluate((firstId) => {
    localStorage.setItem('kt_session_draft_v1', JSON.stringify({
      mode: 'set', setId: firstId, title: '全非法', regen: null,
      groups: [{ setId: firstId, qidx: [50] }],
      answers: {}, qtimes: {}, startTs: Date.now(), budgetSec: 120,
    }));
  }, FIRST_SET_ID);
  await page.reload();
  await expect(page.locator('#set-list')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kt_session_draft_v1'))).toBeNull();
  expect(errors).toEqual([]);
});

test('信号词高亮开关：默认素卷，勾选后衬底高亮，取消后消失（文章の文法）', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#filterbar .fbtn[data-f="sho"]');
  await page.locator('#set-cards .setcard h3').first().click();
  await expect(page.locator('#session-view')).toBeVisible();

  // 默认未勾选：正文无信号词衬底（首篇正文含「しかし」，回归看守：曾恒高亮）
  await expect(page.locator('#session-body mark.sig')).toHaveCount(0);

  await page.check('#sig-toggle');
  await expect(page.locator('#session-body mark.sig').first()).toContainText('しかし');

  await page.uncheck('#sig-toggle');
  await expect(page.locator('#session-body mark.sig')).toHaveCount(0);
});

test('练习记录备份：导入覆盖生效、非法 kind 拒绝、可导出', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // 覆盖确认框自动接受
  const rec = {
    kind: 'kumitaku-records', version: 1, exportedAt: '2026-09-20T00:00:00.000Z',
    data: {
      stats: { bun1: { c: 5, t: 6 } },
      history: [{ ts: Date.now(), setId: FIRST_SET_ID, title: '导入的历史记录', c: 5, t: 6, seconds: 95 }],
      wrong: {},
    },
  };

  await page.goto('/#bank');
  await page.fill('#rec-text', JSON.stringify(rec));
  await page.click('#btn-rec-import');
  await expect(page.locator('#toast')).toContainText('练习记录已导入');
  await page.click('nav.tabs a[data-page="home"]');
  await expect(page.locator('#home-stats')).toContainText('5/6');

  await page.goto('/#bank');
  await page.fill('#rec-text', JSON.stringify({ kind: 'wrong-kind', data: {} }));
  await page.click('#btn-rec-import');
  await expect(page.locator('#toast')).toContainText('导入失败');

  await page.click('#btn-rec-export');
  await expect(page.locator('#rec-text')).toHaveValue(/kumitaku-records/);
});

test('数据养护：history 上限 200 条，失效错题自动清理', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((firstId) => {
    const hist = [];
    for (let i = 0; i < 260; i++) hist.push({ ts: 1e12 + i, setId: firstId, title: 'h' + i, c: 1, t: 2, seconds: 1 });
    localStorage.setItem('kt_n1_bunpou_v1', JSON.stringify({
      stats: {}, history: hist,
      wrong: { 'no-such-set:0': { setId: 'no-such-set', chosen: 0, ts: 1 } },
    }));
  }, FIRST_SET_ID);
  await page.reload(); // pruneData 在页面初始化时执行
  const d = await page.evaluate(() => JSON.parse(localStorage.getItem('kt_n1_bunpou_v1')));
  expect(d.history.length).toBe(200);
  expect(d.wrong['no-such-set:0']).toBeUndefined();
});

test('安全：sourceUrl 仅允许 http(s)，渲染侧兜底旧数据', async ({ page }) => {
  await page.goto('/#bank');
  const bad = [{
    id: 'bad-url', typeKey: 'bun1', title: '坏链接', minutes: 2,
    source: '来源', sourceUrl: 'javascript:alert(1)',
    questions: [{ q: '＿＿の句', options: ['①', '②', '③', '④'], answer: 0 }],
  }];
  await page.fill('#bank-import-text', JSON.stringify(bad));
  await page.click('#btn-import');
  await expect(page.locator('#toast')).toContainText('sourceUrl');
  await expect(page.locator('#bank-count')).toContainText(`${ALL_SETS} 组题`);

  // 渲染侧兜底：绕过校验的遗留数据（如旧版导入）里 javascript: 链接替换为 #bank
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('kt_custom_sets_v1') || '[]');
    list.push({
      id: 'legacy-url', typeKey: 'bun1', title: '旧数据坏链接', minutes: 2, source: '来源', sourceUrl: 'javascript:alert(1)',
      questions: [{ q: '＿＿の句', options: ['①', '②', '③', '④'], answer: 0 }],
    });
    localStorage.setItem('kt_custom_sets_v1', JSON.stringify(list));
  });
  await page.goto('/#practice');
  const badge = page.locator('#set-cards .setcard', { hasText: '旧数据坏链接' }).locator('a.badge').first();
  await expect(badge).toHaveAttribute('href', '#bank');
});

test('文法库：全量渲染、搜索与高频筛选', async ({ page }) => {
  await page.goto('/#bunkei');
  await expect(page.locator('#bn-total')).toHaveText(String(BUNKEI_N));
  await expect(page.locator('#bunkei-list .bncard')).toHaveCount(BUNKEI_N);
  await expect(page.locator('#bn-progress')).toContainText(`0 / ${BUNKEI_N}`);

  // 高频筛选
  await page.click('#bn-freq .fbtn[data-f="high"]');
  await expect(page.locator('#bunkei-list .bncard')).toHaveCount(BUNKEI_HIGH);
  await page.click('#bn-freq .fbtn[data-f="all"]');

  // 搜索：文法/接续/例文命中
  await page.fill('#bn-search', 'ざるを得ない');
  await expect(page.locator('#bunkei-list .bncard')).toHaveCount(1);
  await expect(page.locator('#bunkei-list .bn-p').first()).toContainText('ざるを得ない');
  await page.fill('#bn-search', '');

  // 分类筛选
  await page.click('#bn-cats .fbtn[data-c="taiguu"]');
  const taiguuCards = page.locator('#bunkei-list .bncard');
  const n = await taiguuCards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    await expect(taiguuCards.nth(i).locator('.badge').nth(1)).toContainText('敬語');
  }
});

test('文法库：背诵模式揭示 → 掌握进度持久化 → 只看未掌握', async ({ page }) => {
  await page.goto('/#bunkei');
  await page.click('#bn-recite');
  await expect(page.locator('#bn-recite')).toContainText('背诵模式：开');

  // 背诵模式下释义隐藏，点击卡片揭示
  const first = page.locator('#bunkei-list .bncard').first();
  await expect(first.locator('.bn-body')).toBeHidden();
  await expect(first.locator('.bn-hint')).toContainText('点击卡片显示释义');
  await first.click();
  await expect(first.locator('.bn-body')).toBeVisible();
  await expect(first.locator('[data-mk]')).toBeVisible();

  // 标记掌握 → localStorage 持久化 + 进度更新
  await first.locator('[data-mk]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kt_bunkei_v1')).m);
  expect(Object.keys(stored).length).toBe(1);
  await expect(page.locator('#bn-progress')).toContainText('1 / ');

  // 刷新后仍在；开启「只看未掌握」则被过滤
  await page.reload();
  await expect(page.locator('#bn-progress')).toContainText('1 / ');
  await page.check('#bn-hide');
  const cards = page.locator('#bunkei-list .bncard');
  await expect(cards).toHaveCount(BUNKEI_N - 1);
  for (let i = 0; i < BUNKEI_N - 1; i++) {
    await expect(cards.nth(i)).not.toHaveClass(/mastered/);
  }
});

test('文法库：同族题组链接直达专项训练', async ({ page }) => {
  await page.goto('/#bunkei');
  await page.fill('#bn-search', 'ざるを得ない');
  await page.locator('#bunkei-list [data-drill]').first().click();
  // startSet 切到训练会话视图（hash 也切到 #practice）
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-head-title')).toContainText('義務');
});

test('模拟卷：按官方構成组卷（形式判断10 + 組み立て + 文章の文法）', async ({ page }) => {
  await page.goto('/#practice');
  await page.click('#btn-mock');
  await expect(page.locator('#session-view')).toBeVisible();
  await expect(page.locator('#session-head-title')).toContainText('模拟卷');
  const qn = await page.locator('#session-body .qblock').count();
  expect(qn).toBe(20); // bun1 2组×5問 + kumi 1组×6問 + sho 1组×4問
  // 全局计时器在走
  await expect(page.locator('#timer')).toBeVisible();
});
