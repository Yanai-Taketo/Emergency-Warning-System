// ブロック構成のテスト — 告示「3 符号の構成」の表および注1・注2との照合
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlockBits, blockFields, monthDayForBlock, yearHourForBlock,
  buildAreaKubun, buildMonthDayKubun, buildYearHourKubun,
} from '../src/ews/block.js';
import { FIXED_CODE_1, FIXED_CODE_2 } from '../src/ews/constants.js';
import { findArea } from '../src/ews/area-codes.js';

const dt = { year: 2026, month: 9, day: 1, hour: 11, minute: 30 };

test('開始ブロックは100ビットで、固定符号がオフセット4/36/68にある', () => {
  const bits = buildBlockBits({ kind: 'start', type: 1, areaBits: findArea('地域共通').bits, datetime: dt });
  assert.equal(bits.length, 100);
  assert.equal(bits.slice(0, 4), '1100', '前置符号(開始)');
  assert.equal(bits.slice(4, 20), FIXED_CODE_1);
  assert.equal(bits.slice(36, 52), FIXED_CODE_1);
  assert.equal(bits.slice(68, 84), FIXED_CODE_1);
});

test('固定符号: 第一種=0000111001101101 / 第二種=1111000110010010 (全ビット反転)', () => {
  assert.equal(FIXED_CODE_1, '0000111001101101');
  assert.equal(FIXED_CODE_2, '1111000110010010');
  const inverted = [...FIXED_CODE_1].map((c) => (c === '0' ? '1' : '0')).join('');
  assert.equal(inverted, FIXED_CODE_2);
  const t2 = buildBlockBits({ kind: 'start', type: 2, areaBits: findArea('地域共通').bits, datetime: dt });
  assert.equal(t2.slice(4, 20), FIXED_CODE_2);
});

test('終了ブロックの前置符号は0011で、固定符号は第一種と同一', () => {
  const bits = buildBlockBits({ kind: 'end', areaBits: findArea('地域共通').bits, datetime: dt });
  assert.equal(bits.slice(0, 4), '0011');
  assert.equal(bits.slice(4, 20), FIXED_CODE_1);
});

test('地域区分符号: 開始 10[地域12]00 / 終了 01[地域12]11', () => {
  const tokyo = findArea('東京都').bits;
  assert.equal(buildAreaKubun('start', tokyo), `10${tokyo}00`);
  assert.equal(buildAreaKubun('end', tokyo), `01${tokyo}11`);
});

test('月日区分符号: 開始 010[日5]※[月5]00 / 終了 100[日5]※[月5]11', () => {
  // 9月1日: 日符号(1日)=10000, 月符号(9月)=10011 (告示 別表第2号・第3号)
  assert.equal(buildMonthDayKubun('start', { day: 1, month: 9, hoshi: 0 }), '010' + '10000' + '0' + '10011' + '00');
  assert.equal(buildMonthDayKubun('end', { day: 1, month: 9, hoshi: 1 }), '100' + '10000' + '1' + '10011' + '11');
});

test('年時区分符号: 開始 011[時5]※[年5]00 / 終了 101[時5]※[年5]11', () => {
  // 11時: 時符号=11001, 2026年: 年符号(下1桁6)=01101
  assert.equal(buildYearHourKubun('start', { hour: 11, year: 2026, hoshi: 0 }), '011' + '11001' + '0' + '01101' + '00');
  assert.equal(buildYearHourKubun('end', { hour: 11, year: 2026, hoshi: 1 }), '101' + '11001' + '1' + '01101' + '11');
});

test('注1: 奇数ブロックは常に送出日 (※=0)', () => {
  const md = monthDayForBlock({ year: 2026, month: 8, day: 6, hour: 0, minute: 5 }, 1);
  assert.deepEqual(md, { month: 8, day: 6, hoshi: 0 });
});

test('注1イ: 偶数ブロック・0時0分〜0時10分未満は前日 (※=1)', () => {
  const md = monthDayForBlock({ year: 2026, month: 8, day: 1, hour: 0, minute: 5 }, 2);
  assert.deepEqual(md, { month: 7, day: 31, hoshi: 1 }, '月をまたぐ前日');
});

test('注1ウ: 偶数ブロック・23時50分〜24時0分未満は翌日 (※=1)', () => {
  const md = monthDayForBlock({ year: 2026, month: 12, day: 31, hour: 23, minute: 55 }, 2);
  assert.deepEqual(md, { month: 1, day: 1, hoshi: 1 }, '年をまたぐ翌日');
});

test('注1ア: 偶数ブロック・0時10分〜23時50分未満は送出日 (※=0)', () => {
  assert.deepEqual(monthDayForBlock({ year: 2026, month: 8, day: 6, hour: 0, minute: 10 }, 2),
    { month: 8, day: 6, hoshi: 0 });
  assert.deepEqual(monthDayForBlock({ year: 2026, month: 8, day: 6, hour: 23, minute: 49 }, 2),
    { month: 8, day: 6, hoshi: 0 });
});

test('注2イ: 偶数ブロック・毎時0分〜10分未満は前の時 (※=1)', () => {
  const yh = yearHourForBlock({ year: 2026, month: 8, day: 6, hour: 14, minute: 3 }, 2);
  assert.deepEqual(yh, { hour: 13, year: 2026, hoshi: 1 });
});

test('注2ウ: 偶数ブロック・毎時50分〜60分未満は次の時 (※=1)', () => {
  const yh = yearHourForBlock({ year: 2026, month: 8, day: 6, hour: 23, minute: 55 }, 2);
  assert.deepEqual(yh, { hour: 0, year: 2026, hoshi: 1 }, '23時→翌日0時');
});

test('注2: 年をまたぐ前の時では年符号も前年になる', () => {
  const yh = yearHourForBlock({ year: 2026, month: 1, day: 1, hour: 0, minute: 5 }, 2);
  assert.deepEqual(yh, { hour: 23, year: 2025, hoshi: 1 });
});

test('注2ア: 偶数ブロック・毎時10分〜50分未満は送出時 (※=0)', () => {
  assert.deepEqual(yearHourForBlock({ year: 2026, month: 8, day: 6, hour: 14, minute: 10 }, 2),
    { hour: 14, year: 2026, hoshi: 0 });
  assert.deepEqual(yearHourForBlock({ year: 2026, month: 8, day: 6, hour: 14, minute: 49 }, 2),
    { hour: 14, year: 2026, hoshi: 0 });
});

test('blockFields: フィールドの合計が7個・100ビット', () => {
  const fields = blockFields({ kind: 'start', type: 1, areaBits: findArea('千葉県').bits, datetime: dt });
  assert.equal(fields.length, 7);
  assert.equal(fields.map((f) => f.bits).join('').length, 100);
  assert.deepEqual(fields.map((f) => f.bits.length), [4, 16, 16, 16, 16, 16, 16]);
});
