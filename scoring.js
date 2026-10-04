// 攀岩積分賽計分邏輯：純函式，不依賴瀏覽器。

export const LEVEL_POINTS = (level) => {
  const m = /^V(\d{1,2})$/i.exec(String(level).trim());
  return m ? Number(m[1]) + 1 : null; // V0=1, V1=2 ...
};

/** 解析 CSV（支援引號、逗號、換行），回傳物件陣列（以首列為欄名）。 */
export function parseCSV(text) {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** 設定頁：每列「項目,值,…」，不需表頭。 */
export function parseSettings(text) {
  return Object.fromEntries(parseRows(text).map((r) => [r[0].trim(), (r[1] ?? '').trim()]));
}

/** 解析 CSV 成二維陣列。 */
export function parseRows(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

/** 解析 "2026-10-10"、"2026/10/10"、"2026-10-10 09:30"。無時區，皆視為本地時間。 */
export function parseDateTime(s) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(s ?? '').trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : 0, min: m[5] ? +m[5] : 0 };
}
const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
// 以 UTC 毫秒做純數字比較，避開時區與夏令時間
const ms = (p) => Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);

/** 活動日之後的下週一 12:00（活動日為週一則為再下週一）。 */
export function submissionDeadline(date) {
  const dow = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay(); // 0=日
  const iso = dow === 0 ? 7 : dow; // 週一=1 ... 週日=7
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + 8 - iso, 12, 0));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: 12, min: 0 };
}

/** 標準競賽排名：同分同名次（1,1,3）。 */
function rankBy(items, key) {
  const sorted = [...items].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'zh-Hant'));
  let prev = null, rank = 0;
  sorted.forEach((it, i) => { if (it[key] !== prev) { rank = i + 1; prev = it[key]; } it.rank = rank; });
  return sorted;
}

/**
 * @param {{players:object[], teams:object[], scores:object[], settings:Record<string,string>}} data
 */
export function compute({ players, teams, scores, settings }) {
  const warnings = [];
  const cutoff = parseDateTime(settings['結算截止日期']);
  const rookieStart = parseDateTime(settings['新人起算日']) ?? { y: 2026, m: 10, d: 1, h: 0, min: 0 };

  const playerMap = new Map();
  for (const p of players) {
    if (!p['姓名']) continue;
    if (playerMap.has(p['姓名'])) warnings.push(`選手「${p['姓名']}」重複出現`);
    const first = parseDateTime(p['首次參加日']);
    playerMap.set(p['姓名'], {
      name: p['姓名'], dept: p['部門'], team: p['隊名'],
      rookie: !!first && ms(first) >= ms(rookieStart),
      total: 0, months: {}, days: new Map(), entries: 0,
    });
  }

  const records = [];
  scores.forEach((s, i) => {
    const line = i + 2;
    const who = s['選手'], lvl = s['認定等級'] ?? s['幹部認定等級'];
    if (!who && !lvl && !s['活動日期']) return;
    const date = parseDateTime(s['活動日期']);
    const pts = LEVEL_POINTS(lvl);
    if (!playerMap.has(who)) return void warnings.push(`成績第 ${line} 列：找不到選手「${who}」`);
    if (!date) return void warnings.push(`成績第 ${line} 列：活動日期無法辨識「${s['活動日期']}」`);
    if (pts === null) return void warnings.push(`成績第 ${line} 列：等級無法辨識「${lvl}」`);
    if (cutoff && ms(date) > ms(cutoff)) return; // 超過結算截止日，不計
    const posted = parseDateTime(s['Slack貼文時間'] ?? s['Slack貼文時間(選填)']);
    if (posted && ms(posted) > ms(submissionDeadline(date))) {
      return void warnings.push(`成績第 ${line} 列：${who} ${dateKey(date)} 逾期上傳，不計分`);
    }
    records.push({ who, date: dateKey(date), month: `${date.y}-${pad(date.m)}`, pts, level: String(lvl).toUpperCase() });
  });

  // 每人每天只取最高
  for (const r of records) {
    const p = playerMap.get(r.who);
    const cur = p.days.get(r.date);
    if (!cur || r.pts > cur.pts) p.days.set(r.date, r);
  }
  for (const p of playerMap.values()) {
    p.history = [...p.days.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const r of p.history) {
      p.total += r.pts;
      p.months[r.month] = (p.months[r.month] ?? 0) + r.pts;
    }
    p.entries = p.history.length;
    p.bestMonth = Math.max(0, ...Object.values(p.months));
  }

  // 隊伍：以選手的「隊名」彙總 → 換夥伴後，離隊者積分仍保留
  const teamList = teams.filter((t) => t['隊名']).map((t) => {
    const members = [t['成員1'], t['成員2']].filter(Boolean);
    // 現任成員（隊伍頁填的）＋ 隊名欄標示屬於此隊的選手（含已離隊者，積分保留）
    const everyone = [...playerMap.values()].filter((p) => members.includes(p.name) || p.team === t['隊名']);
    for (const m of members) if (!playerMap.has(m)) warnings.push(`隊伍「${t['隊名']}」成員「${m}」不在選手名單`);
    const depts = members.map((m) => playerMap.get(m)?.dept).filter(Boolean);
    if (members.length === 2 && depts.length === 2 && depts[0] === depts[1]) {
      warnings.push(`隊伍「${t['隊名']}」兩位成員同部門（${depts[0]}），不符合組隊規定`);
    }
    return {
      name: t['隊名'], restaurant: t['餐廳'], members, solo: members.length === 1,
      score: everyone.reduce((a, p) => a + p.total, 0),
      breakdown: everyone.map((p) => ({ name: p.name, total: p.total, active: members.includes(p.name) })),
    };
  });
  for (const p of playerMap.values()) {
    if (p.team && !teams.some((t) => t['隊名'] === p.team)) warnings.push(`選手「${p.name}」的隊名「${p.team}」不在隊伍名單`);
  }

  const playerList = [...playerMap.values()].map(({ days, ...p }) => p);
  return {
    teams: rankBy(teamList, 'score'),
    rookies: rankBy(playerList.filter((p) => p.rookie).map((p) => ({ ...p })), 'bestMonth'),
    players: rankBy(playerList.map((p) => ({ ...p })), 'total'),
    months: [...new Set(records.map((r) => r.month))].sort(),
    cutoff: cutoff ? dateKey(cutoff) : null,
    warnings,
  };
}
