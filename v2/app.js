/* UI 设计简报 v2 原型
   结构：validate（数据约定校验）→ render（纯字符串模板）→ controller（展开/筛选/路由/状态）
   数据只从 ./data/ 读取演示 JSON；不连接任何服务。 */
(async function () {
  'use strict';
  const main = document.getElementById('content');
  const live = document.getElementById('live');
  const params = new URLSearchParams(location.search);
  const historyView = params.get('view') === 'history';
  const requestedDate = params.get('date');
  const demo = params.get('demo');            // slow | error | empty — 只用于演示三种状态
  const SCHEMA = 'ui-brief-v2-proposal';
  const STATUS_LABEL = {demo: '样例 · 未审核', published: '已发布'};
  const DATE_KIND = {published: '原文发布', updated: '原文更新', unknown: '原文日期未知'};

  /* ---------- 工具 ---------- */
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dot = d => d.replaceAll('-', '.');
  const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  const strs = v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim());
  const text = v => typeof v === 'string' && v.trim();
  function safeURL(v) {
    try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; }
    catch { return null; }
  }
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const href = o => { const q = new URLSearchParams(); if (o.history) q.set('view', 'history'); else if (o.date) q.set('date', o.date); if (demo) q.set('demo', demo); return q.size ? `?${q}` : './'; };

  /* ---------- 数据约定校验（对应 DATA_CONTRACT） ---------- */
  function validateCatalog(c) {
    if (!c || c.schema_version !== SCHEMA || !Array.isArray(c.issues)) throw new Error('catalog 结构不符');
    const seen = new Set();
    for (const e of c.issues) {
      if (!e || !text(e.issue_id) || !validDate(e.issue_date) || seen.has(e.issue_date) || !['demo', 'published'].includes(e.status)
        || !Number.isInteger(e.article_count) || e.article_count < 0 || !strs(e.headlines) || !strs(e.tags)) throw new Error('catalog 条目不符');
      seen.add(e.issue_date);
    }
    return {...c, issues: [...c.issues].sort((a, b) => b.issue_date.localeCompare(a.issue_date))};
  }
  function validateIssue(issue, entry) {
    if (!issue || issue.schema_version !== SCHEMA || issue.issue_id !== entry.issue_id || issue.issue_date !== entry.issue_date
      || issue.status !== entry.status || !Array.isArray(issue.articles) || issue.articles.length !== entry.article_count) throw new Error('期次与目录不一致');
    const ids = new Set();
    issue.articles = issue.articles.map(a => {
      if (!a || !/^[a-z0-9][a-z0-9-]*$/.test(a.id || '') || ids.has(a.id)) throw new Error('文章 ID 不合法');
      ids.add(a.id);
      if (!text(a.title) || !text(a.takeaway) || !text(a.summary)) throw new Error(`文章 ${a.id} 缺少标题/概述/背景`);
      if (!strs(a.key_points ?? []) || !strs(a.constraints ?? [])) throw new Error(`文章 ${a.id} 要点格式不符`);
      for (const k of ['impact', 'advice']) if (!(a[k] === null || text(a[k]))) throw new Error(`文章 ${a.id} ${k} 必须是文本或 null`);
      if (!strs(a.tags) || a.tags.length < 1) throw new Error(`文章 ${a.id} 标签缺失`);
      const s = a.source || {};
      if (!text(s.name) || !safeURL(s.url) || !text(s.original_title) || !['published', 'updated', 'unknown'].includes(s.date_kind)
        || (s.date_kind === 'unknown' ? s.date !== null : !validDate(s.date))) throw new Error(`文章 ${a.id} 来源信息不符`);
      if (!['ready', 'needs_review', 'insufficient_source'].includes(a.analysis_status)) throw new Error(`文章 ${a.id} 分析状态不符`);
      return {...a, key_points: a.key_points ?? [], constraints: a.constraints ?? [], tags: [...new Set(a.tags.map(t => t.trim()))], source: {...s, url: safeURL(s.url)}};
    });
    return issue;                                   // 顺序原样保留：数组顺序就是展示顺序
  }

  /* ---------- 读取 ---------- */
  async function getJSON(path) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
    try {
      if (demo === 'slow') await new Promise(r => setTimeout(r, 2200));
      if (demo === 'error') throw new Error('demo error');
      const res = await fetch(path, {cache: 'no-store', signal: ctl.signal});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /* ---------- 渲染 ---------- */
  function sourceDateLabel(s) { return s.date_kind === 'unknown' ? DATE_KIND.unknown : `${DATE_KIND[s.date_kind]} ${dot(s.date)}`; }
  function head(issue, entry, dated) {
    const label = STATUS_LABEL[issue.status];
    return `${dated ? `<div class="ctx"><a href="${esc(href({history: true}))}">← 返回历史</a><a href="${esc(href({}))}">查看最新一期</a></div>` : ''}
    <section class="head" aria-labelledby="page-title">
      <div><h1 id="page-title">${esc(issue.title)}</h1><p class="intro">${esc(issue.intro)}</p></div>
      <p class="meta"><b>本期 ${dot(issue.issue_date)}</b>${issue.articles.length} 条 · ${label}</p>
    </section>${issue.note ? `<p class="note">${esc(issue.note)}</p>` : ''}`;
  }
  function item(a, i, open) {
    return `<article class="item" id="a-${esc(a.id)}" data-i="${i}" data-open="${open}" aria-labelledby="t-${esc(a.id)}">
      <a class="src" href="${esc(a.source.url)}" target="_blank" rel="noopener noreferrer" aria-label="打开原文（新标签页）：${esc(a.source.original_title)}">${esc(host(a.source.url))} ↗</a>
      <h2 id="t-${esc(a.id)}"><button type="button" data-toggle="${i}" aria-expanded="${open}" aria-controls="detail">${esc(a.title)}</button></h2>
      <p class="takeaway">${esc(a.takeaway)}</p>
      <div class="tags" aria-label="主题标签">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <button class="open" type="button" data-toggle="${i}" aria-expanded="${open}" aria-controls="detail">${open ? '收起要点与 AI 解读 ↑' : '展开要点与 AI 解读 ↓'}</button>
    </article>`;
  }
  function detail(a) {
    const na = '<p class="na">本条未提供 AI 解读：来源资料不足或尚待复核，不编造。</p>';
    const review = a.analysis_status === 'ready' ? 'AI 解读 · 已核对' : a.analysis_status === 'insufficient_source' ? '来源不足 · 未生成解读' : 'AI 解读 · 未审核样例';
    return `<section class="detail" id="detail" role="region" aria-labelledby="d-title">
      <div class="d-head"><h3 id="d-title" tabindex="-1">${esc(a.title)}</h3><button class="close" type="button" data-close>收起 ↑</button></div>
      <div class="cols">
        <div><h4>原文要点<small>来自来源，按原文陈述</small></h4>
          <p>${esc(a.summary)}</p>
          ${a.key_points.length ? `<ul>${a.key_points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
          ${a.constraints.length ? `<div class="cond">${a.constraints.map(esc).join('<br>')}</div>` : ''}
        </div>
        <div><h4>AI 解读<small>推论，带适用条件</small></h4>
          ${a.impact || a.advice ? `${a.impact ? `<p class="sub">影响</p><p>${esc(a.impact)}</p>` : ''}${a.advice ? `<p class="sub">建议</p><p>${esc(a.advice)}</p>` : ''}` : na}
        </div>
      </div>
      <div class="d-foot"><span>${esc(a.source.name)} · ${sourceDateLabel(a.source)} · ${review}</span>
        <a class="orig" href="${esc(a.source.url)}" target="_blank" rel="noopener noreferrer" aria-label="阅读原文（新标签页）：${esc(a.source.original_title)}">阅读原文 ↗</a></div>
    </section>`;
  }
  function filterBar(tags, active) {
    if (!tags.length) return '';
    return `<div class="filter" role="group" aria-label="按主题筛选本期"><span class="lbl">主题</span>${tags.map(t => `<button type="button" data-tag="${esc(t)}" aria-pressed="${t === active}">${esc(t)}</button>`).join('')}${active ? `<button type="button" class="clear" data-tag="">清除筛选</button>` : ''}</div>`;
  }
  function state(title, body, opts = {}) {
    return `<section class="state" ${opts.alert ? 'role="alert"' : ''}><h2>${esc(title)}</h2><p>${esc(body)}</p><div class="acts">${opts.retry ? '<button type="button" id="retry">重新加载</button>' : ''}<a href="${esc(href({}))}">最新一期</a><a href="${esc(href({history: true}))}">历史</a></div></section>`;
  }
  function footer() {
    return `<footer class="foot"><p>原文要点依据来源；影响与建议为 AI 推论，请结合项目判断。</p><p class="demo">演示状态：<a href="?demo=slow">加载中</a><a href="?demo=empty">空期</a><a href="?demo=error">读取失败</a><a href="../v2/report.html">方案说明</a></p></footer>`;
  }
  function renderHistory(catalog) {
    const rows = catalog.issues.map((e, i) => `<a class="hrow" href="${esc(href({date: e.issue_date}))}"><time datetime="${e.issue_date}">${dot(e.issue_date)}${i === 0 ? '<span class="n">最新</span>' : ''}</time><div><div class="t">${e.article_count ? e.headlines.map(esc).join(' / ') : '本期无合适内容'}</div><div class="m">${e.article_count} 条 · ${STATUS_LABEL[e.status]}${e.tags.length ? ' · ' + e.tags.slice(0, 4).map(esc).join('、') : ''}</div></div><span class="arr">→</span></a>`).join('');
    return `<section class="head" aria-labelledby="page-title"><div><h1 id="page-title">历史简报</h1><p class="intro">按日期回看每一期；期次日期不等于文章日期。</p></div><p class="meta"><b>${catalog.issues.length} 期</b></p></section>
      <section class="hist">${rows || state('还没有历史简报', '发布后的期次会按日期出现在这里。')}</section>${footer()}`;
  }

  /* ---------- 期次页控制器 ---------- */
  function mountIssue(issue, catalog, entry, dated) {
    let open = null, tag = null;
    const all = issue.articles;
    const tags = [...new Set(all.flatMap(a => a.tags))];
    const idx = catalog.issues.findIndex(e => e.issue_date === issue.issue_date);
    const older = catalog.issues[idx + 1], newer = catalog.issues[idx - 1];
    const narrow = window.matchMedia('(max-width:720px)');

    function visible() { return tag ? all.filter(a => a.tags.includes(tag)) : all; }
    function render(focusTarget) {
      const list = visible();
      const cards = list.map((a, i) => item(a, i, open === i));
      if (open !== null && list[open]) {
        // 桌面：插在被选条目所在行之后（偶数索引行末为 open|1）；窄屏：紧跟该条
        const at = narrow.matches ? open : Math.min(list.length - 1, Math.floor(open / 2) * 2 + 1);
        cards.splice(at + 1, 0, detail(list[open]));
      }
      main.innerHTML = `${head(issue, entry, dated)}${filterBar(tags, tag)}
        ${all.length ? (list.length ? `<div class="grid" id="list">${cards.join('')}</div>` : `<section class="state"><h2>本期没有「${esc(tag)}」主题的内容</h2><p>换一个主题，或清除筛选查看全部。</p><div class="acts"><button type="button" data-tag="">清除筛选</button></div></section>`)
          : `<section class="state"><h2>本期没有合适的内容</h2><p>${esc(issue.note || '当天没有通过筛选的候选，不以低分文章补位。')}</p></section>`}
        ${dated && (older || newer) ? `<nav class="pager" aria-label="切换期次"><span>${older ? `<a href="${esc(href({date: older.issue_date}))}">← 上一期 ${dot(older.issue_date)}</a>` : ''}</span><span>${newer ? `<a href="${esc(href({date: newer.issue_date}))}">下一期 ${dot(newer.issue_date)} →</a>` : ''}</span></nav>` : ''}
        ${footer()}`;
      if (focusTarget === 'detail') document.getElementById('d-title')?.focus({preventScroll: false});
      else if (typeof focusTarget === 'number') main.querySelector(`.item[data-i="${focusTarget}"] .open`)?.focus();
    }
    main.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.toggle !== undefined) {
        const i = Number(t.dataset.toggle); const was = open === i; open = was ? null : i; render(was ? i : 'detail');
        live.textContent = was ? '已收起。' : `已展开：${visible()[i].title}。条目顺序不变。`;
      } else if (t.hasAttribute('data-close')) {
        const prev = open; open = null; render(prev); live.textContent = '已收起。';
      } else if (t.dataset.tag !== undefined) {
        tag = t.dataset.tag || null; open = null; render();   // 过滤后不保留已不可见文章的详情
        live.textContent = tag ? `只看「${tag}」，共 ${visible().length} 条。` : '已显示全部。';
      }
    });
    main.addEventListener('keydown', e => { if (e.key === 'Escape' && open !== null) { const prev = open; open = null; render(prev); } });
    narrow.addEventListener('change', () => render());
    render();
  }

  /* ---------- 路由 ---------- */
  main.addEventListener('click', e => { if (e.target.id === 'retry') location.reload(); });
  try {
    document.getElementById('nav-latest').href = href({});
    document.getElementById('nav-history').href = href({history: true});
    document.getElementById(historyView || requestedDate ? 'nav-history' : 'nav-latest').setAttribute('aria-current', 'page');
    if (requestedDate && !validDate(requestedDate)) { main.innerHTML = state('日期格式不正确', '请从历史页选择一期。'); return; }
    const catalog = validateCatalog(await getJSON('./data/catalog.json'));
    if (historyView) { main.innerHTML = renderHistory(catalog); document.title = '历史 · UI 设计简报'; return; }
    const entry = demo === 'empty' ? catalog.issues.find(e => e.article_count === 0) : requestedDate ? catalog.issues.find(e => e.issue_date === requestedDate) : catalog.issues[0];
    if (!entry) { main.innerHTML = state(requestedDate ? '没有这一期' : '还没有简报', requestedDate ? '这个日期没有发布记录。' : '内容准备好后会出现在这里。'); return; }
    const issue = validateIssue(await getJSON(`./data/issues/${entry.issue_date}.json`), entry);
    document.title = `${dot(issue.issue_date)} · UI 设计简报`;
    mountIssue(issue, catalog, entry, Boolean(requestedDate) || demo === 'empty');
  } catch (err) {
    main.innerHTML = state('简报暂时无法读取', location.protocol === 'file:' ? '请通过本地静态服务或网址打开，直接双击文件读不到数据。' : '可能是网络中断或数据未准备好。可以重新加载，或先看历史。', {retry: true, alert: true});
    console.warn(err);
  } finally { main.setAttribute('aria-busy', 'false'); }
})();
