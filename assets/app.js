/* ============================================================
   共享脚本：主题 / 侧栏 / 进度条 / 顶栏跳转查词
   依赖 window.WORD_DATA（由 build.py 生成的 assets/words.js 提供）。
   无外部依赖，不联网，不上传任何数据。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 存储 ---------- */
  var MK = 'ky.words.mastery.v1';   // 已掌握词条：["cet6|abort", ...]
  var TK = 'ky.site.theme';         // light | dark

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (e) { return null; }
  }
  function lsSet(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /** 已掌握集合 -> Set("exam|word") */
  function loadMastery() {
    var raw = lsGet(MK) || [];
    var s = {};
    for (var i = 0; i < raw.length; i++) s[String(raw[i])] = 1;
    return s;
  }
  var mastery = loadMastery();

  function saveMastery() { lsSet(MK, Object.keys(mastery)); }

  /* ---------- 词库统计（进度分母） ---------- */
  var D = window.WORD_DATA || null;
  var TOTALS = { cet6: 0, ky2: 0, total: 0 };
  if (D && D.meta) {
    TOTALS.cet6 = D.meta.exams.cet6.count;
    TOTALS.ky2 = D.meta.exams.ky2.count;
    TOTALS.total = D.meta.total;
  }

  /** 某考试的已掌握/总数（按"词条出现次数"计，与词库口径一致） */
  function examProgress(exam) {
    if (!D || !D.rows) return { done: 0, all: TOTALS[exam] || 0 };
    var done = 0;
    for (var i = 0; i < D.occ.length; i++) {
      if (D.occ[i].exam === exam && mastery[D.occ[i].key]) done++;
    }
    return { done: done, all: D.meta.exams[exam].count || TOTALS[exam] || 0 };
  }

  /* ---------- 渲染进度到所有进度位 ---------- */
  var progEls = [];
  function refreshProgress() {
    var c = examProgress('cet6'), k = examProgress('ky2');
    var setC = function (sel, html) {
      var nodes = document.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) nodes[i].innerHTML = html;
    };
    setC('.st-cet6', c.done + ' / ' + c.all);
    setC('.st-ky2', k.done + ' / ' + k.all);
    setC('[data-prog-num="cet6"]', c.done + '/' + c.all);
    setC('[data-prog-num="ky2"]', k.done + '/' + k.all);
    var bars = document.querySelectorAll('[data-prog]');
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      var pct = 0;
      if (b.getAttribute('data-prog') === 'cet6') pct = c.all ? c.done / c.all : 0;
      else if (b.getAttribute('data-prog') === 'ky2') pct = k.all ? k.done / k.all : 0;
      b.style.width = (pct * 100).toFixed(1) + '%';
    }
    // 侧栏提示
    var note = document.getElementById('statNote');
    if (note) {
      note.textContent = (c.done + k.done) > 0
        ? '进度已自动保存（共 ' + (c.done + k.done) + ' 条）'
        : '进度自动保存在本机浏览器';
    }
  }

  /* ---------- 主题 ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#161513' : '#faf9f7');
    var btns = document.querySelectorAll('[data-theme-btn]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = t === 'dark' ? '☀️' : '🌙';
      btns[i].setAttribute('aria-label', t === 'dark' ? '切换为浅色' : '切换为深色');
    }
    lsSet(TK, t);
  }
  function initTheme() {
    var saved = lsGet(TK);
    if (saved !== 'light' && saved !== 'dark') {
      saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    applyTheme(saved);
  }

  /* ---------- 初始化 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    refreshProgress();

    // 主题切换
    var tb = document.querySelectorAll('[data-theme-btn]');
    for (var i = 0; i < tb.length; i++) {
      tb[i].addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      });
    }

    // 侧栏抽屉
    var nav = document.getElementById('nav');
    var scrim = document.getElementById('scrim');
    function closeNav() { if (nav) nav.classList.remove('open'); if (scrim) scrim.classList.remove('on'); }
    var menuBtn = document.getElementById('menuBtn');
    if (menuBtn && nav) menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      if (scrim) scrim.classList.toggle('on', open);
    });
    if (scrim) scrim.addEventListener('click', closeNav);
    if (nav) {
      var links = nav.querySelectorAll('a');
      for (var l = 0; l < links.length; l++) links[l].addEventListener('click', closeNav);
    }

    // 顶栏"跳转查词"
    var qj = document.getElementById('qjump');
    function jump() {
      var v = (qj.querySelector('input').value || '').trim();
      var to = 'words.html';
      if (v) to += '?q=' + encodeURIComponent(v);
      location.href = to;
    }
    if (qj) {
      var input = qj.querySelector('input');
      var go = qj.querySelector('.go');
      if (go) go.addEventListener('click', jump);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') jump(); });
      // 带词进来时预填
      var q = new URLSearchParams(location.search).get('q');
      if (q) input.value = q;
    }

    // "/" 聚焦搜索
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        var el = qj ? qj.querySelector('input') : document.getElementById('wq');
        if (el) { el.focus(); el.select(); }
      }
    });

    // 暴露给其他脚本
    window.KY = {
      mastery: mastery,
      saveMastery: saveMastery,
      refreshProgress: refreshProgress,
      totals: TOTALS,
      data: D,
      esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
    };
  });
})();
