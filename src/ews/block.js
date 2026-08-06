// ブロック構成 — 昭和60年郵政省告示第405号「3 符号の構成」および注1・注2
//
// 1ブロック = 前置符号(4) + 固定符号(16) + 地域区分符号(16) + 固定符号(16)
//           + 月日区分符号(16) + 固定符号(16) + 年時区分符号(16) = 100ビット
//
// 符号の構成 (告示の表より):
//   地域区分符号   開始: 10 [地域符号12] 00      終了: 01 [地域符号12] 11
//   月日区分符号   開始: 010 [日符号5] ※ [月符号5] 00
//                  終了: 100 [日符号5] ※ [月符号5] 11
//   年時区分符号   開始: 011 [時符号5] ※ [年符号5] 00
//                  終了: 101 [時符号5] ※ [年符号5] 11
//
// ※ビット (注1(3)・注2(3)): 符号が信号送出の日(時)に対応する場合は0、
// その他の場合(前後の日・時に対応する場合)は1。

import {
  PREAMBLE_START, PREAMBLE_END, FIXED_CODE_1, FIXED_CODE_2, BLOCK_BITS,
} from './constants.js';
import { dayCode, monthCode, hourCode, yearCode } from './datetime-codes.js';

// datetime: { year, month, day, hour, minute } (放送時刻。日本の放送はJST)
function toUtcMs({ year, month, day, hour, minute = 0 }) {
  return Date.UTC(year, month - 1, day, hour, minute);
}

// 日時の範囲と実在性 (平年の2/29等を拒否) を検証する。
export function validateDatetime(dt) {
  const { year, month, day, hour, minute = 0 } = dt ?? {};
  const fields = [
    ['year', year, 1, 9999], ['month', month, 1, 12], ['day', day, 1, 31],
    ['hour', hour, 0, 23], ['minute', minute, 0, 59],
  ];
  for (const [name, v, min, max] of fields) {
    if (!Number.isInteger(v) || v < min || v > max) {
      throw new RangeError(`日時が不正です: ${name}=${v}`);
    }
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    throw new RangeError(`実在しない日付です: ${year}-${month}-${day}`);
  }
  return dt;
}
function fromUtcMs(ms) {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(),
  };
}

// 注1 — ブロック番号 (1始まり) に応じた月日区分符号の対象日を決める。
//   (1) 奇数番目のブロック: 信号送出の日
//   (2) 偶数番目のブロック:
//     ア 0時10分〜23時50分未満: 信号送出の日
//     イ 0時0分〜0時10分未満:   前日
//     ウ 23時50分〜24時0分未満: 翌日
//   (3) 送出の日に対応する場合 ※=0、その他 ※=1
export function monthDayForBlock(datetime, blockIndex) {
  const { hour, minute = 0 } = datetime; // minute省略時は0分 (toUtcMsと同じ既定)
  let shiftDays = 0;
  if (blockIndex % 2 === 0) {
    if (hour === 0 && minute < 10) shiftDays = -1;
    else if (hour === 23 && minute >= 50) shiftDays = 1;
  }
  const t = fromUtcMs(toUtcMs(datetime) + shiftDays * 86400_000);
  return { month: t.month, day: t.day, hoshi: shiftDays === 0 ? 0 : 1 };
}

// 注2 — ブロック番号に応じた年時区分符号の対象時を決める。
//   (1) 奇数番目のブロック: 信号送出時
//   (2) 偶数番目のブロック:
//     ア 毎時10分〜50分未満: 信号送出時
//     イ 毎時0分〜10分未満:  前の時
//     ウ 毎時50分〜60分未満: 次の時
//   (3) 送出の時に対応する場合 ※=0、その他 ※=1
// (年をまたぐ場合は年符号も前後の時刻のものになるため、日時演算で求める)
export function yearHourForBlock(datetime, blockIndex) {
  const { minute = 0 } = datetime; // minute省略時は0分 (toUtcMsと同じ既定)
  let shiftHours = 0;
  if (blockIndex % 2 === 0) {
    if (minute < 10) shiftHours = -1;
    else if (minute >= 50) shiftHours = 1;
  }
  const t = fromUtcMs(toUtcMs(datetime) + shiftHours * 3600_000);
  return { hour: t.hour, year: t.year, hoshi: shiftHours === 0 ? 0 : 1 };
}

