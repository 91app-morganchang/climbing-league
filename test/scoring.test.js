import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, parseCSV, parseDateTime, submissionDeadline, dateKey } from '../scoring.js';

const players = [
  { 姓名: '小明', 部門: 'UPD', 首次參加日: '2026-09-01', 隊名: '飛躍隊' },
  { 姓名: '小華', 部門: 'ENG', 首次參加日: '2026-10-10', 隊名: '飛躍隊' },
  { 姓名: '阿強', 部門: 'HR', 首次參加日: '2026-10-10', 隊名: '單挑王' },
  { 姓名: '小美', 部門: 'UPD', 首次參加日: '2026-09-05', 隊名: '同部門' },
  { 姓名: '阿德', 部門: 'UPD', 首次參加日: '2026-09-05', 隊名: '同部門' },
];
const teams = [
  { 隊名: '飛躍隊', 成員1: '小明', 成員2: '小華' },
  { 隊名: '單挑王', 成員1: '阿強', 成員2: '' },
  { 隊名: '同部門', 成員1: '小美', 成員2: '阿德' },
];
const S = (活動日期, 選手, 認定等級, t = '') => ({ 活動日期, 選手, 認定等級, Slack貼文時間: t });
const run = (scores, settings = { 結算截止日期: '2026-12-31', 新人起算日: '2026-10-01' }) =>
  compute({ players, teams, scores, settings });
const team = (r, n) => r.teams.find((t) => t.name === n);

test('V0=0.5 分，V1=1 分，V3=3 分', () => {
  assert.equal(team(run([S('2026-10-10', '阿強', 'V0')]), '單挑王').score, 0.5);
  assert.equal(team(run([S('2026-10-10', '阿強', 'V1')]), '單挑王').score, 1);
  assert.equal(team(run([S('2026-10-10', '阿強', 'V0'), S('2026-10-24', '阿強', 'V0')]), '單挑王').score, 1); // 0.5 + 0.5
  assert.equal(team(run([S('2026-10-10', '阿強', 'V3')]), '單挑王').score, 3);
});

test('同人同日只取最高，與列順序無關', () => {
  for (const rows of [
    [S('2026-10-10', '小明', 'V3'), S('2026-10-10', '小明', 'V4')],
    [S('2026-10-10', '小明', 'V4'), S('2026-10-10', '小明', 'V3')],
  ]) assert.equal(team(run(rows), '飛躍隊').score, 4);
});

test('不同日期累計，隊伍為兩人相加', () => {
  const r = run([S('2026-10-10', '小明', 'V4'), S('2026-10-24', '小明', 'V2'), S('2026-10-10', '小華', 'V1')]);
  assert.equal(team(r, '飛躍隊').score, 4 + 2 + 1);
});

test('逾期不計分並產生警告；週一中午前有效', () => {
  const r = run([S('2026-10-10', '阿強', 'V5', '2026-10-12 12:01'), S('2026-10-24', '阿強', 'V2', '2026-10-26 12:00')]);
  assert.equal(team(r, '單挑王').score, 2);
  assert.ok(r.warnings.some((w) => w.includes('逾期')));
});

test('上傳期限：下週一 12:00', () => {
  assert.equal(dateKey(submissionDeadline(parseDateTime('2026-10-12'))), '2026-10-19'); // 週一
  assert.equal(dateKey(submissionDeadline(parseDateTime('2026-10-11'))), '2026-10-12'); // 週日
  assert.equal(dateKey(submissionDeadline(parseDateTime('2026-10-10'))), '2026-10-12'); // 週六
  assert.equal(dateKey(submissionDeadline(parseDateTime('2026-12-30'))), '2027-01-04'); // 跨年
});

test('超過結算截止日的成績不計', () => {
  const rows = [S('2026-10-10', '阿強', 'V2'), S('2026-11-14', '阿強', 'V5')];
  assert.equal(team(run(rows, { 結算截止日期: '2026-10-31', 新人起算日: '2026-10-01' }), '單挑王').score, 2);
  assert.equal(team(run(rows), '單挑王').score, 7);
});

test('單人不平均，直接累計', () => {
  const r = run([S('2026-10-10', '阿強', 'V5')]);
  assert.equal(team(r, '單挑王').score, 5);
  assert.equal(team(r, '單挑王').solo, true);
});

const month = (r, m) => r.rookieMonths.find((x) => x.month === m);

