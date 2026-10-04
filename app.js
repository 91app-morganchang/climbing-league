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

function renderRookies(res) {
  if (!res.rookies.length) return '<p class="empty">還沒有新人</p>';
  return '<p class="note">依「單月最高積分」排名；括號為各月積分。</p>' + res.rookies.map((p) => `
    <div class="row">${rankCell(p.rank)}
      <div><div class="name">${esc(p.name)}<span class="tag new">新人</span></div>
        <div class="sub">${Object.entries(p.months).map(([m, v]) => `${+m.slice(5)}月 ${v}`).join(' ・ ') || '尚無成績'}</div></div>
      <div class="score">${p.bestMonth}<small> 分</small></div>
    </div>`).join('');
}

function renderPlayers(res) {
  return res.players.map((p) => `
    <div class="row">${rankCell(p.rank)}
      <div><div class="name">${esc(p.name)}${p.rookie ? '<span class="tag new">新人</span>' : ''}</div>
        <div class="sub">${esc(p.dept)}${p.team ? ' ・ ' + esc(p.team) : ''} ・ 參與 ${p.entries} 次${p.history.length ? ' ・ ' + p.history.map((h) => h.level).join(' ') : ''}</div></div>
      <div class="score">${p.total}<small> 分</small></div>
    </div>`).join('') || '<p class="empty">還沒有選手</p>';
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

load().then(({ live, data }) => show(compute(data), live))
  .catch((e) => { $('#meta').textContent = '資料載入失敗：' + e.message; });
