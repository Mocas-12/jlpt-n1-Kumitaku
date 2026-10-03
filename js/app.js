/* Kumitaku — 交互逻辑（无依赖，支持 file:// 直接打开）
   题库来源：js/bank/ 分片（window.BANK）+ 「真题·题库」页导入的自定义题组（存 localStorage） */
(function () {
  'use strict';

  var LS_KEY = 'kt_n1_bunpou_v1';        // 练习记录/错题/统计
  var LS_CUSTOM = 'kt_custom_sets_v1';   // 页面导入的自定义题组
  var LS_THEME = 'kt_theme';             // 深色模式偏好（缺省跟随系统）
  var LS_DRAFT = 'kt_session_draft_v1';  // 未提交会话草稿（刷新/意外关闭后恢复进度）
  var LS_GROUP = 'kt_group_open_v1';     // 题组列表按题型折叠分组的展开状态（训练页/题库页共用）
  var LS_BUNKEI = 'kt_bunkei_v1';        // 文法库的掌握标记 { m: { id: 1 } }
  var SIG_WORDS = ['にもかかわらず', 'とはいえ', 'これに対して', '言い換えれば', 'したがって', 'けれども', 'しかし', 'なぜなら', 'ところが', 'それでも', 'もっとも', 'たしかに', 'もちろん', 'すなわち', 'そのため', 'それゆえ', '要するに', 'つまり', '確かに', 'たしか', '一方', 'だが', 'ただし'];
  var SIG_RE = new RegExp('(' + SIG_WORDS.join('|') + ')', 'g');
  var LABELS = ['①', '②', '③', '④'];
  var TYPE_KEYS = ['bun1', 'kumi', 'sho'];
  var MOCK_BLUEPRINT = [ // 模拟卷蓝图：按官方大题构成抽取题组（不足则全取）
    { key: 'bun1', sets: 2 }, { key: 'kumi', sets: 1 }, { key: 'sho', sets: 1 }
  ];

  /* ---------- storage ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function save(d) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(d)); }
    catch (e) { toast('保存失败：浏览器本地存储不可用或已满', false); }
  }
  function customSets() {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; }
    catch (e) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(list)); }
    catch (e) { toast('保存失败：浏览器本地存储不可用或已满', false); }
  }

  /* ---------- 数据养护：history 上限 + 失效错题清理 + 练习日期回填 ---------- */
  var HISTORY_MAX = 200;
  var DAY = 86400000;
  /* 错题间隔重复：stage 0/1/2 分别对应 1/3/7 天后再复习，stage 2 复习通过即毕业移出。
     旧数据（无 stage/next 字段）视为 stage 0、已到期，走同一套推进 */
  function dueKeys(d) {
    var now = Date.now(), out = [];
    if (d.wrong) Object.keys(d.wrong).forEach(function (qid) {
      var e = d.wrong[qid];
      if (e && typeof e === 'object' && !(e.next > now)) out.push(qid);
    });
    return out;
  }
  function dueCount(d) { return dueKeys(d).length; }
  function pruneData() {
    var d = load();
    var changed = false;
    /* 旧数据迁移：练习日期（streak 用）先于 history 截断从完整历史回填，
       重度用户（每天多会话）的连续打卡才不会被 200 条上限截掉早前的天数 */
    if (!Array.isArray(d.days)) {
      var days = [];
      (d.history || []).forEach(function (r) { days.push(dstr(new Date(r.ts))); });
      d.days = days.filter(function (x, i) { return days.indexOf(x) === i; });
      changed = true;
    }
    if (d.history && d.history.length > HISTORY_MAX) { d.history = d.history.slice(0, HISTORY_MAX); changed = true; }
    if (d.wrong) {
      Object.keys(d.wrong).forEach(function (qid) {
        var e = d.wrong[qid];
        var i = qid.lastIndexOf(':');
        var s = setById(qid.slice(0, i));
        /* 三重清理：题组没了；条目形状损坏（非对象）；题号越界（自定义题组“同 id 覆盖导入”
           后题数变少会留下永远无法消化/删除的幽灵错题，污染到期计数） */
        var qi = parseInt(qid.slice(i + 1), 10);
        if (!s || !e || typeof e !== 'object' ||
            !(typeof qi === 'number' && qi % 1 === 0 && qi >= 0 && qi < s.questions.length)) {
          delete d.wrong[qid]; changed = true;
        }
      });
    }
    if (d.traps !== undefined && (typeof d.traps !== 'object' || d.traps === null || Array.isArray(d.traps))) {
      d.traps = {}; changed = true; // 画像计数被篡改成原始值时重置，防渲染侧崩溃
    }
    if (changed) save(d);
  }

  /* ---------- 会话草稿：未提交会话的进度持久化 ----------
     每次作答即写入；提交或返回列表时清除。题组只存 id，恢复时重新解析，
     解析不到（题组已删）整份丢弃，避免恢复出残缺会话。 */
  function saveDraft() {
    if (!session || session.submitted) return;
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        mode: session.mode, setId: session.setId, regen: session.regen, title: session.title,
        groups: session.groups.map(function (g) { return { setId: g.set.id, qidx: g.qidx }; }),
        answers: session.answers, qtimes: session.qtimes,
        startTs: session.startTs, budgetSec: session.budgetSec
      }));
    } catch (e) {}
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_DRAFT));
      if (!d || !d.mode || !Array.isArray(d.groups)) return false;
      var groups = d.groups.map(function (g) {
        var s = setById(g.setId);
        if (!s || !Array.isArray(g.qidx)) return null;
        /* 兜底被篡改/损坏的草稿：下标须为范围内的整数并去重，
           否则 renderSession 取 s.questions[qi] 得 undefined 直接崩，
           且草稿不清除、每次进训练页都会反复崩 */
        var seen = {}, qidx = [];
        g.qidx.forEach(function (qi) {
          if (typeof qi === 'number' && qi % 1 === 0 && qi >= 0 && qi < s.questions.length && !seen[qi]) {
            seen[qi] = 1;
            qidx.push(qi);
          }
        });
        return qidx.length ? { set: s, qidx: qidx } : null;
      });
      if (groups.some(function (g) { return !g; })) throw new Error('题组已不存在');
      /* 答案值夹到 0〜3（否则错题本渲染 LABELS[越界] = undefined）；
         只保留当前会话内的题（防止 updateSubmitCount 计数虚高绕过未答确认） */
      var validKeys = {};
      groups.forEach(function (g) {
        g.qidx.forEach(function (qi) { validKeys[g.set.id + ':' + qi] = 1; });
      });
      var answers = {}, src = d.answers || {};
      Object.keys(src).forEach(function (k) {
        if (validKeys[k] && typeof src[k] === 'number' && src[k] % 1 === 0 && src[k] >= 0 && src[k] <= 3) answers[k] = src[k];
      });
      session = {
        mode: d.mode, setId: d.setId || null, regen: d.regen || null, title: d.title || '',
        groups: groups, answers: answers, qtimes: d.qtimes || {},
        submitted: false, startTs: d.startTs || Date.now(), budgetSec: d.budgetSec || 0,
        lastMark: Date.now() // 刷新期间的空档不计入下一题的用时
      };
      return true;
    } catch (e) {
      try { localStorage.removeItem(LS_DRAFT); } catch (e2) {}
      return false;
    }
  }
  function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  }
  /* 渲染侧兜底：来源链接只放行 http(s)，其余回落站内锚点（含旧导入数据里的 javascript: 等） */
  function safeUrl(u) {
    var s = String(u == null ? '' : u);
    return /^https?:\/\//i.test(s) ? esc(s) : '#bank';
  }
  function typeInfo(key) {
    var m = { bun1: '文の文法1（形式判断）·問題7', kumi: '文の文法2（組み立て）·問題8', sho: '文の文法3（文章の文法）·問題9' };
    var p = (m[key] || key).split('·');
    return { key: key, label: p[0], no: p[1] || '' };
  }
  function allSets() {
    var list = (typeof BANK !== 'undefined' && BANK ? BANK.slice() : []).concat(customSets());
    var seen = {}, out = [];
    list.forEach(function (s) {
      /* 非法 typeKey 一并剔除：导入校验只护新导入，localStorage 里的旧脏数据
         若流到渲染侧（byType[s.typeKey]）会整页崩——渲染侧兜底，同 safeUrl 惯例 */
      if (!s || !s.id || TYPE_KEYS.indexOf(s.typeKey) < 0) return;
      if (seen[s.id]) { out[seen[s.id] - 1] = s; } else { seen[s.id] = out.push(s); }
    });
    return out;
  }
  function setById(id) {
    var l = allSets();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  function fmt(sec) {
    sec = Math.max(0, sec | 0);
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function dstr(dt) { return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
  function calcStreak(d) { // 连续打卡天数：优先读独立的练习日期记录（不受 history 上限截断影响），旧数据回退从 history 推导
    var days = {};
    if (Array.isArray(d.days)) d.days.forEach(function (s) { days[s] = 1; });
    else (d.history || []).forEach(function (r) { days[dstr(new Date(r.ts))] = 1; });
    var n = 0, dt = new Date();
    if (!days[dstr(dt)]) dt.setDate(dt.getDate() - 1);
    while (days[dstr(dt)]) { n++; dt.setDate(dt.getDate() - 1); }
    return n;
  }
  function markTime(key) { // 每题用时：与上一题作答时刻的间隔（首题从开考起算）
    if (!session || session.qtimes[key] != null) return;
    var now = Date.now();
    session.qtimes[key] = Math.max(1, Math.round((now - (session.lastMark || session.startTs)) / 1000));
    session.lastMark = now;
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function toast(msg, ok) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.style.borderColor = ok === false ? 'var(--accent)' : 'var(--ok)';
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function downloadJSON(text, name) { // 触发浏览器下载一段 JSON 文本
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- PWA：添加到主屏幕 ---------- */
  function initInstall() {
    var btn = document.getElementById('install-btn');
    if (!btn) return;
    var guide = document.getElementById('install-guide');
    var deferred = null;
    // 已从主屏幕图标（standalone）运行时，入口没有意义
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) return;
    // iOS 从不触发 beforeinstallprompt，也不在地址栏给安装图标：入口常显，点击给分步指引
    // iPadOS 13+ 伪装桌面 UA，用平台+触点数补判
    var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) btn.hidden = false;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); // 不用浏览器自带的小图标入口，统一走页脚按钮
      deferred = e;
      btn.hidden = false;
      try { // 一次性提示，帮用户发现页脚入口
        if (!localStorage.getItem('kt_install_hint')) {
          localStorage.setItem('kt_install_hint', '1');
          toast('本站可安装到主屏幕离线使用——见页脚「添加到主屏幕」', true);
        }
      } catch (err) {}
    });
    btn.addEventListener('click', function () {
      if (deferred) { // Chromium 系：原生安装弹窗
        deferred.prompt();
        deferred.userChoice.then(function (res) {
          if (res && res.outcome === 'accepted') { btn.hidden = true; toast('已添加到主屏幕', true); }
          deferred = null;
        });
        return;
      }
      if (isIOS) { guide.hidden = !guide.hidden; return; }
      toast('此浏览器不支持一键安装：安卓/电脑可用 Chrome 地址栏的安装图标；iPhone 用 Safari「分享 → 添加到主屏幕」', false);
    });
    var closeBtn = document.getElementById('install-guide-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { guide.hidden = true; });
    window.addEventListener('appinstalled', function () { btn.hidden = true; guide.hidden = true; });
  }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#171521' : '#16608c');
    var b = document.getElementById('theme-toggle');
    if (b) {
      b.textContent = t === 'dark' ? '☀️' : '🌙';
      b.setAttribute('aria-label', t === 'dark' ? '切换浅色模式' : '切换深色模式');
    }
  }

  /* ---------- 阅读设置：字号（标准/大/特大）与行距（标准/加宽），会话即时生效 ---------- */
  var LS_READER = 'kt_reader';
  function readerSettings() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_READER)) || {};
      return { fs: [0, 1, 2].indexOf(v.fs) >= 0 ? v.fs : 0, lh: v.lh === 1 ? 1 : 0 };
    } catch (e) { return { fs: 0, lh: 0 }; }
  }
  function applyReader(r) {
    var h = document.documentElement;
    if (r.fs) h.setAttribute('data-rfs', r.fs); else h.removeAttribute('data-rfs');
    if (r.lh) h.setAttribute('data-rlh', r.lh); else h.removeAttribute('data-rlh');
  }
  function saveReader(r) {
    applyReader(r);
    try { localStorage.setItem(LS_READER, JSON.stringify(r)); } catch (e) {}
  }
  function initReaderCtl() {
    var r = readerSettings();
    applyReader(r);
    var minus = document.getElementById('fs-minus');
    var plus = document.getElementById('fs-plus');
    var lh = document.getElementById('lh-toggle');
    function sync() {
      minus.disabled = r.fs <= 0;
      plus.disabled = r.fs >= 2;
      lh.classList.toggle('on', r.lh === 1);
    }
    minus.addEventListener('click', function () { r.fs = Math.max(0, r.fs - 1); saveReader(r); sync(); });
    plus.addEventListener('click', function () { r.fs = Math.min(2, r.fs + 1); saveReader(r); sync(); });
    lh.addEventListener('click', function () { r.lh = r.lh ? 0 : 1; saveReader(r); sync(); });
    sync();
  }

  /* 系统深浅色切换：用户未手动选过主题时跟随系统（选过则尊重显式偏好） */
  function initSystemTheme() {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mq.addEventListener) return;
    mq.addEventListener('change', function () {
      var saved = null;
      try { saved = localStorage.getItem(LS_THEME); } catch (e) {}
      if (saved !== 'dark' && saved !== 'light') applyTheme(mq.matches ? 'dark' : 'light');
    });
  }

  /* ---------- passage rendering ---------- */
  /* sigOn：信号词衬底高亮由开关控制（默认关，还原考场素卷）；
     ⟪…⟫ 划线句标记属于题面内容，不受开关影响。
     句级 <span class="sent"> 供「解析引用 → 跳原文高亮」定位使用，无视觉差异 */
  function passageHTML(text, sigOn) {
    return String(text).split('\n').map(function (para) {
      /* 划线句 ⟪…⟫ 整块一个句 span（可跨句号），
         块外的普通文本再按句号切分——否则句级切分会把 mark 撕裂、留下裸 ⟪⟫ */
      var out = '';
      para.split(/(⟪[^⟫]*⟫)/).forEach(function (seg) {
        if (!seg) return;
        var t;
        if (seg.charAt(0) === '⟪') {
          t = esc(seg).replace(/⟪(.+?)⟫/g, '<mark class="uline">$1</mark>');
          if (sigOn) t = t.replace(SIG_RE, '<mark class="sig">$1</mark>');
          out += '<span class="sent">' + t + '</span>';
          return;
        }
        (seg.match(/[^。？！]*[。？！]|[^。？！]+/g) || []).forEach(function (sen) {
          t = esc(sen);
          if (sigOn) t = t.replace(SIG_RE, '<mark class="sig">$1</mark>');
          out += '<span class="sent">' + t + '</span>';
        });
      });
      return '<p>' + out + '</p>';
    }).join('');
  }
  /* 解析里的「…」引用能否在原文中找到（去划线标记与空白后子串匹配） */
  function quoteIn(e, hay) {
    var ms = String(e).match(/「([^「」]{4,80})」/g) || [];
    for (var i = 0; i < ms.length; i++) {
      var q = ms[i].slice(1, -1).replace(/[『』\s]/g, '');
      if (q.length >= 4 && hay.indexOf(q) >= 0) return q;
    }
    return null;
  }
  function jumpToQuote(g, quote) {
    var p = document.querySelector('.passage[data-g="' + g + '"]');
    if (!p) return;
    var sents = Array.prototype.slice.call(p.querySelectorAll('.sent'));
    var hay = '', map = [];
    sents.forEach(function (sp, i) {
      // 与 hayCache 同口径剥离 ⟪⟫（划线标记只是视觉层，不参与文本匹配）
      var t = sp.textContent.replace(/[⟪⟫\s]/g, '');
      map.push({ i: i, start: hay.length, end: hay.length + t.length });
      hay += t;
    });
    var at = hay.indexOf(quote);
    if (at < 0) { toast('原文中未定位到该引用', false); return; }
    var hit = map.filter(function (m) { return m.start < at + quote.length && m.end > at; })
      .map(function (m) { return sents[m.i]; });
    document.querySelectorAll('.passage .sent.hl').forEach(function (sp) { sp.classList.remove('hl'); });
    hit.forEach(function (sp) { sp.classList.add('hl'); });
    if (hit.length) hit[0].scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' });
  }

  /* ---------- session state ---------- */
  var session = null; // {mode, setId?, groups:[{set,qidx}], answers:{}, submitted, startTs, budgetSec, timerId}

  /* =========================================================
     routing
     ========================================================= */
  var PAGES = ['home', 'tech', 'bunkei', 'practice', 'review', 'bank'];
  function route() {
    var h = (location.hash || '#home').replace('#', '');
    if (PAGES.indexOf(h) < 0) h = 'home';
    PAGES.forEach(function (p) {
      var el = document.getElementById('page-' + p);
      if (el) el.classList.toggle('on', p === h);
      var tab = document.querySelector('nav.tabs a[data-page="' + p + '"]');
      if (tab) tab.classList.toggle('on', p === h);
    });
    if (h === 'home') renderHome();
    if (h === 'bunkei') renderBunkei();
    if (h === 'practice') {
      if (session) { renderSession(); showSessionView(); if (!session.submitted) startTimer(); }
      else { renderSetList(); showSetList(); }
    }
    if (h === 'review') renderReview();
    if (h === 'bank') renderBankPage();
    /* 手机端：导航条可横向滚动，路由切换后把当前页签滚回可视区中央 */
    var onTab = document.querySelector('nav.tabs a.on');
    if (onTab) onTab.scrollIntoView({ block: 'nearest', inline: 'center' });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  /* =========================================================
     home
     ========================================================= */
  function renderHome() {
    var d = load();
    var box = document.getElementById('home-stats');
    if (!box) return;
    var totalC = 0, totalT = 0, rows = '';
    TYPE_KEYS.forEach(function (k) {
      var t = typeInfo(k);
      var st = (d.stats && d.stats[k]) || { c: 0, t: 0 };
      totalC += st.c; totalT += st.t;
      var pct = st.t ? Math.round(st.c / st.t * 100) : 0;
      rows += '<div class="stat-row"><span>' + t.label + '</span>' +
        '<span class="pbar"><i class="' + (st.t && pct < 50 ? 'low' : '') + '" style="width:' + (st.t ? pct : 0) + '%"></i></span>' +
        '<span>' + (st.t ? st.c + '/' + st.t + '（' + pct + '%）' : '—') + '</span></div>';
    });
    rows += '<div class="stat-row"><span><b>合计</b></span><span class="pbar"><i class="' + (totalT && totalC / totalT < 0.5 ? 'low' : '') + '" style="width:' + (totalT ? Math.round(totalC / totalT * 100) : 0) + '%"></i></span><span>' + (totalT ? totalC + '/' + totalT + '（' + Math.round(totalC / totalT * 100) + '%）' : '—') + '</span></div>';
    var hist = (d.history || []).slice(0, 6).map(function (r) {
      return '<div class="histitem"><span>' + fmtDate(r.ts) + '</span><b style="flex:1">' + esc(r.title) + '</b><span>' + r.c + '/' + r.t + ' · ' + fmt(r.seconds) + '</span></div>';
    }).join('');
    var wrongN = d.wrong ? Object.keys(d.wrong).length : 0;
    var dueN = dueCount(d);
    var bankN = allSets().length;
    var streak = calcStreak(d);
    var bnList = bunkeiAll();
    var bnStoreM = bunkeiStore().m;
    var bnM = bnList.filter(function (e) { return bnStoreM[e.id]; }).length;
    var bnT = bnList.length;
    // 弱点画像：错题的考点标签 Top3（点击直达该考点的定向训练）
    var traps = Object.keys(d.traps || {}).map(function (l) { return [l, d.traps[l]]; })
      .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 3);
    box.innerHTML =
      '<div class="grid cols-2">' +
      '<div class="card"><h3>按题型正确率</h3>' + rows +
      (traps.length ? '<p class="trapline" style="margin-top:12px"><b>常掉陷阱：</b>' +
        traps.map(function (t) { return '<a href="#practice" data-trap="' + esc(t[0]) + '">【' + esc(t[0]) + '】×' + t[1] + '</a>'; }).join('　') +
        '<span style="color:var(--muted);font-size:12.5px">（点标签直达定向训练）</span></p>' : '') +
      '<p style="margin-top:12px;font-size:13.5px;color:var(--muted)">当前题库：' + bankN + ' 组题（<a href="#bank">真题·题库</a>导入/管理）</p>' +
      (bnT ? '<p style="margin-top:8px;font-size:13.5px;color:var(--muted)">文法库：已掌握 <b style="color:var(--ink)">' + bnM + ' / ' + bnT + '</b> 条（<a href="#bunkei">去背诵 →</a>）</p>' : '') +
      '</div></div>';
      '<div class="card"><h3>最近练习</h3>' +
      (streak ? '<p class="streakline">🔥 连续打卡 <b>' + streak + '</b> 天</p>' : '') +
      (dueN ? '<p class="dueline">📌 今日待复习错题 <b style="color:var(--accent)">' + dueN + '</b> 题 <button class="btn sm" id="btn-home-review">开始复习</button></p>' : '') +
      (hist || '<div class="empty">还没有练习记录。内置题库已就绪，去<a href="#practice">专项训练</a>开始第一组吧。</div>') +
      (wrongN ? '<p style="margin-top:10px">错题本共 <b style="color:var(--accent)">' + wrongN + '</b> 题待消灭 · <a href="#review">去看错题</a></p>' : '') +
      '</div></div>';
    var hr = document.getElementById('btn-home-review');
    if (hr) hr.onclick = function () { startWrongSession(true); };
    box.querySelectorAll('[data-trap]').forEach(function (a) {
      a.addEventListener('click', function () {
        curLabel = a.getAttribute('data-trap');
        curFilter = 'all'; curQuery = '';
      }); // hash 跳转后 route → renderSetList 按状态渲染
    });
  }

  /* =========================================================
     bunkei（文法库：浏览 + 背诵）
     数据来源：js/bunkei.js 的 window.BUNKEI；
     掌握标记存 localStorage（LS_BUNKEI），揭示状态只存会话内存
     ========================================================= */
  var BN_CATS = [
    { key: 'joshuku', name: '让步・逆接・対比' }, { key: 'gimu', name: '義務・被迫・感情' },
    { key: 'henka', name: '変化・程度・様態' }, { key: 'kijun', name: '基準・経由・対応' },
    { key: 'keiki', name: '契機・時点・時間' }, { key: 'gentei', name: '限定・範囲・添加' },
    { key: 'inka', name: '原因・理由' }, { key: 'jouken', name: '条件・仮定' },
    { key: 'kyouchou', name: '強調・断定・文末' }, { key: 'taiguu', name: '敬語・待遇' },
    { key: 'bunmyaku', name: '接続詞・文脈（問題9）' }
  ];
  var bnCat = 'all', bnFreq = 'all', bnQuery = '', bnRecite = false, bnHide = false;
  var bnReveal = {};
  function bunkeiAll() { return (typeof BUNKEI !== 'undefined' && BUNKEI) ? BUNKEI : []; }
  function bunkeiStore() {
    try { return JSON.parse(localStorage.getItem(LS_BUNKEI)) || { m: {} }; }
    catch (e) { return { m: {} }; }
  }
  function bunkeiSave(s) {
    try { localStorage.setItem(LS_BUNKEI, JSON.stringify(s)); }
    catch (e) { toast('保存失败：浏览器本地存储不可用或已满', false); }
  }

  function bnCardHTML(e, m) {
    var mastered = !!m[e.id];
    var revealed = !!bnReveal[e.id];
    var cat = (BN_CATS.filter(function (c) { return c.key === e.cat; })[0] || {}).name || e.cat;
    return '<div class="card bncard' + (mastered ? ' mastered' : '') + (revealed ? ' revealed' : '') + '" data-id="' + esc(e.id) + '">' +
      '<div class="bn-head"><span class="bn-p">' + esc(e.p) + '</span>' +
      (e.freq ? '<span class="badge red">高频</span>' : '<span class="badge gray">常考</span>') +
      '<span class="badge gray">' + esc(cat) + '</span>' +
      (mastered ? '<span class="bn-mk" title="已掌握">✓</span>' : '') + '</div>' +
      '<p class="bn-conn"><b>接続</b>' + esc(e.conn) + '</p>' +
      '<div class="bn-body">' +
        '<p><b>意思</b>' + esc(e.mean) + '</p>' +
        '<p class="bn-ex">' + esc(e.ex) + '<span class="bn-zh">' + esc(e.exzh) + '</span></p>' +
        (e.note ? '<p class="bn-note">' + esc(e.note) + '</p>' : '') +
      '</div>' +
      (bnRecite && !revealed ? '<p class="bn-hint">👆 点击卡片显示释义</p>' : '') +
      (bnRecite && revealed ? '<div class="bn-acts"><button class="btn sm" data-mk="' + esc(e.id) + '">✓ 掌握了</button><button class="btn sm sub" data-um="' + esc(e.id) + '">↺ 没记住</button></div>' : '') +
      (e.drill ? '<p class="bn-foot"><a class="bn-drill" data-drill="' + esc(e.drill) + '">✍ 同族题组 ' + esc(e.drill) + ' →</a></p>' : '') +
      '</div>';
  }

  function renderBunkei() {
    var all = bunkeiAll();
    var totalEl = document.getElementById('bn-total');
    if (totalEl) totalEl.textContent = all.length;
    var m = bunkeiStore().m;
    var masteredN = all.filter(function (e) { return m[e.id]; }).length;
    var highAll = all.filter(function (e) { return e.freq; });
    var highM = highAll.filter(function (e) { return m[e.id]; }).length;
    var pct = all.length ? Math.round(masteredN / all.length * 100) : 0;
    document.getElementById('bn-progress').innerHTML =
      '<span>已掌握 <span class="bn-pct">' + masteredN + ' / ' + all.length + '</span> 条（高频 ' + highM + ' / ' + highAll.length + '）</span>' +
      '<span class="pbar"><i style="width:' + pct + '%"></i></span><span class="bn-pct">' + pct + '%</span>';

    var cats = '<button class="fbtn' + (bnCat === 'all' ? ' on' : '') + '" data-c="all">全部（' + all.length + '）</button>';
    BN_CATS.forEach(function (c) {
      var n = all.filter(function (e) { return e.cat === c.key; }).length;
      if (!n) return;
      cats += '<button class="fbtn' + (bnCat === c.key ? ' on' : '') + '" data-c="' + c.key + '">' + c.name + '（' + n + '）</button>';
    });
    document.getElementById('bn-cats').innerHTML = cats;
    document.getElementById('bn-freq').innerHTML =
      '<button class="fbtn' + (bnFreq === 'all' ? ' on' : '') + '" data-f="all">全部频度</button>' +
      '<button class="fbtn' + (bnFreq === 'high' ? ' on' : '') + '" data-f="high">高频（' + highAll.length + '）</button>' +
      '<button class="fbtn' + (bnFreq === 'norm' ? ' on' : '') + '" data-f="norm">常考（' + (all.length - highAll.length) + '）</button>';
    var reciteBtn = document.getElementById('bn-recite');
    reciteBtn.textContent = bnRecite ? '🗣 背诵模式：开' : '🗣 背诵模式：关';
    reciteBtn.classList.toggle('ghost', !bnRecite);
    var hideTgl = document.getElementById('bn-hide');
    if (hideTgl.checked !== bnHide) hideTgl.checked = bnHide;
    var searchEl = document.getElementById('bn-search');
    if (searchEl.value.trim() !== bnQuery) searchEl.value = bnQuery;

    var q = bnQuery.toLowerCase();
    var list = all.filter(function (e) {
      if (bnCat !== 'all' && e.cat !== bnCat) return false;
      if (bnFreq === 'high' && !e.freq) return false;
      if (bnFreq === 'norm' && e.freq) return false;
      if (bnHide && m[e.id]) return false;
      if (q && (e.p + e.conn + e.mean + e.ex).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var box = document.getElementById('bunkei-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">没有匹配的文法。换个关键词，或清除筛选再试试。</div>';
      return;
    }
    var html = '';
    BN_CATS.forEach(function (c) {
      var items = list.filter(function (e) { return e.cat === c.key; });
      if (!items.length) return;
      var mcat = items.filter(function (e) { return m[e.id]; }).length;
      html += '<details class="typegroup" data-cat="' + c.key + '" open>' +
        '<summary><span class="tg-label">' + c.name + '</span>' +
        '<span class="tg-count">' + mcat + ' / ' + items.length + ' 掌握</span></summary>' +
        '<div class="tg-body">' + items.map(function (e) { return bnCardHTML(e, m); }).join('') + '</div></details>';
    });
    box.innerHTML = html;
  }

  /* =========================================================
     practice — list
     ========================================================= */
  function showSetList() {
    document.getElementById('set-list').style.display = '';
    document.getElementById('session-view').style.display = 'none';
  }
  function showSessionView() {
    document.getElementById('set-list').style.display = 'none';
    document.getElementById('session-view').style.display = '';
  }

  var curFilter = 'all';
  var curLabel = 'all';   // 考点标签筛选（题组含任一该标签的题即命中）
  var curQuery = '';      // 标题关键词搜索
  var curWrongLabel = 'all'; // 错题本的考点筛选
  /* 考点标签固定词表（与 js/bank/ 出题配方一致；新标签出现时自动追加进筛选项） */
  var QLABELS = ['近义辨析', '接续制约', '呼应制约', '敬語', '文末表现', '句序组合', '文脉衔接', '接续词', '指示照应'];
  function labelChipsHTML(sets, cur) { // 训练页/错题本共用的考点筛选 chips（只列出有题的标签）
    var have = {};
    sets.forEach(function (s) {
      s.questions.forEach(function (q) { if (q.label) have[q.label] = (have[q.label] || 0) + 1; });
    });
    var html = '<button class="fbtn' + (cur === 'all' ? ' on' : '') + '" data-l="all">全部考点</button>';
    QLABELS.forEach(function (l) {
      if (!have[l]) return;
      html += '<button class="fbtn' + (cur === l ? ' on' : '') + '" data-l="' + esc(l) + '">' + esc(l) + '（' + have[l] + '）</button>';
    });
    Object.keys(have).forEach(function (l) { // 非词表内的标签（自定义导入）也给出入口
      if (QLABELS.indexOf(l) >= 0) return;
      html += '<button class="fbtn' + (cur === l ? ' on' : '') + '" data-l="' + esc(l) + '">' + esc(l) + '（' + have[l] + '）</button>';
    });
    return html;
  }

  function setCardHTML(s, d, customs) {
    var t = typeInfo(s.typeKey);
    var bestRec = null;
    (d.history || []).forEach(function (r) {
      if (r.setId !== s.id || !r.t) return;
      if (!bestRec || r.c / r.t > bestRec.c / r.t) bestRec = r;
    });
    var best = bestRec ? '最好成绩 ' + bestRec.c + '/' + bestRec.t : '';
    var wn = 0;
    if (d.wrong) Object.keys(d.wrong).forEach(function (qid) { if (qid.indexOf(s.id + ':') === 0) wn++; });
    var isCustom = customs.some(function (c) { return c.id === s.id; });
    return '<div class="card setcard" data-id="' + esc(s.id) + '">' +
      '<h3>' + esc(s.title) + '</h3>' +
      '<div class="meta"><span class="badge">' + t.label + '</span>' +
      (s.source ? '<a class="badge gray" ' + (s.sourceUrl ? 'href="' + safeUrl(s.sourceUrl) + '" target="_blank" rel="noopener"' : '') + ' onclick="event.stopPropagation()">来源：' + esc(s.source) + '</a>' : '<span class="badge gray">' + (isCustom ? '自定义导入' : t.no) + '</span>') +
      '<span class="badge gray">' + s.questions.length + ' 問 · 建议 ' + (s.minutes || 3) + ' 分钟</span>' +
      (wn ? '<span class="badge red">错题 ' + wn + '</span>' : '') +
      '</div>' + (best ? '<div class="best">' + best + '</div>' : '') +
      '</div>';
  }

  /* 折叠分组：原生 details/summary（零依赖、file:// 可用、自带键盘操作）。
     「全部」视图按题型收纳成长列表；筛选到单一题型时保持平铺。 */
  function groupOpenMap() {
    try { return JSON.parse(localStorage.getItem(LS_GROUP)) || {}; }
    catch (e) { return {}; }
  }
  function groupedTypeHTML(byType) {
    var open = groupOpenMap();
    return TYPE_KEYS.filter(function (k) { return byType[k].length; }).map(function (k) {
      return '<details class="typegroup" data-type="' + k + '"' + (open[k] ? ' open' : '') + '>' +
        '<summary><span class="tg-label">' + typeInfo(k).label + '</span>' +
        '<span class="tg-count">' + byType[k].length + ' 组</span></summary>' +
        '<div class="tg-body">' + byType[k].join('') + '</div></details>';
    }).join('');
  }
  function wireTypeGroups(containerId) {
    document.querySelectorAll('#' + containerId + ' details.typegroup').forEach(function (det) {
      det.addEventListener('toggle', function () {
        var m = groupOpenMap();
        m[det.getAttribute('data-type')] = det.open;
        try { localStorage.setItem(LS_GROUP, JSON.stringify(m)); } catch (e) {}
      });
    });
  }

  function renderSetList() {
    var d = load();
    var sets = allSets();
    var chips = '<button class="fbtn' + (curFilter === 'all' ? ' on' : '') + '" data-f="all">全部（' + sets.length + '）</button>';
    TYPE_KEYS.forEach(function (k) {
      var n = sets.filter(function (s) { return s.typeKey === k; }).length;
      chips += '<button class="fbtn' + (curFilter === k ? ' on' : '') + '" data-f="' + k + '">' + typeInfo(k).label + '（' + n + '）</button>';
    });
    document.getElementById('filterbar').innerHTML = chips;
    document.getElementById('label-chips').innerHTML = labelChipsHTML(sets, curLabel);
    var searchEl = document.getElementById('set-search');
    if (searchEl && searchEl.value.trim() !== curQuery) searchEl.value = curQuery; // trim 后比较，输入中的尾随空格不被吞

    if (!sets.length) {
      document.getElementById('set-cards').innerHTML =
        '<div class="card" style="text-align:center;padding:48px 24px">' +
        '<h3 style="font-size:20px">题库还是空的</h3>' +
        '<p style="color:var(--muted)">题库被清空了。可在 <a href="#bank">真题·题库</a> 页重新导入题组 JSON，<br>或恢复 js/bank/ 中的内置题库。</p>' +
        '<p style="margin-top:16px"><a class="btn" href="#bank">去获取官方例题 →</a></p></div>';
      return;
    }

    // 考点筛选失效自愈：指向的标签已不在题库（题组被删/导入变更）时重置，避免不可见筛选锁死列表
    var haveLabels = {};
    sets.forEach(function (s) { s.questions.forEach(function (x) { if (x.label) haveLabels[x.label] = 1; }); });
    if (curLabel !== 'all' && !haveLabels[curLabel]) curLabel = 'all';

    // 题型 × 考点 × 标题关键词 三重筛选
    var q = curQuery.toLowerCase();
    sets = sets.filter(function (s) {
      if (curFilter !== 'all' && s.typeKey !== curFilter) return false;
      if (curLabel !== 'all' && !s.questions.some(function (x) { return x.label === curLabel; })) return false;
      if (q && s.title.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });

    if (!sets.length) {
      document.getElementById('set-cards').innerHTML =
        '<div class="card" style="text-align:center;padding:48px 24px">' +
        '<h3 style="font-size:20px">没有匹配的题组</h3>' +
        '<p style="color:var(--muted)">换个关键词，或清除考点/题型筛选再试试。</p></div>';
      return;
    }

    var customs = customSets();
    var byType = {};
    TYPE_KEYS.forEach(function (k) { byType[k] = []; });
    sets.forEach(function (s) {
      byType[s.typeKey].push(setCardHTML(s, d, customs));
    });
    document.getElementById('set-cards').innerHTML =
      curFilter === 'all' ? groupedTypeHTML(byType) : byType[curFilter].join('');
    document.getElementById('set-cards').classList.toggle('grouped', curFilter === 'all');
    wireTypeGroups('set-cards');
    document.querySelectorAll('#set-cards .setcard').forEach(function (c) {
      c.onclick = function () { startSet(c.getAttribute('data-id')); };
    });
  }

  /* =========================================================
     practice — session
     ========================================================= */
  function stopTimer() {
    if (session && session.timerId) { clearInterval(session.timerId); session.timerId = null; }
  }
  function startTimer() {
    if (session.timerId) return; // 已在计时（路由重入时防止叠加 interval）
    var tEl = document.getElementById('timer');
    tEl.style.display = '';
    session.timerId = setInterval(function () {
      if (!session) return;
      var sec = Math.floor((Date.now() - session.startTs) / 1000);
      if (session.budgetSec) {
        tEl.textContent = fmt(sec) + ' / 目标 ' + fmt(session.budgetSec);
        tEl.classList.toggle('over', sec > session.budgetSec);
      } else {
        tEl.textContent = fmt(sec);
      }
    }, 500);
  }

  function startSet(setId) {
    var s = setById(setId);
    if (!s) { toast('该题组不存在，可能已被删除', false); return; }
    stopTimer();
    session = {
      mode: 'set', setId: setId, title: s.title, regen: null,
      groups: [{ set: s, qidx: s.questions.map(function (_, i) { return i; }) }],
      answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: (s.minutes || 3) * 60
    };
    /* 会话渲染在训练页容器里：若从其他页发起（如文法库的同族题链接），需切到 #practice 才可见 */
    if (location.hash !== '#practice') {
      location.hash = '#practice'; // hashchange → route() 渲染
    } else {
      renderSession();
      showSessionView();
    }
    startTimer();
    saveDraft();
  }

  function startWrongSession(dueOnly, label) {
    var d = load();
    var qids = dueKeys(d);
    if (!d.wrong || !Object.keys(d.wrong).length) return;
    if (dueOnly && !qids.length) { toast('到期的错题都复习完了，可以练点新的', true); return; }
    var want = {};
    (dueOnly ? qids : Object.keys(d.wrong)).forEach(function (qid) { want[qid] = 1; });
    if (label) { // 错题本的考点筛选：只重练筛选出来的题
      Object.keys(want).forEach(function (qid) {
        var i = qid.lastIndexOf(':');
        var e = d.wrong[qid], s = setById(qid.slice(0, i));
        var q = s && s.questions[parseInt(qid.slice(i + 1), 10)];
        if (!q || q.label !== label) delete want[qid];
      });
    }
    var bySet = {};
    Object.keys(d.wrong).forEach(function (qid) {
      if (!want[qid]) return;
      var i = qid.lastIndexOf(':');
      var sid = qid.slice(0, i);
      (bySet[sid] = bySet[sid] || []).push(parseInt(qid.slice(i + 1), 10));
    });
    var groups = Object.keys(bySet).map(function (sid) {
      var s = setById(sid);
      if (!s) return null;
      var qidx = bySet[sid].filter(function (qi) { return qi < s.questions.length; });
      return qidx.length ? { set: s, qidx: qidx.sort(function (a, b) { return a - b; }) } : null;
    }).filter(Boolean);
    if (!groups.length) { toast(label ? '筛选的错题没有可重练的题' : '错题对应的题组已不存在，建议清空错题本', false); return; }
    stopTimer();
    var totalW = groups.reduce(function (n, g) { return n + g.qidx.length; }, 0);
    session = { mode: 'wrong', title: (dueOnly ? '到期复习（' : label ? '定向重练 · ' + label + '（' : '错题重练（') + totalW + ' 题）', regen: null, groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(), budgetSec: 0 };
    /* 会话渲染在训练页容器里：若当前在别的路由（如错题本页），需切到 #practice 才可见 */
    if (location.hash !== '#practice') {
      location.hash = '#practice'; // hashchange → route() 渲染
    } else {
      renderSession();
      showSessionView();
    }
    startTimer();
    saveDraft();
  }

  /* 随机混合：从全部题组抽 N 问（同题组的题归并渲染，文章只出现一次） */
  function startMixSession(count) {
    var pool = [];
    allSets().forEach(function (s) {
      s.questions.forEach(function (_, qi) { pool.push({ set: s, qi: qi }); });
    });
    if (!pool.length) { toast('题库为空，无法抽题', false); return; }
    shuffle(pool);
    pool = pool.slice(0, Math.min(count || 10, pool.length));
    var groups = [];
    pool.forEach(function (p) {
      var g = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].set.id === p.set.id) { g = groups[i]; break; }
      if (g) g.qidx.push(p.qi); else groups.push({ set: p.set, qidx: [p.qi] });
    });
    stopTimer();
    session = {
      mode: 'mix', title: '随机混合 ' + pool.length + ' 問', regen: { kind: 'mix', count: count || 10 },
      groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: pool.length * 90
    };
    renderSession();
    showSessionView();
    startTimer();
    saveDraft();
  }

  /* 模拟卷：按官方大题构成（問題7〜9）抽题组卷，全局计时 */
  function startMockSession() {
    var groups = [], budget = 0, total = 0;
    MOCK_BLUEPRINT.forEach(function (bp) {
      var pool = allSets().filter(function (s) { return s.typeKey === bp.key; });
      shuffle(pool);
      pool.slice(0, bp.sets).forEach(function (s) {
        groups.push({ set: s, qidx: s.questions.map(function (_, i) { return i; }) });
        budget += (s.minutes || 3) * 60;
        total += s.questions.length;
      });
    });
    if (!groups.length) { toast('题库为空，无法组卷', false); return; }
    stopTimer();
    session = {
      mode: 'mock', title: '模拟卷 · ' + total + ' 問', regen: { kind: 'mock' },
      groups: groups, answers: {}, qtimes: {}, submitted: false, startTs: Date.now(),
      budgetSec: budget
    };
    renderSession();
    showSessionView();
    startTimer();
    saveDraft();
  }

  function redoSession() {
    if (session.regen) {
      session.regen.kind === 'mock' ? startMockSession() : startMixSession(session.regen.count);
    } else if (session.mode === 'wrong') {
      startWrongSession();
    } else {
      startSet(session.setId);
    }
  }

  function renderSession() {
    if (!session.submitted) { // 新开/重做会话时清掉上一组的分数显示
      var rb = document.getElementById('session-result');
      rb.innerHTML = '';
      rb.className = 'big';
    }
    var sigOn = document.getElementById('sig-toggle').checked; // 开关状态：喂给 passageHTML（曾因"从未读取"被误删）
    var body = '';
    var qnNo = 0; // 混合/模拟卷模式下按顺序重新编号
    var hayCache = {}; // gi → 原文纯文本（解析引用匹配用）
    session.groups.forEach(function (g, gi) {
      var s = g.set, t = typeInfo(s.typeKey);
      hayCache[gi] = ((s.passageA || '') + (s.passageB || '') + (s.passage || '')).replace(/[⟪⟫\s]/g, '');
      body += '<div class="card" style="padding:14px 18px"><h3 style="margin:0;font-size:16px">' + esc(s.title) +
        ' <span class="badge" style="margin-left:8px">' + t.label + '</span>' +
        (s.source ? ' <a class="badge gray" style="margin-left:6px" href="' + safeUrl(s.sourceUrl) + '" target="_blank" rel="noopener">来源：' + esc(s.source) + '</a>' : '') +
        '</h3></div>';
      /* 形式判断/組み立て题型无 passage（句子在 q 里），只有文章の文法渲染原文卡 */
      if (s.passage || (s.passageA && s.passageB)) {
        var phtml = '<div class="passage" data-g="' + gi + '">';
        if (s.passageA) {
          phtml += '<p><span class="labelA">文A</span></p>' + passageHTML(s.passageA, sigOn);
          phtml += '<p><span class="labelA">文B</span></p>' + passageHTML(s.passageB, sigOn);
        } else {
          phtml += passageHTML(s.passage, sigOn);
        }
        phtml += '</div>';
        body += phtml;
      }
      g.qidx.forEach(function (qi) {
        var q = s.questions[qi];
        var key = s.id + ':' + qi;
        var num = (session.mode === 'mix' || session.mode === 'mock') ? (++qnNo) : (qi + 1);
        var chosen = session.answers[key];
        var opts = '';
        q.options.forEach(function (op, oi) {
          var cls = 'opt';
          if (!session.submitted) {
            if (chosen === oi) cls += ' sel';
          } else {
            cls += ' lock';
            if (oi === q.answer) cls += ' correct';
            if (chosen === oi && oi !== q.answer) cls += ' wrongpick';
          }
          opts += '<div class="' + cls + '" data-key="' + esc(key) + '" data-oi="' + oi + '"><span class="tag">' + LABELS[oi] + '</span><span>' + esc(op) + '</span></div>';
        });
        var exp = '';
        if (session.submitted) {
          var ok = chosen === q.answer;
          var headTxt = ok ? '✓ 回答正确' : (chosen == null ? '－ 未作答' : '✗ 回答错误');
          var qt = session.qtimes[key];
          exp = '<div class="explain"><div class="head ' + (ok ? 'ok' : 'ng') + '">' + headTxt + (qt != null ? '<span class="qtime">用时 ' + qt + ' 秒</span>' : '') + (q.label ? '　<span class="badge gray">' + esc(q.label) + '</span>' : '') + '</div>';
          if (q.explain && q.explain.length) {
            exp += '<ul>' + q.explain.map(function (e, i) {
              var mark = i === q.answer ? '<b style="color:var(--ok)">［正解 ' + LABELS[i] + '］</b>' : '<b>［' + LABELS[i] + '］</b>';
              var opText = String(q.options[i] || '');
              var quote = quoteIn(e, hayCache[gi]); // 解析引用可定位原文 → 可点击跳转
              return '<li' + (quote ? ' class="jq" data-g="' + gi + '" data-q="' + esc(quote) + '"' : '') + '>' +
                mark + esc(opText).slice(0, 26) + (opText.length > 26 ? '…' : '') +
                ' <span class="why">' + esc(e) + '</span>' +
                (quote ? '<span class="jump">原文 ↗</span>' : '') + '</li>';
            }).join('') + '</ul>';
          } else {
            exp += '<p style="margin:4px 0 0">正解：<b style="color:var(--ok)">' + LABELS[q.answer] + ' ' + esc(q.options[q.answer]) + '</b></p>';
          }
          exp += '</div>';
        }
        body += '<div class="qblock">' +
          '<p class="qstem"><span class="qnum">問' + num + '</span>' + esc(q.q) + '</p>' +
          '<div class="opts">' + opts + '</div>' + exp + '</div>';
      });
    });
    document.getElementById('session-body').innerHTML = body;
    document.getElementById('session-head-title').textContent = session.title;

    if (!session.submitted) {
      document.querySelectorAll('#session-body .opt').forEach(function (el) {
        el.onclick = function () {
          if (session.submitted) return;
          var key = el.getAttribute('data-key'), oi = parseInt(el.getAttribute('data-oi'), 10);
          session.answers[key] = oi;
          markTime(key);
          saveDraft();
          Array.from(el.parentElement.children).forEach(function (c) { c.classList.remove('sel'); });
          el.classList.add('sel');
          updateSubmitCount();
          markCurQ(false);
        };
      });
    }

    var acts = document.getElementById('session-actions');
    if (!session.submitted) {
      acts.innerHTML = '<button class="btn" id="btn-submit">提交答案（0/0）</button>' +
        '<button class="btn sub" id="btn-back">返回列表</button>' +
        '<span class="kbd-hint">键盘 1〜4 选择 · Enter 提交</span>';
      document.getElementById('btn-submit').onclick = submitSession;
      document.getElementById('btn-back').onclick = backToList;
      updateSubmitCount();
    } else {
      var redoLabel = session.regen ? (session.regen.kind === 'mock' ? '再考一次（重新组卷）' : '再抽一组') : (session.mode === 'wrong' ? '再练一遍错题' : '重做这一组');
      acts.innerHTML = '<button class="btn" id="btn-redo">' + redoLabel + '</button>' +
        (session.score ? '<button class="btn sub" id="btn-share">分享成绩</button>' : '') +
        '<button class="btn sub" id="btn-back">返回列表</button>';
      document.getElementById('btn-redo').onclick = redoSession;
      var sh = document.getElementById('btn-share');
      if (sh) sh.onclick = shareScoreCard;
      document.getElementById('btn-back').onclick = backToList;
    }
    if (!session.submitted) markCurQ(false);
  }

  function updateSubmitCount() {
    var totalQ = session.groups.reduce(function (n, g) { return n + g.qidx.length; }, 0);
    var b = document.getElementById('btn-submit');
    if (b) b.textContent = '提交答案（' + Object.keys(session.answers).length + '/' + totalQ + '）';
  }

  function submitSession() {
    if (session.submitted) return;
    var unanswered = session.groups.reduce(function (n, g) { return n + g.qidx.length; }, 0) - Object.keys(session.answers).length;
    if (unanswered > 0 && !confirm('还有 ' + unanswered + ' 题未作答，未作答的题将按错误记入错题本。确定提交吗？')) return;
    stopTimer();
    session.submitted = true;
    var sec = Math.floor((Date.now() - session.startTs) / 1000);
    session.score = null; // wrong 会话不计成绩
    var d = load();
    d.stats = d.stats || {}; d.history = d.history || []; d.wrong = d.wrong || {};

    var totalQ = 0, c = 0;
    var counted = session.mode !== 'wrong'; // set/mix/mock 都计入统计与历史，wrong 只记账错题
    session.groups.forEach(function (g) {
      var s = g.set;
      if (counted) d.stats[s.typeKey] = d.stats[s.typeKey] || { c: 0, t: 0 };
      g.qidx.forEach(function (qi) {
        var key = s.id + ':' + qi, q = s.questions[qi];
        var chosen = session.answers[key];
        var ok = chosen === q.answer;
        totalQ++;
        if (ok) c++;
        if (counted) {
          d.stats[s.typeKey].t++;
          if (ok) d.stats[s.typeKey].c++;
        }
        if (ok) {
          var w = d.wrong[key];
          if (w) { // 错题复习通过：推进间隔重复阶段（1d→3d→7d），第三关毕业移出
            var stage = (w.stage || 0) + 1;
            if (stage >= 3) delete d.wrong[key];
            else d.wrong[key] = { setId: s.id, chosen: chosen, ts: w.ts, stage: stage, next: Date.now() + (stage === 1 ? 3 : 7) * DAY };
          }
        } else { // 错了（含未作答）：收录/打回第一阶段，明天再来；并累计陷阱标签画像
          d.wrong[key] = { setId: s.id, chosen: chosen, ts: Date.now(), stage: 0, next: Date.now() + DAY };
          if (q.label) { d.traps = d.traps || {}; d.traps[q.label] = (d.traps[q.label] || 0) + 1; }
        }
      });
    });
    if (counted) {
      session.score = { c: c, total: totalQ, sec: sec };
      d.history.unshift({ ts: Date.now(), setId: session.setId || session.mode, title: session.title, c: c, t: totalQ, seconds: sec });
      d.history = d.history.slice(0, HISTORY_MAX);
    }
    /* 打卡日不论模式都记（到期复习当天也是练习日，streak 不能因只复习而断） */
    var today = dstr(new Date());
    if (!Array.isArray(d.days)) d.days = [];
    if (d.days.indexOf(today) < 0) d.days.unshift(today);
    if (d.days.length > 730) d.days.length = 730;
    save(d);
    clearDraft();

    var rb = document.getElementById('session-result');
    rb.innerHTML = c + '/' + totalQ + ' <span style="font-size:13px;color:var(--muted)">（' + Math.round(c / totalQ * 100) + '% · 用时 ' + fmt(sec) + '）</span>';
    rb.className = 'big ' + (c / totalQ >= 0.7 ? 'good' : 'bad');
    renderSession();
  }

  function backToList() {
    stopTimer();
    clearDraft();
    session = null;
    renderSetList();
    showSetList();
    window.scrollTo(0, 0);
  }

  /* ---------- 成绩卡分享：canvas 生成成绩图片，Web Share 优先、下载兜底 ---------- */
  function shareScoreCard() {
    if (!session || !session.score) return;
    var sc = session.score;
    var W = 900, H = 500;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    if (!ctx) { toast('此环境不支持生成成绩卡图片', false); return; }
    var display = '"M PLUS Rounded 1c", "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans JP", sans-serif';
    // 底色与边框（浅色主题配色，分享卡固定浅色保证可读）
    ctx.fillStyle = '#f2f7f9'; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 6; ctx.strokeStyle = '#1b1b26';
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.fillStyle = '#16608c'; ctx.fillRect(14, 14, W - 28, 12); // 顶部色条
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1b1b26';
    ctx.font = '700 30px ' + display;
    ctx.fillText('Kumitaku · JLPT N1 文法特訓', W / 2, 86);
    ctx.fillStyle = '#5f6470';
    ctx.font = '600 20px ' + display;
    // 超长自定义标题按像素宽截断加省略号（导入题组标题长度不设限）
    var title = String(session.title || '');
    if (ctx.measureText(title).width > W - 120) {
      while (title.length > 1 && ctx.measureText(title + '…').width > W - 120) title = title.slice(0, -1);
      title += '…';
    }
    ctx.fillText(title, W / 2, 128);
    // 大分数
    ctx.fillStyle = '#16608c';
    ctx.font = '800 110px ' + display;
    ctx.fillText(sc.c + '/' + sc.total, W / 2, 268);
    ctx.fillStyle = '#1b1b26';
    ctx.font = '700 34px ' + display;
    var pct = sc.total ? Math.round(sc.c / sc.total * 100) : 0;
    ctx.fillText('正确率 ' + pct + '% · 用时 ' + fmt(sc.sec), W / 2, 330);
    // 落款
    ctx.fillStyle = '#5f6470';
    ctx.font = '600 18px ' + display;
    ctx.fillText(fmtDate(Date.now()), W / 2, 386);
    ctx.font = '600 18px ' + display;
    ctx.fillText('文法の型、ここにあり！', W / 2, 428);
    cv.toBlob(function (blob) {
      if (!blob) { toast('成绩卡生成失败', false); return; }
      var file = new File([blob], 'kumitaku-score.png', { type: 'image/png' });
      // Web Share L2（可分享文件）优先；否则下载图片
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Kumitaku 成绩卡', text: session.title + ' ' + sc.c + '/' + sc.total })
          .then(function () { toast('成绩卡已分享'); })
          .catch(function () { /* 用户取消分享不算失败 */ });
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kumitaku-score.png';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('成绩卡已保存为图片', true);
      }
    }, 'image/png');
  }

  /* =========================================================
     review（错题本）
     ========================================================= */
  function renderReview() {
    var d = load();
    var box = document.getElementById('review-body');
    var keys = d.wrong ? Object.keys(d.wrong).sort(function (a, b) { return d.wrong[b].ts - d.wrong[a].ts; }) : [];
    var dueN = dueCount(d);
    var dueBtn = document.getElementById('btn-review-due');
    dueBtn.style.display = dueN ? '' : 'none';
    dueBtn.textContent = '复习到期错题（' + dueN + ' 题）';

    // 考点筛选 chips（按当前错题的标签计数；qid 题号取最后一个冒号后的段，兼容含冒号的自定义 id）
    var have = {};
    keys.forEach(function (qid) {
      var e = d.wrong[qid];
      var i = qid.lastIndexOf(':');
      var s = setById(qid.slice(0, i));
      if (!s) return;
      var q = s.questions[parseInt(qid.slice(i + 1), 10)];
      if (q && q.label) have[q.label] = (have[q.label] || 0) + 1;
    });
    // 考点筛选失效自愈：所指考点的错题已删光时回到「全部」，避免不可见筛选 + 「（0 题）」按钮
    if (curWrongLabel !== 'all' && !have[curWrongLabel]) curWrongLabel = 'all';

    var chips = '<button class="fbtn' + (curWrongLabel === 'all' ? ' on' : '') + '" data-wl="all">全部（' + keys.length + '）</button>';
    Object.keys(have).sort(function (a, b) { return have[b] - have[a]; }).forEach(function (l) {
      chips += '<button class="fbtn' + (curWrongLabel === l ? ' on' : '') + '" data-wl="' + esc(l) + '">' + esc(l) + '（' + have[l] + '）</button>';
    });
    var wfb = document.getElementById('wrong-filterbar');
    wfb.style.display = keys.length ? '' : 'none';
    wfb.innerHTML = chips;

    var shown = keys.filter(function (qid) {
      if (curWrongLabel === 'all') return true;
      var i = qid.lastIndexOf(':');
      var s = setById(qid.slice(0, i));
      if (!s) return false;
      var q = s.questions[parseInt(qid.slice(i + 1), 10)];
      return q && q.label === curWrongLabel;
    });

    var redoBtn = document.getElementById('btn-wrong-session');
    redoBtn.style.display = keys.length ? '' : 'none';
    redoBtn.textContent = curWrongLabel === 'all'
      ? '全部重练（答对按间隔推进）'
      : '重练筛选错题（' + shown.length + ' 题）';
    if (!keys.length) {
      box.innerHTML = '<div class="empty">错题本是空的。做错的题会自动收录，按「明天→3天后→7天后」的节奏提醒你复习，三次答对才算消灭。</div>';
      return;
    }
    var now = Date.now();
    function fmtDue(ts) {
      var dt = new Date(ts);
      return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
    }
    var rows = shown.map(function (qid) {
      var e = d.wrong[qid];
      var i = qid.lastIndexOf(':');
      var s = setById(qid.slice(0, i)); if (!s) return '';
      var qi = parseInt(qid.slice(i + 1), 10), q = s.questions[qi];
      if (!q) return '';
      var t = typeInfo(s.typeKey);
      var stageTxt = (e.next > now)
        ? '<span class="badge gray">' + fmtDue(e.next) + ' 复习</span>'
        : '<span class="badge red">今日到期</span>';
      return '<div class="wrongitem">' +
        '<span class="badge">' + t.label + '</span>' + stageTxt +
        '<span class="qt"><b>' + esc(s.title) + '</b> 問' + (qi + 1) + '　' + esc(q.q) + '<br>' +
        '<span style="color:var(--muted);font-size:13px">你的答案：' + (e.chosen == null ? '未作答' : LABELS[e.chosen]) +
        '｜正解：' + LABELS[q.answer] + '｜第 ' + ((e.stage || 0) + 1) + ' 轮</span></span>' +
        '<button class="btn sm ghost" data-del="' + esc(qid) + '">删除</button>' +
        '</div>';
    }).join('');
    box.innerHTML = shown.length
      ? '<div class="card">' + rows + '</div>' +
        '<p style="text-align:right"><button class="btn sm sub" id="btn-clear-wrong">清空错题本</button>　<button class="btn sm sub" id="btn-clear-all">清空全部记录</button></p>'
      : '<div class="empty">该考点下暂时没有错题。</div>';
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var dd = load();
        delete dd.wrong[b.getAttribute('data-del')];
        save(dd); renderReview();
      };
    });
    var cw = document.getElementById('btn-clear-wrong');
    if (cw) cw.onclick = function () {
      if (!confirm('确定清空整个错题本吗？所有错题的间隔复习进度（第几轮/下次日期）将一并丢失，且不可恢复。')) return;
      var dd = load(); dd.wrong = {}; save(dd); renderReview();
    };
    var ca = document.getElementById('btn-clear-all');
    if (ca) ca.onclick = function () {
      if (confirm('确定清空全部练习记录、错题本和统计吗？（导入的题库不受影响）')) { localStorage.removeItem(LS_KEY); renderReview(); }
    };
  }

  /* =========================================================
     bank（真题·题库页：导入/导出/管理）
     ========================================================= */
  function renderBankPage() {
    var sets = allSets();
    var customs = customSets();
    document.getElementById('bank-count').textContent = sets.length + ' 组题（其中 ' + customs.length + ' 组来自页面导入，' + (sets.length - customs.length) + ' 组来自内置题库 js/bank/）';
    var byType = {};
    TYPE_KEYS.forEach(function (k) { byType[k] = []; });
    sets.forEach(function (s) {
      var t = typeInfo(s.typeKey);
      var isCustom = customs.some(function (c) { return c.id === s.id; });
      byType[s.typeKey].push('<div class="wrongitem">' +
        '<span class="badge">' + t.label + '</span>' +
        '<span class="qt"><b>' + esc(s.title) + '</b>　' + s.questions.length + ' 問' +
        (s.source ? '　<span class="badge gray">来源：' + esc(s.source) + '</span>' : '') + '</span>' +
        (isCustom ? '<button class="btn sm ghost" data-rm="' + esc(s.id) + '">移除</button>' : '<span class="badge gray">内置</span>') +
        '</div>');
    });
    document.getElementById('bank-list').innerHTML = sets.length ? groupedTypeHTML(byType) : '<div class="empty">暂无题组</div>';
    wireTypeGroups('bank-list');
    document.querySelectorAll('#bank-list [data-rm]').forEach(function (b) {
      b.onclick = function () {
        var list = customSets().filter(function (c) { return c.id !== b.getAttribute('data-rm'); });
        saveCustom(list); renderBankPage(); toast('已移除该题组');
      };
    });
  }

  function validateSets(arr) {
    if (!Array.isArray(arr)) throw new Error('根元素必须是数组 [ ... ]');
    var seen = {};
    arr.forEach(function (s, i) {
      var at = '第 ' + (i + 1) + ' 组';
      if (!s || typeof s !== 'object') throw new Error(at + '：不是对象');
      if (!s.id) throw new Error(at + '：缺少 id');
      if (String(s.id).indexOf(':') >= 0) throw new Error(at + '：id 不能包含冒号（冒号是错题记录 set:题号 的分隔符）');
      if (TYPE_KEYS.indexOf(s.typeKey) < 0) throw new Error(at + '：typeKey 必须是 ' + TYPE_KEYS.join(' / '));
      if (!s.title) throw new Error(at + '：缺少 title');
      if (s.sourceUrl && !/^https?:\/\//i.test(s.sourceUrl)) throw new Error(at + '：sourceUrl 必须以 http(s) 开头');
      if (s.passageA || s.passageB) throw new Error(at + '：文法题库不使用 passageA/passageB（那是読解統合理解的字段）');
      if (s.typeKey === 'sho') {
        if (!s.passage) throw new Error(at + '：sho（文章の文法）缺少 passage');
        if (!~s.passage.indexOf('【一】') || !~s.passage.indexOf('【二】') || !~s.passage.indexOf('【三】') || !~s.passage.indexOf('【四】')) {
          throw new Error(at + '：sho 的 passage 需包含【一】【二】【三】【四】四个空栏标记');
        }
      } else if (s.passage) {
        throw new Error(at + '：' + s.typeKey + ' 题组不需要 passage（句子写在 q 里）');
      }
      if (!Array.isArray(s.questions) || !s.questions.length) throw new Error(at + '：questions 不能为空');
      s.questions.forEach(function (q, j) {
        var qat = at + ' 第 ' + (j + 1) + ' 题';
        if (!q.q || typeof q.q !== 'string') throw new Error(qat + '：缺少 q（题面原文）');
        if (s.typeKey === 'bun1' && q.q.indexOf('＿＿') < 0) throw new Error(qat + '：bun1 的 q 应包含 ＿＿ 空格');
        if (s.typeKey === 'kumi' && (q.q.indexOf('＿＿') < 0 || q.q.indexOf('＊') < 0)) throw new Error(qat + '：kumi 的 q 应包含 ＿＿ 空格与 ＊ 目标标记');
        if (s.typeKey === 'sho') {
          var mb = q.q.match(/【[一二三四]】/);
          if (!mb) throw new Error(qat + '：sho 的 q 应指明对应空栏（如「【一】に入れるのに…」）');
          if (!~s.passage.indexOf(mb[0])) throw new Error(qat + '：' + q.q.slice(0, 2) + ' 在 passage 中不存在');
        }
        if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error(qat + '：options 必须是 4 个');
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3 || q.answer % 1 !== 0) throw new Error(qat + '：answer 必须是 0-3 的整数');
        if (q.explain && (!Array.isArray(q.explain) || q.explain.length !== 4)) throw new Error(qat + '：explain 需与 options 等长（4 个），或留空');
      });
      if (s.typeKey === 'sho' && s.questions.length !== 4) throw new Error(at + '：sho 题组应包含 4 题（对应【一】〜【四】）');
      if (seen[s.id]) throw new Error('存在重复 id：' + s.id);
      seen[s.id] = 1;
      s.minutes = s.minutes || 3;
    });
    return arr;
  }

  function validateRecords(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('根元素必须是对象 { kind, version, data }');
    if (obj.kind !== 'kumitaku-records') throw new Error('kind 必须是 "kumitaku-records"');
    if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) throw new Error('缺少 data 字段（练习记录对象）');
    var d = obj.data;
    if (d.stats !== undefined && (typeof d.stats !== 'object' || d.stats === null)) throw new Error('data.stats 必须是对象');
    if (d.history !== undefined && !Array.isArray(d.history)) throw new Error('data.history 必须是数组');
    if (d.wrong !== undefined && (typeof d.wrong !== 'object' || d.wrong === null)) throw new Error('data.wrong 必须是对象');
    if (d.days !== undefined && !Array.isArray(d.days)) throw new Error('data.days 必须是数组（练习日期，streak 用）');
    return d;
  }

  function initBankUI() {
    var ta = document.getElementById('bank-import-text');
    var file = document.getElementById('bank-file');
    document.getElementById('btn-import').onclick = function () {
      var go = function (text) {
        try {
          var arr = validateSets(JSON.parse(text));
          var list = customSets();
          var added = 0, updated = 0;
          arr.forEach(function (s) {
            var idx = list.findIndex(function (c) { return c.id === s.id; });
            if (idx >= 0) { list[idx] = s; updated++; } else { list.push(s); added++; }
          });
          saveCustom(list);
          ta.value = '';
          if (file.value) file.value = '';
          renderBankPage();
          toast('导入成功：新增 ' + added + ' 组，覆盖 ' + updated + ' 组');
        } catch (e) {
          toast('导入失败：' + e.message, false);
        }
      };
      if (file.files && file.files[0]) {
        var fr = new FileReader();
        fr.onload = function () { go(fr.result); };
        fr.readAsText(file.files[0]);
      } else if (ta.value.trim()) {
        go(ta.value);
      } else {
        toast('请先粘贴 JSON 或选择文件', false);
      }
    };
    document.getElementById('btn-export').onclick = function () {
      var text = JSON.stringify(allSets(), null, 2);
      ta.value = text;
      toast('已导出到下方文本框，可全选复制或下载');
    };
    document.getElementById('btn-download').onclick = function () {
      downloadJSON(JSON.stringify(allSets(), null, 2), 'kumitaku-bank.json');
    };
    var ex = document.getElementById('btn-example');
    if (ex) ex.onclick = function () {
      /* 完整示例题（本站原创，可直接导入体验；字段说明见下方 JSON 格式速览） */
      ta.value = JSON.stringify([{
        id: 'my-set-1', typeKey: 'bun1', title: '示例题组 · 近义辨析（可直接导入体验，再把内容替换成你的题目）',
        source: '本站示例（替换成你的来源，如：公式問題集 Vol.1）',
        sourceUrl: 'https://www.jlpt.jp/samples/sample2018/pdf/N1G.pdf',
        minutes: 1,
        questions: [{
          q: '新しい生活を＿＿、規則正しい健康習慣を身につけたい。',
          label: '近义辨析',
          options: [
            '送るにあたって',
            '送るうちに',
            '送りがてら',
            '送ったところで',
          ],
          answer: 0,
          explain: [
            '正解。「〜にあたって」接动词辞书形，表示「在开始做某件重要事情之际」，与「新しい生活を始めるに際して心がけたい」的语境一致。',
            '【近义混同】「〜うちに」表示「在…期间／趁着…」，与句中「身につけたい」的持续意愿错位，且后续多接变化结果。',
            '【接续不合】「〜がてら」接ます形 stem，意为「顺便」，表示同时进行的次要动作，与本句「在开始之际」的语义不符。',
            '【时态肯否错位】「〜たところで」后须接否定或消极评价（〜たところで無駄だ），与「身につけたい」的积极语气冲突。',
          ]
        }]
      }], null, 2);
      toast('已填入示例题组：可直接导入体验，或把字段内容替换成你的题目');
    };

    /* AI 转录提示词复制（clipboard API 不可用时回退 execCommand） */
    var copyBtn = document.getElementById('btn-copy-prompt');
    if (copyBtn) copyBtn.onclick = function () {
      var text = document.getElementById('ai-prompt-text').textContent;
      var fallback = function () {
        var t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(t);
      };
      var done = function () { toast('提示词已复制，粘贴给任意 AI 并附上题目原文即可'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(); done(); });
      } else {
        fallback();
        done();
      }
    };

    /* 练习记录备份（导出 / 下载 / 覆盖导入） */
    var recTa = document.getElementById('rec-text');
    var recFile = document.getElementById('rec-file');
    document.getElementById('btn-rec-export').onclick = function () {
      recTa.value = JSON.stringify({ kind: 'kumitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2);
      toast('已导出练习记录到文本框');
    };
    document.getElementById('btn-rec-download').onclick = function () {
      downloadJSON(JSON.stringify({ kind: 'kumitaku-records', version: 1, exportedAt: new Date().toISOString(), data: load() }, null, 2), 'kumitaku-records.json');
    };
    document.getElementById('btn-rec-import').onclick = function () {
      var go = function (text) {
        try {
          var d = validateRecords(JSON.parse(text));
          if (!confirm('导入将整体覆盖当前的练习记录、错题本和统计，确定继续吗？')) return;
          save(d);
          recTa.value = '';
          if (recFile.value) recFile.value = '';
          renderHome();
          toast('练习记录已导入（覆盖）');
        } catch (e) {
          toast('导入失败：' + e.message, false);
        }
      };
      if (recFile.files && recFile.files[0]) {
        var fr = new FileReader();
        fr.onload = function () { go(fr.result); };
        fr.readAsText(recFile.files[0]);
      } else if (recTa.value.trim()) {
        go(recTa.value);
      } else {
        toast('请先粘贴记录 JSON 或选择文件', false);
      }
    };
  }

  /* ---------- keyboard（1〜4 选择 · Enter 提交） ---------- */
  function flatQuestions() {
    var flat = [];
    session.groups.forEach(function (g) {
      g.qidx.forEach(function (qi) { flat.push({ set: g.set, qi: qi }); });
    });
    return flat;
  }
  function firstUnanswered() {
    var flat = flatQuestions();
    for (var i = 0; i < flat.length; i++) {
      if (session.answers[flat[i].set.id + ':' + flat[i].qi] === undefined) return i;
    }
    return -1;
  }
  function motionOK() { // 系统"减少动态效果"时不做平滑滚动（CSS 侧另有全局降级）
    return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function markCurQ(scroll) {
    var blocks = document.querySelectorAll('#session-body .qblock');
    blocks.forEach(function (b) { b.classList.remove('cur'); });
    var idx = firstUnanswered();
    if (idx >= 0 && blocks[idx]) {
      blocks[idx].classList.add('cur');
      if (scroll) blocks[idx].scrollIntoView({ block: 'nearest', behavior: motionOK() ? 'smooth' : 'auto' });
    }
  }
  function onKeydown(e) {
    /* 收款码弹层打开时：Esc 关闭，其余键盘事件一律不穿透（不暗中作答） */
    var qrm = document.getElementById('qr-modal');
    if (qrm && !qrm.hidden) {
      if (e.key === 'Escape') qrm.hidden = true;
      return;
    }
    if (!session || session.submitted) return;
    /* 只在训练页为当前路由时响应：会话进行中切到其他页（session 仍存活），
       数字键/Enter 不得暗中修改后台会话的作答或触发交卷。
       判断 hash 而非 .on class：hashchange 事件落地前 class 仍是旧页，hash 已是新值 */
    if ((location.hash || '#home').replace('#', '') !== 'practice') return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter') {
      var btn = document.getElementById('btn-submit');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    var n = parseInt(e.key, 10);
    if (!(n >= 1 && n <= 4)) return;
    var idx = firstUnanswered();
    if (idx < 0) return; // 全部答完，数字键不动作（改选请直接点击选项）
    var flat = flatQuestions();
    var f = flat[idx];
    var key = f.set.id + ':' + f.qi;
    session.answers[key] = n - 1;
    markTime(key);
    saveDraft();
    var blocks = document.querySelectorAll('#session-body .qblock');
    blocks[idx].querySelectorAll('.opt').forEach(function (el, i) {
      el.classList.toggle('sel', i === n - 1);
    });
    updateSubmitCount();
    markCurQ(true);
  }

  /* =========================================================
     init
     ========================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('btn-wrong-session').onclick = function () { startWrongSession(false, curWrongLabel === 'all' ? null : curWrongLabel); };
    document.getElementById('btn-review-due').onclick = function () { startWrongSession(true); };
    document.getElementById('btn-back-top').onclick = function () { backToList(); };
    // 随机混合 / 模拟卷入口
    document.getElementById('btn-mix10').onclick = function () { startMixSession(10); };
    document.getElementById('btn-mock').onclick = function () { startMockSession(); };
    // 深色模式：头部按钮点击切换（初始 data-theme 已由 head 内联脚本定好）
    document.getElementById('theme-toggle').onclick = function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LS_THEME, next); } catch (e) {}
      applyTheme(next);
    };
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    initReaderCtl();
    initSystemTheme();
    // 投币横幅：微信选项弹收款码（面包多为链接由浏览器跳转）
    var qrModal = document.getElementById('qr-modal');
    document.getElementById('sb-wechat').addEventListener('click', function () { qrModal.hidden = false; });
    document.getElementById('qr-close').addEventListener('click', function () { qrModal.hidden = true; });
    qrModal.addEventListener('click', function (e) { if (e.target === qrModal) qrModal.hidden = true; });
    // 键盘作答：1〜4 选择、Enter 提交
    document.addEventListener('keydown', onKeydown);
    // 解析引用 → 原文定位（事件委托，重建后依然有效）
    document.getElementById('session-body').addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('li.jq') : null;
      if (!li) return;
      jumpToQuote(li.getAttribute('data-g'), li.getAttribute('data-q'));
    });
    document.getElementById('sig-toggle').addEventListener('change', function () {
      if (session) renderSession();
    });
    // 筛选按钮：事件委托，innerHTML 重建后依然有效
    document.getElementById('filterbar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.fbtn') : null;
      if (!b) return;
      curFilter = b.getAttribute('data-f');
      renderSetList();
    });
    // 考点标签筛选 + 标题搜索（同样委托；输入即时过滤）
    document.getElementById('filterbar2').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-l]') : null;
      if (!b) return;
      curLabel = b.getAttribute('data-l');
      renderSetList();
    });
    document.getElementById('set-search').addEventListener('input', function () {
      curQuery = this.value.trim();
      renderSetList();
    });
    // 错题本的考点筛选：点 chips 过滤列表，重练按钮跟随筛选结果
    document.getElementById('wrong-filterbar').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-wl]') : null;
      if (!b) return;
      curWrongLabel = b.getAttribute('data-wl');
      renderReview();
    });
    // 文法库：分类/频度筛选、搜索、背诵模式、随机抽背、掌握标记与同族题跳转
    document.getElementById('bn-cats').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-c]') : null;
      if (!b) return;
      bnCat = b.getAttribute('data-c');
      renderBunkei();
    });
    document.getElementById('bn-freq').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-f]') : null;
      if (!b) return;
      bnFreq = b.getAttribute('data-f');
      renderBunkei();
    });
    document.getElementById('bn-search').addEventListener('input', function () {
      bnQuery = this.value.trim();
      renderBunkei();
    });
    document.getElementById('bn-recite').onclick = function () {
      bnRecite = !bnRecite;
      bnReveal = {};
      document.body.classList.toggle('bn-recite', bnRecite);
      renderBunkei();
    };
    document.getElementById('bn-hide').addEventListener('change', function () {
      bnHide = this.checked;
      renderBunkei();
    });
    document.getElementById('bn-random').onclick = function () {
      var mm = bunkeiStore().m;
      var pool = bunkeiAll().filter(function (e) {
        if (mm[e.id]) return false;
        if (bnCat !== 'all' && e.cat !== bnCat) return false;
        if (bnFreq === 'high' && !e.freq) return false;
        if (bnFreq === 'norm' && e.freq) return false;
        return true;
      });
      if (!pool.length) { toast('当前筛选下没有未掌握的文法了', true); return; }
      var pick = pool[Math.floor(Math.random() * pool.length)];
      bnReveal = {};
      bnReveal[pick.id] = true;
      if (!bnRecite) { bnRecite = true; document.body.classList.add('bn-recite'); }
      renderBunkei();
      var el = document.querySelector('#bunkei-list [data-id="' + pick.id + '"]');
      if (el) el.scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' });
    };
    document.getElementById('bunkei-list').addEventListener('click', function (e) {
      var t = e.target;
      var mk = t.closest ? t.closest('[data-mk]') : null;
      if (mk) {
        var s = bunkeiStore();
        s.m[mk.getAttribute('data-mk')] = 1;
        bunkeiSave(s);
        renderBunkei();
        return;
      }
      var um = t.closest ? t.closest('[data-um]') : null;
      if (um) {
        var uid = um.getAttribute('data-um');
        var s2 = bunkeiStore();
        delete s2.m[uid];
        bunkeiSave(s2);
        bnReveal[uid] = false;
        renderBunkei();
        return;
      }
      var dr = t.closest ? t.closest('[data-drill]') : null;
      if (dr) {
        startSet(dr.getAttribute('data-drill'));
        return;
      }
      if (!bnRecite) return;
      var card = t.closest ? t.closest('.bncard') : null;
      if (!card) return;
      var cid = card.getAttribute('data-id');
      bnReveal[cid] = !bnReveal[cid];
      renderBunkei();
    });
    initBankUI();
    pruneData();
    initInstall();
    // 首屏/说明页的题库规模文案随 js/bank/ 分片自动对齐（data-bank-stat 钩子，防止静态数字过期）
    var bankAll = (typeof BANK !== 'undefined' && BANK) ? BANK : [];
    var bankQ = bankAll.reduce(function (a, s) { return a + s.questions.length; }, 0);
    document.querySelectorAll('[data-bank-stat]').forEach(function (el) {
      el.textContent = el.getAttribute('data-bank-stat') === 'sets' ? bankAll.length : bankQ;
    });
    if (loadDraft()) toast('已恢复上次未完成的练习，计时继续', true);
    route();
  });
})();