test('新人：每月各選一位冠軍，只有新人參賽', () => {
  const r = run([S('2026-10-10', '小華', 'V2'), S('2026-10-24', '小華', 'V4'), S('2026-10-10', '阿強', 'V3'),
    S('2026-11-07', '阿強', 'V5'), S('2026-10-10', '小明', 'V9')]);
  assert.deepEqual(r.rookieMonths.map((m) => m.month), ['2026-10', '2026-11']);
  assert.deepEqual(month(r, '2026-10').champions, ['小華']); // 2+4=6 > 阿強 3
  assert.equal(month(r, '2026-10').ranking[0].points, 6);
  assert.deepEqual(month(r, '2026-11').champions, ['阿強']);
  assert.ok(!r.rookieMonths.some((m) => m.ranking.some((p) => p.name === '小明'))); // 小明非新人
});

test('新人：每月積分各自計算，不跨月累計', () => {
  const r = run([S('2026-10-10', '小華', 'V5'), S('2026-11-07', '小華', 'V1'), S('2026-11-07', '阿強', 'V2')]);
  assert.deepEqual(month(r, '2026-11').champions, ['阿強']); // 小華 11 月只有 1 分
});

test('新人：同分並列冠軍；V0 也有 0.5 分可得冠軍', () => {
  const tie = run([S('2026-10-10', '小華', 'V3'), S('2026-10-10', '阿強', 'V3')]);
  assert.deepEqual(month(tie, '2026-10').champions.sort(), ['小華', '阿強'].sort());
  const low = run([S('2026-10-10', '小華', 'V0')]);
  assert.deepEqual(month(low, '2026-10').champions, ['小華']);
});

test('換夥伴：離隊者積分保留在隊上', () => {
  const t2 = [{ 隊名: '飛躍隊', 成員1: '小明', 成員2: '阿德' }];
  const p2 = players.map((p) => (p.姓名 === '阿德' ? { ...p, 隊名: '飛躍隊' } : p));
  const r = compute({ players: p2, teams: t2, scores: [S('2026-10-10', '小華', 'V4'), S('2026-10-24', '阿德', 'V1')], settings: {} });
  assert.equal(r.teams[0].score, 4 + 1);
  assert.equal(r.teams[0].breakdown.find((b) => b.name === '小華').active, false);
});

test('選手頁沒填隊名時，仍依隊伍頁的成員計分', () => {
  const p2 = players.map((p) => ({ ...p, 隊名: '' }));
  const r = compute({ players: p2, teams, scores: [S('2026-10-10', '小明', 'V4'), S('2026-10-10', '小華', 'V1')], settings: {} });
  assert.equal(r.teams.find((t) => t.name === '飛躍隊').score, 4 + 1);
});

test('同部門組隊產生警告', () => {
  assert.ok(run([]).warnings.some((w) => w.includes('同部門')));
});

test('未知選手/壞等級/壞日期 → 警告而不是崩潰', () => {
  const r = run([S('2026-10-10', '路人', 'V1'), S('2026-10-10', '阿強', 'X9'), S('亂寫', '阿強', 'V1')]);
  assert.equal(r.warnings.filter((w) => w.startsWith('成績第')).length, 3);
});

test('同分同名次', () => {
  const r = run([S('2026-10-10', '阿強', 'V4'), S('2026-10-10', '小美', 'V4')]);
  assert.deepEqual(r.teams.filter((t) => t.score === 4).map((t) => t.rank), [1, 1]);
});

test('CSV：引號、逗號、CRLF、BOM', () => {
  const rows = parseCSV('﻿姓名,備註\r\n"阿強","a,b ""c"""\r\n小明,\r\n');
  assert.deepEqual(rows, [{ 姓名: '阿強', 備註: 'a,b "c"' }, { 姓名: '小明', 備註: '' }]);
});

test('Slack 連結：保留在紀錄上；非 http(s) 連結被丟棄', () => {
  const good = { ...S('2026-10-10', '阿強', 'V2'), 'Slack訊息連結(選填)': 'https://x.slack.com/archives/C1/p1' };
  const bad = { ...S('2026-10-24', '阿強', 'V2'), 'Slack訊息連結(選填)': 'javascript:alert(1)' };
  const h = run([good, bad]).players.find((p) => p.name === '阿強').history;
  assert.equal(h[0].link, 'https://x.slack.com/archives/C1/p1');
  assert.equal(h[1].link, '');
});
