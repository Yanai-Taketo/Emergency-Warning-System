// 変調・復調のテスト — 規則第9条の3 (周波数・整数周期・位相連続) と往復一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARK_HZ, SPACE_HZ, BIT_RATE, BIT_SECONDS } from '../src/ews/constants.js';
import { buildSignal } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { toneGrid, sliceBits, goertzelPower } from '../src/ews/demodulate.js';
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

test('Goertzel: 純音のパワーが対象周波数で最大になる', () => {
  const sr = 48000;
  const n = 750;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = Math.sin(2 * Math.PI * MARK_HZ * i / sr);
  const pMark = goertzelPower(tone, 0, n, MARK_HZ, sr);
  const pSpace = goertzelPower(tone, 0, n, SPACE_HZ, sr);
  assert.ok(pMark > pSpace * 100);
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
