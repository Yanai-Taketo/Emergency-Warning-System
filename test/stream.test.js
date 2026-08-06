// ストリーミング解析器のテスト — 一括解析との一致・チャンク分割耐性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignal } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { analyzeSignal } from '../src/ews/decode.js';
import { StreamingAnalyzer } from '../src/ews/stream.js';

const dt = { year: 2026, month: 8, day: 6, hour: 13, minute: 30 };

test('チャンク投入のストリーミング解析が一括解析と同じ結果になる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '静岡県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const batch = analyzeSignal(pcm, 48000);

  const an = new StreamingAnalyzer(48000);
  // 実際のマイク処理と同様の中途半端なチャンクサイズで投入する
  for (let i = 0; i < pcm.length; i += 1337) {
    an.push(pcm.slice(i, Math.min(i + 1337, pcm.length)));
  }
  const r = an.analyze();
  assert.equal(r.blocks.length, batch.blocks.length);
  assert.equal(r.consensus.classification, batch.consensus.classification);
  assert.equal(r.consensus.area.name, '静岡県');
  assert.equal(r.consensus.day, batch.consensus.day);
  assert.equal(r.consensus.hour, batch.consensus.hour);
  assert.equal(r.consensus.totalErrors, 0);
});

test('途中で何度analyzeを呼んでも壊れない (逐次更新)', () => {
  const signal = buildSignal({ kind: 'end', area: '地域共通', datetime: dt, blocks: 2 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const an = new StreamingAnalyzer(48000);
  let sawBlocks = 0;
  for (let i = 0; i < pcm.length; i += 4096) {
    an.push(pcm.slice(i, Math.min(i + 4096, pcm.length)));
    sawBlocks = Math.max(sawBlocks, an.analyze().blocks.length);
  }
  const final = an.analyze();
  assert.equal(final.consensus.classification, '終了信号');
  assert.equal(final.blocks.length, 2);
  assert.equal(sawBlocks, 2);
});

test('status: 無音では tone=null、信号中はマーク/スペース周波数を返す', () => {
  const an = new StreamingAnalyzer(48000);
  an.push(new Float32Array(48000)); // 1秒無音
  assert.equal(an.status().tone, null);

  const signal = buildSignal({ kind: 'start', area: '地域共通', datetime: dt, blocks: 1, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  an.push(pcm);
  const s = an.status();
  assert.ok(s.tone === 640 || s.tone === 1024);
  assert.ok(s.presence > 0.5);
});

test('履歴打ち切り後も直近の信号を解析できる', () => {
  const an = new StreamingAnalyzer(48000, { historySeconds: 15 });
  an.push(new Float32Array(48000 * 20)); // 20秒無音 → 打ち切り発生
  const signal = buildSignal({ kind: 'start', type: 2, area: '高知県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000);
  for (let i = 0; i < pcm.length; i += 8000) {
    an.push(pcm.slice(i, Math.min(i + 8000, pcm.length)));
  }
  const r = an.analyze();
  assert.equal(r.consensus.classification, '第二種開始信号');
  assert.equal(r.consensus.area.name, '高知県');
});

test('44.1kHzでもストリーミング解析できる', () => {
  const signal = buildSignal({ kind: 'start', area: '新潟県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 44100);
  const an = new StreamingAnalyzer(44100);
  for (let i = 0; i < pcm.length; i += 2048) {
    an.push(pcm.slice(i, Math.min(i + 2048, pcm.length)));
  }
  assert.equal(an.analyze().consensus.area.name, '新潟県');
});
