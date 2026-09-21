/* ============================================================
   单词查询：在 1350 条词条里做即时检索
   - 英文/音标/中文释义/例句/词性/同义词 全部可搜
   - 词表、词性、掌握状态筛选 + 按批次浏览
   - 点击发音（Web Speech，英式音标用 en-GB）
   - 「已掌握」进度存在本机浏览器，清站点数据即重置
   - 抽背卡：从未掌握词里随机抽卡自测
   ============================================================ */
(function () {
  'use strict';

  var PAGE = 60;          // 每页显示条数
  var HIST_KEY = 'ky.words.history.v1';
  var D = (window.KY && window.KY.data) || window.WORD_DATA;

  if (!D || !D.rows) return;
  var META = D.meta;

  /* ---------- 工具 ---------- */
  function norm(s) {
    // 保留字母、数字、汉字与音标符号；去掉斜杠/空格/括号等排版符号
    return String(s == null ? '' : s).toLowerCase().replace(/[\s\/\(\)\[\],，。、'’-]+/g, '');
  }
  function esc(s) { return (window.KY && KY.esc) ? KY.esc(s) : String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var examName = { cet6: 'CET-6', ky2: '考研英语二' };
  var examShort = { cet6: 'CET-6', ky2: '考研二' };

  /* 预计算搜索串（一次性）。同义词/同根词也进搜索范围。 */
  var WORD_SET = {};   // 词表里有的词 —— 同义词条目能点成跳转
  for (var i = 0; i < D.rows.length; i++) {
    var r = D.rows[i];
    WORD_SET[norm(r.w)] = 1;
    var synTxt = (r.syn || []).join(' ');
    if (r.syn && r.syn.length) r.synN = synTxt;
    if (!r.hay) r.hay = norm(r.w + ' ' + r.ipa + ' ' + r.pos + ' ' + r.zh + ' ' + r.eg + ' ' + synTxt);
  }
  var ALL_ROWS = D.rows;

  /* ---------- 状态 ---------- */
  var state = {
    q: '',
    exam: 'all',        // all | cet6 | ky2 | both
    batch: 0,           // 0 = 不限批次
    pos: 'all',         // all | n | v | adj | adv | other
    st: 'all',          // all | no | yes
    sort: 'default',    // default | az | batch | pos
    shown: PAGE,
    list: [],
    sel: -1
  };

  /* ---------- 词性归类 ---------- */
  function posTag(row) {
    var p = String(row.pos || '').toLowerCase();
    if (p.indexOf('n') >= 0 && p.indexOf('v') >= 0) return 'nv';
    if (p.indexOf('v') >= 0) return 'v';
    if (p.indexOf('adj') >= 0) return 'adj';
    if (p.indexOf('adv') >= 0) return 'adv';
    if (p.indexOf('n') >= 0) return 'n';
    return 'other';
  }

  /* ---------- 发音 ---------- */
  var canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  function speak(word) {
    if (!canSpeak) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-GB';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 拼写容错：编辑距离 ---------- */
  function editDist(a, b) {
    var m = a.length, n = b.length, dp, i, j;
    if (Math.abs(m - n) > 2) return 99;
    dp = new Array(m + 1);
    for (i = 0; i <= m; i++) { dp[i] = new Array(n + 1); dp[i][0] = i; }
    for (j = 0; j <= n; j++) dp[0][j] = j;
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        var c = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
      }
    }
    return dp[m][n];
  }
  function suggestions(q) {
    if (!q || q.length < 3 || q.length > 14) return [];
    var out = [], seen = {}, ql = q.toLowerCase();
    for (var i = 0; i < ALL_ROWS.length && out.length < 6; i++) {
      var w = ALL_ROWS[i].w;
      if (Math.abs(w.length - ql.length) > 2) continue;
      if (seen[w]) continue;
      if (editDist(ql, w) <= 2) { out.push(w); seen[w] = 1; }
    }
    return out;
  }

  /* ---------- 核心：筛选 + 排序 ---------- */
  function inExam(row, ex) {
    for (var i = 0; i < row.exams.length; i++) if (row.exams[i] === ex) return true;
    return false;
  }
  function mastered(row) {
    for (var i = 0; i < row.exams.length; i++) if (window.KY.mastery[row.exams[i] + '|' + row.w]) return true;
    return false;
  }
  function posMatch(row, want) {
    if (want === 'all') return true;
    var t = posTag(row);
    if (want === 'other') return t === 'other';
    return t === want || (want === 'n' && t === 'nv');
  }
  function batchMatch(row) {
    if (!state.batch) return true;
    var b = state.batch;
    for (var i = 0; i < row.exams.length; i++) {
      var arr = row.batches[row.exams[i]];
      if (arr && arr.indexOf(b) >= 0) return true;
    }
    return false;
  }

  function scoreOf(row, q) {
    // 返回 0 表示不命中；越大越靠前
    var w = row.w.toLowerCase();
    if (w === q) return 200;
    if (w.indexOf(q) === 0) return 160;          // 前缀
    if (w.indexOf(q) >= 0) return 120;           // 单词内含
    if (norm(row.pos).indexOf(q) >= 0) return 70;
    if (norm(row.zh).indexOf(q) >= 0) return 90;  // 中文释义优先于例句
    if (norm(row.ipa).indexOf(q) >= 0) return 80;
    if (row.synN && row.synN.indexOf(q) >= 0) return 45;   // 同义词/同根词
    if (norm(row.eg).indexOf(q) >= 0) return 50;
    return 0;
  }

  function computeList() {
    var q = norm(state.q);
    var out = [];
    for (var i = 0; i < ALL_ROWS.length; i++) {
      var row = ALL_ROWS[i];
      if (state.exam === 'cet6' && !inExam(row, 'cet6')) continue;
      if (state.exam === 'ky2' && !inExam(row, 'ky2')) continue;
      if (state.exam === 'both') {
        if (!inExam(row, 'cet6') || !inExam(row, 'ky2')) continue;
      }
      if (!batchMatch(row)) continue;
      if (!posMatch(row, state.pos)) continue;
      if (state.st === 'yes' && !mastered(row)) continue;
      if (state.st === 'no' && mastered(row)) continue;
      var sc = q ? scoreOf(row, q) : 0;
      if (q && sc === 0) continue;
      out.push({ row: row, score: sc });
    }
    return sortList(out);
  }

  function sortList(list) {
    var s = state.sort;
    if (s === 'az') {
      list.sort(function (a, b) { return a.row.w < b.row.w ? -1 : a.row.w > b.row.w ? 1 : 0; });
    } else if (s === 'batch') {
      list.sort(function (a, b) { return a.row.ord - b.row.ord; });
    } else if (s === 'pos') {
      list.sort(function (a, b) {
        var ta = posTag(a.row), tb = posTag(b.row);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.row.w < b.row.w ? -1 : 1;
      });
    } else {
      list.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.row.w < b.row.w ? -1 : a.row.w > b.row.w ? 1 : a.row.ord - b.row.ord;
      });
    }
    return list;
  }

  /* ---------- 高亮 ---------- */
  function hl(text, q) {
    var plain = esc(text);
    if (!q) return plain;
    var src = String(text == null ? '' : text);
    var ql = q.toLowerCase(), parts = [], i = 0, low = src.toLowerCase();
    while (i < src.length) {
      var hit = low.indexOf(ql, i);
      if (hit < 0) { parts.push(esc(src.slice(i))); break; }
      parts.push(esc(src.slice(i, hit)));
      parts.push('<mark>' + esc(src.slice(hit, hit + ql.length)) + '</mark>');
      i = hit + ql.length;
    }
    return parts.join('');
  }

  /* ---------- 渲染 ---------- */
  var elList, elCount, elMore, elEmpty, elMeta;

  /* 同义词/同根词条目：
     纯英文 = 同义词；带 ' | ' = 同根词（左英文含词性，右中文）。
     interactive 为 true 时，词表里有的同义词渲染成可点击跳转。 */
  function synItems(row, q, interactive) {
    var s = row.syn;
    if (!s || !s.length) return '';
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var t = String(s[i] == null ? '' : s[i]).trim();
      if (!t) continue;
      var p = t.split(' | ');
      if (p.length > 1) {
        out.push('<span class="syn-rel"><span class="syn-e">' + hl(p[0], q) + '</span>'
          + '<span class="syn-z">' + hl(p[1], q) + '</span></span>');
      } else {
        var key = norm(t);
        if (interactive && key && WORD_SET[key]) {
          out.push('<button class="syn" data-goto="' + esc(t) + '" title="词表里有「' + esc(t) + '」，点这里跳过去">'
            + hl(t, q) + '</button>');
        } else {
          out.push('<span class="syn">' + hl(t, q) + '</span>');
        }
      }
    }
    return out.join('<span class="syn-sep">·</span>');
  }
  function synHTML(row, q, interactive) {
    var items = synItems(row, q, interactive);
    return items ? '<div class="wc-syn"><span class="eg-k">同义</span>' + items + '</div>' : '';
  }

  function cardHTML(item) {
    var row = item.row, q = state.q.trim();
    var mk = '';
    for (var i = 0; i < row.exams.length; i++) {
      var e = row.exams[i];
      var on = !!window.KY.mastery[e + '|' + row.w];
      mk += '<button class="mk ' + (on ? 'on' : '') + '" data-key="' + esc(e + '|' + row.w) + '"'
        + ' title="标记' + examShort[e] + (on ? ' 已掌握' : ' 未掌握') + '">'
        + esc(examShort[e]) + ' ' + (on ? '✓' : '○') + '</button>';
    }
    var src = [];
    for (var j = 0; j < row.exams.length; j++) {
      var ex = row.exams[j], arr = row.batches[ex] || [];
      for (var k = 0; k < arr.length; k++) src.push('<span class="badge ' + (ex === 'cet6' ? 'c6' : 'k2') + '">'
        + examShort[ex] + ' 第 ' + arr[k] + ' 批</span>');
    }
    return ''
      + '<article class="wc"' + (item.id === state.sel ? ' aria-selected="true"' : '') + ' data-id="' + item.id + '">'
      +   '<div class="wc-hd">'
      +     '<div class="wc-w">'
      +       '<span class="wc-word">' + hl(row.w, q) + '</span>'
      +       (canSpeak ? '<button class="spk" data-sp="' + esc(row.w) + '" title="听发音（英式）">🔊</button>' : '')
      +     '</div>'
      +     '<div class="wc-mk">' + mk + '</div>'
      +   '</div>'
      +   '<div class="wc-line1">'
      +     '<span class="ipa">' + hl(row.ipa || '—', q) + '</span>'
      +     (row.pos ? '<span class="badge pos">' + esc(row.pos) + '</span>' : '')
      +   '</div>'
      +   '<div class="wc-zh">' + hl(row.zh || '', q) + '</div>'
      +   synHTML(row, q, true)
      +   (row.eg ? '<div class="wc-eg"><span class="eg-k">例句</span>' + hl(row.eg, q) + '</div>' : '')
      +   (src.length ? '<div class="wc-src">' + src.join('') + '</div>' : '')
      + '</article>';
  }

  function renderList() {
    if (!elList) return;
    if (!state.list.length) {
      elList.innerHTML = '';
      elEmpty.classList.remove('hidden');
      elEmpty.innerHTML = emptyHTML();
      return;
    }
    elEmpty.classList.add('hidden');
    var html = '', end = Math.min(state.shown, state.list.length), i;
    for (i = 0; i < end; i++) html += cardHTML(state.list[i]);
    elList.innerHTML = html;
  }

  function emptyHTML() {
    var q = state.q.trim();
    if (q) {
      var sug = suggestions(q);
      if (sug.length) {
        var chips = sug.map(function (w) { return '<button class="chip" data-goto="' + esc(w) + '">' + esc(w) + '</button>'; }).join('');
        return '<div class="e-t">没有匹配「' + esc(q) + '」的词条</div>'
          + '<div class="e-s">你是不是要找：</div><div class="chips">' + chips + '</div>'
          + '<p class="hint" style="margin-top:14px">也可以试试搜<b>中文释义</b>（如「翻译」）、<b>同义词</b>（如 "sincere" 能搜出 cordial）、<b>音标</b>（如 /aɪ/）或<b>例句片段</b>。</p>';
      }
      return '<div class="e-t">没有匹配「' + esc(q) + '」的词条</div>'
        + '<p class="hint" style="margin-top:10px">试试更短的片段，或清空筛选条件。</p>';
    }
    return '<div class="e-t">当前筛选条件下没有词条</div><p class="hint" style="margin-top:10px">放宽词表 / 词性 / 状态条件试试。</p>';
  }

  function renderCount() {
    if (!elCount) return;
    var n = state.list.length;
    if (n === 0) { elCount.innerHTML = '0 条'; return; }
    var shown = Math.min(state.shown, n);
    elCount.innerHTML = '命中 <b>' + n + '</b> / ' + META.unique + ' 个词'
      + (n > shown ? '（显示前 ' + shown + ' 条）' : '');
  }

  function renderMore() {
    if (!elMore) return;
    var more = state.list.length > state.shown;
    elMore.classList.toggle('hidden', !more);
    if (more) elMore.innerHTML = '加载更多（还有 ' + (state.list.length - state.shown) + ' 条）';
  }

  function renderBatchBar() {
    var box = document.getElementById('batchInfo');
    if (!box) return;
    var sel = null;
    if (state.batch) {
      for (var i = 0; i < D.batches.length; i++) {
        if (D.batches[i].exam === state.exam && D.batches[i].n === state.batch) { sel = D.batches[i]; break; }
      }
    }
    if (!sel) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = '<span class="badge ' + (sel.exam === 'cet6' ? 'c6' : 'k2') + '">'
      + examName[sel.exam] + ' 第 ' + sel.n + ' 批</span>'
      + '<span class="hint">' + sel.words + ' 词 · 建议 Day ' + sel.days[0] + '–' + sel.days[sel.days.length - 1] + '</span>'
      + '<button class="btn sm" id="markBatch">本批全部标为已掌握</button>'
      + '<button class="btn sm ghost" id="unmarkBatch">本批全部取消</button>';
  }

  function renderAll() {
    renderList();
    renderCount();
    renderMore();
    renderBatchBar();
    if (window.KY && KY.refreshProgress) KY.refreshProgress();
  }

  /* ---------- 筛选控件 ---------- */
  function syncControls() {
    // 词表
    var tabs = document.querySelectorAll('[data-tab-exam]');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab-exam') === state.exam);
    // 词性 / 状态 / 排序
    var sels = ['pos', 'st', 'sort'];
    for (var s = 0; s < sels.length; s++) {
      var el = document.getElementById('f' + sels[s]);
      if (el) el.value = state[sels[s]];
    }
    // 批次网格高亮
    var bb = document.querySelectorAll('[data-batch]');
    for (var j = 0; j < bb.length; j++) {
      var m = bb[j].getAttribute('data-batch');
      var parts = m.split(':');
      bb[j].classList.toggle('on', state.batch && parts[0] === state.exam && +parts[1] === state.batch);
    }
  }

  /* ---------- URL ---------- */
  function syncURL() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.exam !== 'all') p.set('exam', state.exam);
    if (state.batch) p.set('batch', String(state.batch));
    if (state.pos !== 'all') p.set('pos', state.pos);
    if (state.st !== 'all') p.set('st', state.st);
    if (state.sort !== 'default') p.set('sort', state.sort);
    var qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function readURL() {
    var p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    var ex = p.get('exam');
    if (ex === 'cet6' || ex === 'ky2' || ex === 'both') state.exam = ex;
    var b = parseInt(p.get('batch') || '', 10);
    if (b > 0) { state.batch = b; if (!ex) state.exam = batchExamOf(b); }
    var pos = p.get('pos');
    if (pos && ['all', 'n', 'v', 'adj', 'adv', 'other'].indexOf(pos) >= 0) state.pos = pos;
    var st = p.get('st');
    if (st === 'no' || st === 'yes') state.st = st;
    var so = p.get('sort');
    if (so && ['default', 'az', 'batch', 'pos'].indexOf(so) >= 0) state.sort = so;
  }
  function batchExamOf(n) {
    for (var i = 0; i < D.batches.length; i++) if (D.batches[i].n === n) return D.batches[i].exam;
    return 'cet6';
  }

  /* ---------- 搜索历史 ---------- */
  function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { return []; } }
  function pushHist(q) {
    if (!q || q.length > 30) return;
    var h = loadHist(), i;
    for (i = 0; i < h.length; i++) if (h[i].toLowerCase() === q.toLowerCase()) { h.splice(i, 1); break; }
    h.unshift(q);
    if (h.length > 10) h = h.slice(0, 10);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (e) { /* 忽略 */ }
  }
  function renderHist() {
    var box = document.getElementById('hist');
    if (!box) return;
    var h = loadHist();
    box.classList.toggle('hidden', !h.length);
    box.innerHTML = '<span class="hist-k">最近搜索</span>' + h.map(function (w) {
      return '<button class="chip" data-goto="' + esc(w) + '">' + esc(w) + '</button>';
    }).join('');
  }

  /* ---------- 交互绑定 ---------- */
  function run(resetPage) {
    state.list = computeList();
    if (resetPage !== false) { state.shown = PAGE; state.sel = -1; }
    renderAll();
    syncURL();
  }

  function setQuery(v, keepHist) {
    state.q = v;
    var inp = document.getElementById('wq');
    if (inp) inp.value = v;
    run();
    if (keepHist && v.trim()) { pushHist(v.trim()); renderHist(); }
  }

  function bind() {
    elList = document.getElementById('wlist');
    elCount = document.getElementById('wcount');
    elMore = document.getElementById('wmore');
    elEmpty = document.getElementById('wempty');
    elMeta = document.getElementById('wmeta');

    if (elMeta) {
      elMeta.innerHTML = META.unique + ' 个词 · ' + META.total + ' 条词条 · '
        + '<span class="badge c6">CET-6 ' + META.exams.cet6.count + '</span> '
        + '<span class="badge k2">考研二 ' + META.exams.ky2.count + '</span> '
        + '· 共 ' + D.batches.length + ' 个批次';
    }

    var inp = document.getElementById('wq');
    if (inp) {
      // state.q 可能来自 ?q= 深链，此时以深链为准并写回输入框
      if (state.q) inp.value = state.q; else state.q = inp.value;
      inp.addEventListener('input', function () { state.q = inp.value; run(); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          setQuery(inp.value, true);
        } else if (e.key === 'Escape') {
          inp.value = ''; setQuery('');
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          var d = e.key === 'ArrowDown' ? 1 : -1;
          state.sel = (state.sel + d + Math.max(1, Math.min(state.shown, state.list.length)))
            % Math.max(1, Math.min(state.shown, state.list.length));
          paintSel();
        } else if (e.key === ' ' && state.sel >= 0 && state.list[state.sel]) {
          e.preventDefault();
          toggleMasteryRow(state.list[state.sel].row);
        }
      });
      var clear = document.getElementById('wclear');
      if (clear) clear.addEventListener('click', function () { setQuery(''); if (inp) inp.focus(); });
    }

    // 词表 tab
    var tabs = document.querySelectorAll('[data-tab-exam]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        state.exam = this.getAttribute('data-tab-exam');
        if (state.batch && state.exam !== 'all' && batchExamOf(state.batch) !== state.exam) state.batch = 0;
        syncControls(); run();
      });
    }
    // 下拉筛选
    var sels = ['pos', 'st', 'sort'];
    for (var s = 0; s < sels.length; s++) {
      (function (name) {
        var el = document.getElementById('f' + name);
        if (el) el.addEventListener('change', function () { state[name] = el.value; run(); });
      })(sels[s]);
    }
    // 加载更多
    if (elMore) elMore.addEventListener('click', function () { state.shown += PAGE; renderList(); renderCount(); renderMore(); });
    // 列表内的发音 / 勾选 / 建议词
    if (elList) {
      elList.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('button') : null;
        if (!t) return;
        if (t.hasAttribute('data-sp')) { speak(t.getAttribute('data-sp')); flashSpk(t); return; }
        if (t.hasAttribute('data-goto')) { setQuery(t.getAttribute('data-goto')); if (inp) inp.focus(); return; }
        if (t.hasAttribute('data-key')) {
          var parts = t.getAttribute('data-key').split('|');
          toggleKey(parts[0] + '|' + parts[1]);
          renderList();
          return;
        }
      });
    }
    var hist = document.getElementById('hist');
    if (hist) {
      hist.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-goto]') : null;
        if (!t) return;
        setQuery(t.getAttribute('data-goto'));
        if (inp) inp.focus();
      });
    }
    // 批次网格
    var grid = document.getElementById('batchGrid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('[data-batch]') : null;
        if (!t) return;
        var parts = t.getAttribute('data-batch').split(':');
        state.exam = parts[0];
        state.batch = state.batch === +parts[1] && state.exam === parts[0] ? 0 : +parts[1];
        syncControls(); run();
        var anchor = document.getElementById('resHead');
        if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    // 整批标记
    if (elList) {
      document.addEventListener('click', function (e) {
        var id = e.target && e.target.id;
        if (id !== 'markBatch' && id !== 'unmarkBatch') return;
        var on = id === 'markBatch';
        for (var i = 0; i < D.occ.length; i++) {
          var o = D.occ[i];
          if (o.exam === state.exam && o.batch === state.batch) {
            if (on) window.KY.mastery[o.key] = 1; else delete window.KY.mastery[o.key];
          }
        }
        window.KY.saveMastery();
        run(false);
      });
    }
    // 随机抽词
    var rnd = document.getElementById('randBtn');
    if (rnd) rnd.addEventListener('click', function () {
      var pool = ALL_ROWS;
      var w = pool[Math.floor(Math.random() * pool.length)];
      setQuery(w.w);
      speak(w.w);
      var anchor = document.getElementById('resHead');
      if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // 清空全部进度
    var reset = document.getElementById('resetProg');
    if (reset) reset.addEventListener('click', function () {
      if (!window.confirm('确定清空本机全部「已掌握」进度？此操作不可撤销。')) return;
      window.KY.mastery = {};
      window.KY.saveMastery();
      run(false);
    });
    // 抽背卡
    var drillBtn = document.getElementById('drillBtn');
    if (drillBtn) drillBtn.addEventListener('click', startDrill);
  }

  function paintSel() {
    var nodes = elList.querySelectorAll('.wc');
    for (var i = 0; i < nodes.length; i++) {
      var on = i === state.sel;
      nodes[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) nodes[i].scrollIntoView({ block: 'nearest' });
    }
  }
  function flashSpk(btn) {
    btn.classList.add('on');
    setTimeout(function () { btn.classList.remove('on'); }, 350);
  }
  function toggleKey(key) {
    if (window.KY.mastery[key]) delete window.KY.mastery[key];
    else window.KY.mastery[key] = 1;
    window.KY.saveMastery();
    window.KY.refreshProgress();
  }
  function toggleMasteryRow(row) {
    var first = row.exams[0];
    toggleKey(first + '|' + row.w);
    renderList();
  }

  /* ---------- 抽背卡 ---------- */
  var drill = { queue: [], card: null, known: 0, pool: 0 };

  function startDrill() {
    var pool = [];
    for (var i = 0; i < D.occ.length; i++) {
      var o = D.occ[i];
      if (state.exam !== 'all' && o.exam !== state.exam) continue;
      if (window.KY.mastery[o.key]) continue;
      pool.push(o);
    }
    // 去重成单词
    var seen = {}, rows = [];
    for (var j = 0; j < ALL_ROWS.length; j++) {
      var r = ALL_ROWS[j];
      if (state.exam !== 'all' && !inExam(r, state.exam)) continue;
      if (mastered(r)) continue;
      if (seen[r.w]) continue;
      seen[r.w] = 1;
      rows.push(r);
    }
    drill.pool = rows.length;
    if (!rows.length) {
      alert(state.exam === 'all' ? '全部词条都已标记为已掌握 🎉' : examName[state.exam] + ' 没有未掌握的词了 🎉');
      return;
    }
    // 打乱取 20 张
    for (var k = rows.length - 1; k > 0; k--) {
      var idx = Math.floor(Math.random() * (k + 1));
      var tmp = rows[k]; rows[k] = rows[idx]; rows[idx] = tmp;
    }
    drill.queue = rows.slice(0, Math.min(20, rows.length));
    drill.known = 0;
    drill.box = document.getElementById('drill');
    drill.box.classList.remove('hidden');
    drill.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    nextCard();
  }

  function nextCard() {
    if (!drill.queue.length) { endDrill(); return; }
    drill.card = drill.queue.shift();
    var c = drill.card;
    drill.face.classList.remove('flip');
    drill.face.innerHTML = ''
      + '<div class="face-w">' + esc(c.w) + '<button class="spk" data-sp="' + esc(c.w) + '" title="听发音">🔊</button></div>'
      + '<div class="face-hint">想好释义了吗？点击卡片翻面</div>'
      + '<div class="face-back">'
      +   '<div class="ipa">' + esc(c.ipa) + ' <span class="badge pos">' + esc(c.pos) + '</span></div>'
      +   '<div class="face-zh">' + esc(c.zh) + '</div>'
      +   synHTML(c, '', false)
      +   (c.eg ? '<div class="wc-eg"><span class="eg-k">例句</span>' + esc(c.eg) + '</div>' : '')
      +   '<div class="face-acts">'
      +     '<button class="btn ky2" id="dKnown">✓ 已掌握</button>'
      +     '<button class="btn" id="dAgain">↻ 还要练</button>'
      +   '</div>'
      + '</div>';
  }
  function endDrill() {
    if (!drill.box) return;
    drill.face.classList.remove('flip');
    drill.face.innerHTML = '<div class="e-t">本轮结束</div>'
      + '<p style="text-align:center;margin:10px 0">本轮标记掌握 <b>' + drill.known + '</b> 个词</p>'
      + '<p class="hint" style="text-align:center">当前' + (state.exam === 'all' ? '' : examName[state.exam] + ' ') + '还剩 <b>' + (drill.pool - drill.known) + '</b> 个未掌握</p>'
      + '<div style="text-align:center;margin-top:14px">'
      +   '<button class="btn pri" id="dAgain2">再来一轮</button> '
      +   '<button class="btn ghost" id="dClose">关闭</button>'
      + '</div>';
    var a2 = document.getElementById('dAgain2');
    if (a2) a2.addEventListener('click', function () { startDrill(); });
    var cl = document.getElementById('dClose');
    if (cl) cl.addEventListener('click', function () { drill.box.classList.add('hidden'); });
    if (window.KY) KY.refreshProgress();
  }
  function bindDrill() {
    var face = document.getElementById('drillFace');
    if (!face) return;
    drill.face = face;
    face.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && t.closest('#dKnown')) {
        for (var i = 0; i < drill.card.exams.length; i++) {
          window.KY.mastery[drill.card.exams[i] + '|' + drill.card.w] = 1;
        }
        window.KY.saveMastery();
        drill.known++;
        nextCard();
        renderList();
        return;
      }
      if (t.closest && t.closest('#dAgain')) {
        drill.queue.push(drill.card);
        nextCard();
        return;
      }
      if (t.closest && t.closest('[data-sp]')) {
        speak(t.closest('[data-sp]').getAttribute('data-sp'));
        return;
      }
      face.classList.toggle('flip');
    });
    var close = document.getElementById('drillClose');
    if (close) close.addEventListener('click', function () {
      var box = drill.box || document.getElementById('drill');
      if (box) box.classList.add('hidden');
    });
  }

  /* ---------- 批次网格 ---------- */
  function renderBatches() {
    var grid = document.getElementById('batchGrid');
    if (!grid) return;
    var byExam = {};
    for (var i = 0; i < D.batches.length; i++) {
      var b = D.batches[i];
      (byExam[b.exam] = byExam[b.exam] || []).push(b);
    }
    var order = ['cet6', 'ky2'];
    var html = '';
    for (var e = 0; e < order.length; e++) {
      var ex = order[e], arr = byExam[ex] || [];
      if (!arr.length) continue;
      html += '<div class="bg-t"><span class="badge ' + (ex === 'cet6' ? 'c6' : 'k2') + '">' + examName[ex]
        + ' · ' + META.exams[ex].count + ' 词 / ' + arr.length + ' 批</span></div><div class="bg">';
      for (var j = 0; j < arr.length; j++) {
        var bb = arr[j];
        var done = 0;
        for (var k = 0; k < D.occ.length; k++) {
          var o = D.occ[k];
          if (o.exam === ex && o.batch === bb.n && window.KY.mastery[o.key]) done++;
        }
        var pct = bb.words ? Math.round(done / bb.words * 100) : 0;
        html += '<button class="bt" data-batch="' + ex + ':' + bb.n + '">'
          +   '<span class="bt-n">第 ' + bb.n + ' 批</span>'
          +   '<span class="bt-m">Day ' + bb.days[0] + '–' + bb.days[bb.days.length - 1] + ' · ' + bb.words + ' 词</span>'
          +   '<span class="tr"><i style="width:' + pct + '%"></i></span>'
          +   '<span class="bt-c">' + done + '/' + bb.words + '</span>'
          + '</button>';
      }
      html += '</div>';
    }
    grid.innerHTML = html;
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    readURL();
    bind();
    bindDrill();
    renderBatches();
    renderHist();
    syncControls();
    run();
    if (state.q) {
      // 深链进来时不写历史，避免污染
      pushHist(state.q);
      renderHist();
    }
  });
})();
