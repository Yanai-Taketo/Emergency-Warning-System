// 信号列組み立てのテスト — 告示 第1項・第2項 (ブロック数・無信号期間・長さ)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignal } from '../src/ews/signal.js';

const dt = { year: 2026, month: 8, day: 6, hour: 13, minute: 30 };

test('開始信号の既定ブロック数: テレビ・FM=4 / 中波・短波=10', () => {
  assert.equal(buildSignal({ kind: 'start', datetime: dt }).blocks.length, 4);
  assert.equal(buildSignal({ kind: 'start', medium: 'amsw', datetime: dt }).blocks.length, 10);
});

test('終了信号の既定ブロック数: テレビ・FM=2 / 中波・短波=4', () => {
  assert.equal(buildSignal({ kind: 'end', datetime: dt }).blocks.length, 2);
  assert.equal(buildSignal({ kind: 'end', medium: 'amsw', datetime: dt }).blocks.length, 4);
});

test('開始ブロックは100ビット連接・終了ブロックは92ビットの無信号期間つき', () => {
  const start = buildSignal({ kind: 'start', datetime: dt });
  for (const b of start.blocks) {
    assert.equal(b.bits.length, 100);
    assert.equal(b.silenceBits, 0);
  }
  const end = buildSignal({ kind: 'end', datetime: dt });
  for (const b of end.blocks) {
    assert.equal(b.bits.length, 100);
    assert.equal(b.silenceBits, 92);
  }
});

test('長さ: 開始1ブロック=1.5625秒 / 終了1ブロック=3.0秒 (64bit/s)', () => {
  const start = buildSignal({ kind: 'start', blocks: 1, datetime: dt, leadSilenceSeconds: 0 });
  assert.equal(start.durationSeconds, 100 / 64);
  assert.equal(start.durationSeconds, 1.5625);
  const end = buildSignal({ kind: 'end', blocks: 1, datetime: dt, leadSilenceSeconds: 0 });
  assert.equal(end.durationSeconds, 192 / 64);
  assert.equal(end.durationSeconds, 3.0);
});

test('先頭無信号期間の既定は1秒 (告示: 1秒間以上)', () => {
  const s = buildSignal({ kind: 'start', datetime: dt });
  assert.equal(s.leadSilenceSeconds, 1);
  assert.equal(s.durationSeconds, 1 + 4 * 1.5625);
});

test('最少未満のブロック数は生成できるが belowMinimum フラグが立つ', () => {
  const s = buildSignal({ kind: 'start', blocks: 2, datetime: dt });
  assert.equal(s.blocks.length, 2);
  assert.equal(s.belowMinimum, true);
  assert.equal(buildSignal({ kind: 'start', blocks: 4, datetime: dt }).belowMinimum, false);
});

test('偶数ブロックにだけ注1・注2の日時繰り上げ/繰り下げが現れる', () => {
  const s = buildSignal({ kind: 'start', datetime: { year: 2026, month: 8, day: 6, hour: 14, minute: 5 }, blocks: 4 });
  const hours = s.blocks.map((b) => b.fields[6].value.hour);
  assert.deepEqual(hours, [14, 13, 14, 13], '奇数=送出時 / 偶数=前の時');
  const hoshi = s.blocks.map((b) => b.fields[6].value.hoshi);
  assert.deepEqual(hoshi, [0, 1, 0, 1]);
});

test('overrides: 月日・年時区分符号を任意に固定できる (検証用)', () => {
  const s = buildSignal({
    kind: 'start', datetime: { year: 2026, month: 8, day: 6, hour: 14, minute: 5 }, blocks: 4,
    overrides: { monthDay: { month: 1, day: 17, hoshi: 1 }, yearHour: { hour: 5, yearDigit: 5, hoshi: 0 } },
  });
  // 注1・注2の自動規則 (偶数ブロックの前の時) が外れ、全ブロック同一になる
  for (const b of s.blocks) {
    assert.deepEqual(b.fields[4].value, { month: 1, day: 17, hoshi: 1 });
    assert.deepEqual(b.fields[6].value, { hour: 5, year: 5, hoshi: 0 });
  }
});

test('overrides: 片方だけの指定ではもう片方は注の自動規則のまま', () => {
  const s = buildSignal({
    kind: 'start', datetime: { year: 2026, month: 8, day: 6, hour: 14, minute: 5 }, blocks: 2,
    overrides: { monthDay: { month: 3, day: 11, hoshi: 0 } },
  });
  assert.deepEqual(s.blocks[1].fields[4].value, { month: 3, day: 11, hoshi: 0 });
  assert.equal(s.blocks[1].fields[6].value.hour, 13, '年時は注2どおり偶数ブロックで前の時');
});

test('地域は名前でもビット列でも整数でも指定できる', () => {
  const byName = buildSignal({ kind: 'start', area: '東京都', datetime: dt });
  const byBits = buildSignal({ kind: 'start', area: '101010101100', datetime: dt });
  const byCode = buildSignal({ kind: 'start', area: 0xaac, datetime: dt });
  assert.equal(byName.areaBits, byBits.areaBits);
  assert.equal(byName.areaBits, byCode.areaBits);
  assert.throws(() => buildSignal({ kind: 'start', area: '未知の地域', datetime: dt }), /地域が見つかりません/);
});
