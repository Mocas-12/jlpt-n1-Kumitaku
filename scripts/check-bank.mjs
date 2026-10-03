/* 题库结构与质量校验（扩充批次后必跑）：node scripts/check-bank.mjs
   检查项：
   - 结构：重复 id/title、字段完整性（options 4 项、answer 0-3、explain 等长且正解条目
     以「正解」开头、干扰条目含【陷阱名】）、sourceUrl http(s)
   - bun1（形式判断）：q 含 ＿＿ 空格；不得带 passage
   - kumi（組み立て）：q 含 ＿＿ 空格与且仅一个 ＊ 标记
   - sho（文章の文法）：passage 含【一】〜【四】四空栏、题数 = 4 且第 i 题对应第 i 空栏；
     passage 字数下限
   - 正解分布：整体均匀性（任一选项占比过高即报错）
   - 退出码：有 error 为 1，供 CI / 提交前把关。 */
import { readFileSync } from 'node:fs';

const TYPE_KEYS = ['bun1', 'kumi', 'sho'];
const LABELS = ['近义辨析', '接续制约', '呼应制约', '敬語', '文末表现', '句序组合', '文脉衔接', '接续词', '指示照应'];
const BLANKS = ['【一】', '【二】', '【三】', '【四】'];
const TYPE_NAMES = { bun1: '形式判断', kumi: '組み立て', sho: '文章の文法' };
const SHO_PASSAGE_FLOOR = 250;

const bankSrc = ['core', ...TYPE_KEYS]
  .map((f) => readFileSync(new URL(`../js/bank/${f}.js`, import.meta.url), 'utf8'))
  .join('\n');
const src = 'var window = globalThis;\n' + bankSrc;
const vm = await import('node:vm');
const ctx = vm.createContext({});
vm.runInContext(src, ctx);
const BANK = vm.runInContext('window.BANK', ctx);
if (!Array.isArray(BANK)) { console.error('js/bank/ 未求值出 BANK 数组'); process.exit(1); }

const errors = [];
const warns = [];
const seenId = new Set(), seenTitle = new Set();
const ansDist = [0, 0, 0, 0];
const labelDist = {};
let totalQ = 0;

