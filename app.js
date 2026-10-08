import { SHEET_ID, sheetUrl } from './config.js';
import { compute, parseCSV, parseSettings } from './scoring.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEYS = ['成績', '選手', '隊伍', '設定'];

async function load() {
  const live = !!SHEET_ID;
  const urls = Object.fromEntries(KEYS.map((k) => [k, live ? sheetUrl(k) : `data/demo/${k}.csv`]));
  const texts = await Promise.all(KEYS.map(async (k) => {
    const res = await fetch(urls[k], { cache: 'no-store' });
    if (!res.ok) throw new Error(`讀取「${k}」失敗（HTTP ${res.status}）`);
    return res.text();
  }));
  const [scores, players, teams] = texts.slice(0, 3).map(parseCSV);
  const settings = parseSettings(texts[3]);
  return { live, data: { scores, players, teams, settings } };
}

const rankCell = (r) => `<div class="rank ${r <= 3 ? 'r' + r : ''}">${r <= 3 ? ['🥇', '🥈', '🥉'][r - 1] : r}</div>`;

function renderTeams(res) {
  if (!res.teams.length) return '<p class="empty">還沒有隊伍報名</p>';
  return res.teams.map((t) => `
    <div class="row">${rankCell(t.rank)}
      <div><div class="name">${esc(t.name)}${t.solo ? '<span class="tag">單人</span>' : ''}</div>
        <div class="sub">${t.breakdown.map((b) => `${esc(b.name)} ${b.total}${b.active ? '' : '（已離隊）'}`).join(' ・ ')}</div></div>
      <div class="score">${t.score}<small> 分</small></div>
    </div>`).join('');
}

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
let rookieSel = null;

function renderRookies(res) {
  if (!res.rookieMonths.length) return '<p class="empty">還沒有成績</p>';
  const cur = thisMonth();
  const sel = res.rookieMonths.find((m) => m.month === rookieSel) ?? res.rookieMonths.at(-1);
  const label = (m) => `${+m.month.slice(5)}月`;
  const chips = res.rookieMonths.map((m) => `
    <button class="chip" data-month="${m.month}" aria-pressed="${m === sel}">${label(m)}${m.month === cur ? ' ・進行中' : ''}</button>`).join('');
  const champs = res.rookieMonths.filter((m) => m.champions.length && m.month !== cur)
    .map((m) => `${label(m)}：${m.champions.map(esc).join('、')}`).join('　');
  const rows = sel.ranking.length ? sel.ranking.map((p) => `
    <div class="row">${rankCell(p.rank)}
      <div><div class="name">${esc(p.name)}<span class="tag new">新人</span>${p.rank === 1 ? `<span class="tag win">${sel.month === cur ? '目前領先' : '🏆 當月冠軍'}</span>` : ''}</div>
        <div class="sub">${esc(p.dept)}</div></div>
      <div class="score">${p.points}<small> 分</small></div>
    </div>`).join('') : '<p class="empty">這個月還沒有新人得分</p>';
  return `<p class="note">每月選出一位新人冠軍（當月積分最高、同分並列）。</p>
    ${champs ? `<p class="note">🏆 ${champs}</p>` : ''}
    <div class="chips">${chips}</div>${rows}`;
}

const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

function renderHistory(p) {
  if (!p.history.length) return '<p class="empty small">還沒有成績紀錄</p>';
  const months = Object.entries(p.months).map(([m, v]) => `${+m.slice(5)} 月 ${v} 分`).join(' ・ ');
  return `<table class="hist"><thead><tr><th>日期</th><th>等級</th><th>積分</th></tr></thead><tbody>
    ${p.history.map((h) => `<tr><td>${md(h.date)}</td><td>${esc(h.level)}</td><td>${h.pts}</td></tr>`).join('')}
    </tbody></table><p class="note">各月小計：${months}</p>`;
}

function renderPlayers(res) {
  return res.players.map((p) => `
    <details class="player">
      <summary class="row">${rankCell(p.rank)}
        <div><div class="name">${esc(p.name)}${p.rookie ? '<span class="tag new">新人</span>' : ''}</div>
          <div class="sub">${esc(p.dept)}${p.team ? ' ・ ' + esc(p.team) : ''} ・ 參與 ${p.entries} 次</div></div>
        <div class="score">${p.total}<small> 分</small></div>
      </summary>
      <div class="detail">${renderHistory(p)}</div>
    </details>`).join('') || '<p class="empty">還沒有選手</p>';
}

function show(res, live) {
  $('#teams').innerHTML = renderTeams(res);
  $('#rookies').innerHTML = renderRookies(res);
  $('#players').innerHTML = renderPlayers(res);
  $('#meta').textContent = `統計至 ${res.cutoff ?? '（未設定結算日）'}${live ? '' : ' ・ 目前顯示示範資料'}`;
  const w = $('#warnings');
  w.hidden = !res.warnings.length;
  if (res.warnings.length) {
    w.querySelector('summary').textContent = `⚠ 資料檢查：${res.warnings.length} 項提醒（幹部請看）`;
    w.querySelector('ul').innerHTML = res.warnings.map((x) => `<li>${esc(x)}</li>`).join('');
  }
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== b.dataset.tab));
}));

$('#rookies').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b || !lastResult) return;
  rookieSel = b.dataset.month;
  $('#rookies').innerHTML = renderRookies(lastResult);
});

let lastResult = null;
load().then(({ live, data }) => show((lastResult = compute(data)), live))
  .catch((e) => { $('#meta').textContent = '資料載入失敗：' + e.message; });