// kind: 'start' | 'end'
export function buildAreaKubun(kind, areaBits) {
  if (!/^[01]{12}$/.test(areaBits)) throw new RangeError(`地域符号は12ビットです: ${areaBits}`);
  return kind === 'start' ? `10${areaBits}00` : `01${areaBits}11`;
}

export function buildMonthDayKubun(kind, { day, month, hoshi }) {
  const body = `${dayCode(day)}${hoshi}${monthCode(month)}`;
  return kind === 'start' ? `010${body}00` : `100${body}11`;
}

export function buildYearHourKubun(kind, { hour, year, hoshi }) {
  const body = `${hourCode(hour)}${hoshi}${yearCode(year)}`;
  return kind === 'start' ? `011${body}00` : `101${body}11`;
}

// 1ブロックを組み立てる。
//   kind: 'start' | 'end'
//   type: 1 | 2 (第一種/第二種。終了信号では固定符号は常に第一種と同一)
//   areaBits: 12ビット地域符号
//   datetime: { year, month, day, hour, minute }
//   blockIndex: 1始まりのブロック番号 (注1・注2の偶奇判定に使用)
//   overrides: 検証用の手動指定 (注1・注2の自動規則を外す)
//     { monthDay: { month, day, hoshi }, yearHour: { hour, year|yearDigit, hoshi } }
export function buildBlockBits({ kind, type = 1, areaBits, datetime, blockIndex = 1, overrides }) {
  const fields = blockFields({ kind, type, areaBits, datetime, blockIndex, overrides });
  const bits = fields.map((f) => f.bits).join('');
  if (bits.length !== BLOCK_BITS) throw new Error(`ブロック長が${bits.length}ビットです (期待: ${BLOCK_BITS})`);
  return bits;
}

// ブロックをフィールド単位に分解した配列を返す (表示・検証用)。
export function blockFields({ kind, type = 1, areaBits, datetime, blockIndex = 1, overrides }) {
  if (kind !== 'start' && kind !== 'end') throw new RangeError(`kindはstart/endです: ${kind}`);
  if (type !== 1 && type !== 2) throw new RangeError(`typeは1/2です: ${type}`);
  const fixed = (kind === 'end' || type === 1) ? FIXED_CODE_1 : FIXED_CODE_2;
  const md = normalizeMonthDay(overrides?.monthDay) ?? monthDayForBlock(datetime, blockIndex);
  const yh = normalizeYearHour(overrides?.yearHour) ?? yearHourForBlock(datetime, blockIndex);
  return [
    { name: '前置符号', bits: kind === 'start' ? PREAMBLE_START : PREAMBLE_END,
      note: kind === 'start' ? '開始信号' : '終了信号' },
    { name: '固定符号', bits: fixed,
      note: fixed === FIXED_CODE_1 ? '第一種開始信号及び終了信号' : '第二種開始信号' },
    { name: '地域区分符号', bits: buildAreaKubun(kind, areaBits),
      note: `地域符号 ${areaBits}` },
    { name: '固定符号', bits: fixed },
    { name: '月日区分符号', bits: buildMonthDayKubun(kind, md),
      note: `${md.month}月${md.day}日${md.hoshi ? ' (※=1: 送出日の前後の日)' : ''}`,
      value: md },
    { name: '固定符号', bits: fixed },
    { name: '年時区分符号', bits: buildYearHourKubun(kind, yh),
      note: `${yh.hour}時 / 年下1桁${yh.year % 10}${yh.hoshi ? ' (※=1: 送出時の前後の時)' : ''}`,
      value: yh },
  ];
}

function normalizeMonthDay(md) {
  if (!md) return null;
  return { month: md.month, day: md.day, hoshi: md.hoshi ? 1 : 0 };
}
function normalizeYearHour(yh) {
  if (!yh) return null;
  const year = yh.year ?? yh.yearDigit;
  if (year === undefined) throw new RangeError('yearHourオーバーライドにはyearかyearDigitが必要です');
  return { hour: yh.hour, year, hoshi: yh.hoshi ? 1 : 0 };
}