for (const s of BANK) {
  const at = s.id || `(第 ${BANK.indexOf(s) + 1} 组)`;
  if (!s.id || typeof s.id !== 'string') errors.push(`${at}: 缺 id`);
  if (seenId.has(s.id)) errors.push(`重复 id: ${s.id}`);
  seenId.add(s.id);
  if (!s.title) errors.push(`${at}: 缺 title`);
  else if (seenTitle.has(s.title)) errors.push(`重复 title: ${s.title}`);
  seenTitle.add(s.title);
  if (!TYPE_KEYS.includes(s.typeKey)) errors.push(`${at}: 非法 typeKey ${s.typeKey}`);
  if (!s.minutes) errors.push(`${at}: 缺 minutes`);
  if (s.sourceUrl && !/^https?:\/\//i.test(s.sourceUrl)) errors.push(`${at}: sourceUrl 非 http(s)`);

  /* 类型专属结构检查 */
  if (s.typeKey === 'sho') {
    const len = (s.passage || '').length;
    if (!s.passage) errors.push(`${at}: sho 缺 passage`);
    else {
      BLANKS.forEach((b, i) => {
        if (!s.passage.includes(b)) errors.push(`${at}: passage 缺空栏 ${b}`);
        const qi = s.questions && s.questions[i];
        if (qi && !qi.q.includes(b)) errors.push(`${at}#${i}: q 未指向本空栏 ${b}`);
      });
      if (len < SHO_PASSAGE_FLOOR) errors.push(`${at}: sho 字数 ${len} 低于下限 ${SHO_PASSAGE_FLOOR}`);
      if (Array.isArray(s.questions) && s.questions.length !== 4) errors.push(`${at}: sho 题数应为 4（对应四空栏）`);
    }
  } else if (s.passage) {
    errors.push(`${at}: ${TYPE_NAMES[s.typeKey]} 题组不应带 passage`);
  }

  for (const [i, q] of (s.questions || []).entries()) {
    totalQ++;
    if (!q.q || typeof q.q !== 'string') { errors.push(`${at}#${i}: 缺 q`); continue; }
    if (s.typeKey !== 'sho' && !q.q.includes('＿＿')) errors.push(`${at}#${i}: q 缺＿＿空格`);
    if (s.typeKey === 'kumi') {
      const star = (q.q.match(/＊/g) || []).length;
      if (star !== 1) errors.push(`${at}#${i}: kumi 的 q 应恰好含 1 个 ＊（实际 ${star}）`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) { errors.push(`${at}#${i}: options ≠ 4`); continue; }
    if (new Set(q.options).size !== 4) errors.push(`${at}#${i}: 选项文本重复`);
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || q.answer % 1 !== 0) {
      errors.push(`${at}#${i}: answer 非法`);
    } else {
      ansDist[q.answer]++;
      if (q.explain === undefined) errors.push(`${at}#${i}: 缺 explain`);
      else if (!Array.isArray(q.explain) || q.explain.length !== 4) errors.push(`${at}#${i}: explain ≠ 4`);
      else {
        if (!q.explain[q.answer].startsWith('正解')) errors.push(`${at}#${i}: 正解条目应以「正解」开头`);
        q.explain.forEach((e, k) => {
          if (k !== q.answer && !/【[^】]{2,10}】/.test(e)) errors.push(`${at}#${i}选项${k + 1}: 干扰条目应含【陷阱名】`);
        });
      }
    }
    if (q.label !== undefined) {
      if (!LABELS.includes(q.label)) errors.push(`${at}#${i}: 考点标签「${q.label}」不在标准词表（${LABELS.join(' / ')}）`);
      else labelDist[q.label] = (labelDist[q.label] || 0) + 1;
    }
  }
}

const maxShare = Math.max(...ansDist) / totalQ;
if (maxShare > 0.35) errors.push(`正解分布失衡：${ansDist.join('/')}（单选项占比 ${(maxShare * 100).toFixed(1)}%，上限 35%）`);

/* ---- 文型库（js/bunkei.js）校验 ---- */
const BN_CATS = ['joshuku', 'gimu', 'henka', 'kijun', 'keiki', 'gentei', 'inka', 'jouken', 'kyouchou', 'taiguu', 'bunmyaku'];
const bnSrc = 'var window = globalThis;\n' + readFileSync(new URL('../js/bunkei.js', import.meta.url), 'utf8');
const bctx = vm.createContext({});
vm.runInContext(bnSrc, bctx);
const BUNKEI = vm.runInContext('window.BUNKEI', bctx);
if (!Array.isArray(BUNKEI)) { console.error('js/bunkei.js 未求值出 BUNKEI 数组'); process.exit(1); }
const bankIds = new Set(BANK.map((s) => s.id));
const seenBnId = new Set(), seenBnP = new Set();
let bnHigh = 0;
for (const e of BUNKEI) {
  const at = e.id || `(第 ${BUNKEI.indexOf(e) + 1} 条)`;
  if (!e.id || typeof e.id !== 'string') errors.push(`文型 ${at}: 缺 id`);
  if (seenBnId.has(e.id)) errors.push(`文型 重复 id: ${e.id}`);
  seenBnId.add(e.id);
  for (const f of ['p', 'cat', 'conn', 'mean', 'ex', 'exzh']) {
    if (!e[f] || typeof e[f] !== 'string') errors.push(`文型 ${at}: 缺 ${f}`);
  }
  if (e.p && seenBnP.has(e.p)) errors.push(`文型 重复文型: ${e.p}`);
  seenBnP.add(e.p);
  if (!BN_CATS.includes(e.cat)) errors.push(`文型 ${at}: 非法分类 ${e.cat}`);
  if (e.freq !== 0 && e.freq !== 1) errors.push(`文型 ${at}: freq 应为 0/1（实际 ${e.freq}）`);
  else if (e.freq) bnHigh++;
  if (e.drill && !bankIds.has(e.drill)) errors.push(`文型 ${at}: drill 指向不存在的题组 ${e.drill}`);
}
console.log(`文型库 ${BUNKEI.length} 条（高频 ${bnHigh}）`);

console.log(`组数 ${BANK.length} · 问数 ${totalQ} · 正解 ${ansDist.join('/')}`);
console.log('题型组数:', TYPE_KEYS.map((k) => `${TYPE_NAMES[k]} ${BANK.filter((s) => s.typeKey === k).length}`).join(' · '));
console.log('标签分布:', Object.entries(labelDist).map(([k, v]) => `${k} ${v}`).join(' · '));
const unused = LABELS.filter((l) => !labelDist[l]);
if (unused.length) console.log(`词表未用到: ${unused.join(' / ')}`);

if (warns.length) {
  console.log(`--- 提示 ${warns.length} 件（不阻断） ---`);
  warns.forEach((w) => console.log('  [!]', w));
}
if (errors.length) {
  console.error(`--- 错误 ${errors.length} 件 ---`);
  errors.forEach((e) => console.error('  [X]', e));
  process.exit(1);
}
console.log('✓ 题库校验通过');
