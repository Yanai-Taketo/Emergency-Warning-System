// 変調・復調のテスト — 規則第9条の3 (周波数・整数周期・位相連続) と往復一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARK_HZ, SPACE_HZ, BIT_RATE, BIT_SECONDS } from '../src/ews/constants.js';
import { buildSignal } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { toneGrid, sliceBits, goertzelPower } from '../src/ews/demodulate.js';
import { analyzeSignal } from '../src/ews/decode.js';
import { writeWav16, readWav } from '../src/ews/wav.js';

const dt = { year: 2026, month: 8, day: 6, hour: 13, minute: 30 };

test('規則第9条の3: 1ビット=15.625msは640Hzの10周期・1024Hzの16周期', () => {
  assert.equal(BIT_SECONDS, 0.015625);
  assert.equal(SPACE_HZ * BIT_SECONDS, 10);
  assert.equal(MARK_HZ * BIT_SECONDS, 16);
  assert.equal(BIT_RATE, 64);
});

test('波形はビット境界で位相連続 (隣接サンプル差が振幅×2πf/fsを超えない)', () => {
  const signal = buildSignal({ kind: 'start', blocks: 1, datetime: dt, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000, { gain: 0.7 });
  const maxStep = 0.7 * 2 * Math.PI * MARK_HZ / 48000 * 1.01;
  for (let i = 1; i < pcm.length; i++) {
    assert.ok(Math.abs(pcm[i] - pcm[i - 1]) <= maxStep, `サンプル${i}で不連続`);
  }
});

test('48kHz: 生成→復調でビット列が完全一致 (位相0)', () => {
  const signal = buildSignal({ kind: 'start', blocks: 2, datetime: dt, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const grid = toneGrid(pcm, 48000);
  const { bits } = sliceBits(grid, 0);
  const sent = signal.blocks.map((b) => b.bits).join('');
  assert.equal(bits.slice(0, sent.length), sent);
});

test('44.1kHz (非整数サンプル/ビット) でも累積ずれなく復調できる', () => {
  const signal = buildSignal({ kind: 'start', blocks: 4, datetime: dt, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 44100);
  const grid = toneGrid(pcm, 44100);
  const { bits } = sliceBits(grid, 0);
  const sent = signal.blocks.map((b) => b.bits).join('');
  assert.equal(bits.slice(0, sent.length), sent);
});

test('8kHzでも復調できる (両トーンがナイキスト以下)', () => {
  const signal = buildSignal({ kind: 'start', blocks: 1, datetime: dt, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 8000);
  const grid = toneGrid(pcm, 8000);
  const { bits } = sliceBits(grid, 0);
  assert.equal(bits.slice(0, 100), signal.blocks[0].bits);
});

test('不正なサンプリング周波数・gainは拒否される', () => {
  const signal = buildSignal({ kind: 'start', blocks: 1, datetime: dt });
  assert.throws(() => renderSignalPcm(signal, 0), /サンプリング周波数/);
  assert.throws(() => renderSignalPcm(signal, NaN), /サンプリング周波数/);
  assert.throws(() => renderSignalPcm(signal, 2000), /サンプリング周波数/, '1024Hzのナイキスト以下');
  assert.throws(() => renderSignalPcm(signal, 48000, { gain: 1.5 }), /gain/);
  assert.throws(() => renderSignalPcm(signal, 48000, { gain: -0.1 }), /gain/);
});

test('Goertzel: 純音のパワーが対象周波数で最大になる', () => {
  const sr = 48000;
  const n = 750;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = Math.sin(2 * Math.PI * MARK_HZ * i / sr);
  const pMark = goertzelPower(tone, 0, n, MARK_HZ, sr);
  const pSpace = goertzelPower(tone, 0, n, SPACE_HZ, sr);
  assert.ok(pMark > pSpace * 100);
});

test('無信号期間は波形上も振幅ゼロ (先頭・終了信号の92ビット区間)', () => {
  const signal = buildSignal({ kind: 'end', blocks: 2, datetime: dt, leadSilenceSeconds: 1 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const bit = 750; // 48000/64
  const silent = (from, to) => {
    for (let i = from; i < to; i++) if (pcm[i] !== 0) return false;
    return true;
  };
  assert.ok(silent(0, 48000), '先頭1秒の無信号期間');
  for (let k = 0; k < 2; k++) {
    const gapStart = 48000 + (k * 192 + 100) * bit;
    const gapEnd = 48000 + (k + 1) * 192 * bit;
    assert.ok(silent(gapStart, gapEnd), `ブロック${k + 1}の92ビット無信号期間`);
    assert.ok(!silent(48000 + k * 192 * bit, gapStart), `ブロック${k + 1}の符号区間は無音でない`);
  }
  // ブロック間隔はちょうど192ビット (3.0秒)
  assert.equal(pcm.length, 48000 + 2 * 192 * bit);
});

test('中波・短波の規定最少構成 (開始10/終了4ブロック) のフルパイプライン往復', () => {
  const start = buildSignal({ kind: 'start', type: 1, area: '北海道', datetime: dt, medium: 'amsw' });
  const rs = analyzeSignal(renderSignalPcm(start, 48000).pcm, 48000);
  assert.equal(rs.blocks.length, 10);
  assert.equal(rs.consensus.area.name, '北海道');
  const end = buildSignal({ kind: 'end', area: '北海道', datetime: dt, medium: 'amsw' });
  const re = analyzeSignal(renderSignalPcm(end, 48000).pcm, 48000);
  assert.equal(re.blocks.length, 4);
  assert.equal(re.consensus.classification, '終了信号');
});

test('位相同点時は軟判定マージンで最良位相が選ばれ、開始位置が正確になる', () => {
  // 位相グリッドに揃わない端数オフセットを与えても、報告される開始位置の
  // 誤差が1/8ビット (グリッド分解能) 程度に収まることを確認する
  const signal = buildSignal({ kind: 'start', type: 1, area: '福岡県', datetime: dt, blocks: 2, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const bit = 750;
  for (const off of [130, 301, 389]) {
    const shifted = new Float32Array(pcm.length + off);
    shifted.set(pcm, off);
    const r = analyzeSignal(shifted, 48000);
    assert.equal(r.consensus.totalErrors, 0, `off=${off}`);
    const delta = Math.abs(r.blocks[0].startSample - off);
    assert.ok(delta <= bit / 8 + 1, `off=${off}: 開始位置誤差${delta}サンプル (許容${bit / 8 + 1})`);
  }
});

test('WAV: 16bit書き出し→読み込みの往復で波形が一致する', () => {
  const signal = buildSignal({ kind: 'end', blocks: 1, datetime: dt, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const wav = writeWav16(pcm, 48000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  const back = readWav(wav);
  assert.equal(back.sampleRate, 48000);
  assert.equal(back.channels, 1);
  assert.equal(back.pcm.length, pcm.length);
  let maxDiff = 0;
  for (let i = 0; i < pcm.length; i++) maxDiff = Math.max(maxDiff, Math.abs(pcm[i] - back.pcm[i]));
  assert.ok(maxDiff < 1 / 0x4000, `量子化誤差が大きすぎる: ${maxDiff}`);
});

test('WAV: float32・24bit・ステレオも読める', () => {
  const sr = 48000;
  const n = 1000;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = Math.sin(2 * Math.PI * 440 * i / sr) * 0.5;

  // float32 mono を手組みする
  const f32 = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(f32);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 3, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 32, true);
  tag(36, 'data'); dv.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) dv.setFloat32(44 + i * 4, mono[i], true);
  const rf = readWav(new Uint8Array(f32));
  assert.ok(Math.abs(rf.pcm[100] - mono[100]) < 1e-6);

  // 16bit ステレオ (L=R) を手組みして、モノラル化が平均になることを確認
  const st = new ArrayBuffer(44 + n * 4);
  const dv2 = new DataView(st);
  const tag2 = (o, s) => { for (let i = 0; i < s.length; i++) dv2.setUint8(o + i, s.charCodeAt(i)); };
  tag2(0, 'RIFF'); dv2.setUint32(4, 36 + n * 4, true); tag2(8, 'WAVE');
  tag2(12, 'fmt '); dv2.setUint32(16, 16, true); dv2.setUint16(20, 1, true); dv2.setUint16(22, 2, true);
  dv2.setUint32(24, sr, true); dv2.setUint32(28, sr * 4, true); dv2.setUint16(32, 4, true); dv2.setUint16(34, 16, true);
  tag2(36, 'data'); dv2.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    const v = Math.round(mono[i] * 0x7fff);
    dv2.setInt16(44 + i * 4, v, true);
    dv2.setInt16(44 + i * 4 + 2, v, true);
  }
  const rs = readWav(new Uint8Array(st));
  assert.equal(rs.channels, 2);
  assert.ok(Math.abs(rs.pcm[100] - mono[100]) < 1e-3);
});
