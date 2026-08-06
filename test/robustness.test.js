// 実録音を想定した復号耐性テスト (検証ワークフローのテスト批評で追加)
// - 周波数オフセット: 録音機器のピッチずれを想定した数Hzのトーンずれ
// - クロックスキュー: 民生機器の水晶精度 (±数百ppm) のサンプルクロック誤差
// - クリッピング: 過大入力による波形歪み
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignal } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { analyzeSignal } from '../src/ews/decode.js';

const dt = { year: 2026, month: 8, day: 6, hour: 13, minute: 30 };

// 任意の周波数ペアでFSK波形を手組みする (64bit/s・位相連続)
function renderShifted(bits, sampleRate, markHz, spaceHz, gain = 0.6) {
  const bitSamples = sampleRate / 64;
  const boundary = (k) => Math.round(k * bitSamples);
  const pcm = new Float32Array(boundary(bits.length));
  let phase = 0;
  for (let k = 0; k < bits.length; k++) {
    const f = bits[k] === '1' ? markHz : spaceHz;
    const dp = (2 * Math.PI * f) / sampleRate;
    for (let s = boundary(k); s < boundary(k + 1); s++) {
      pcm[s] = Math.sin(phase) * gain;
      phase += dp;
    }
  }
  return pcm;
}

test('トーンが+3Hzずれていても復号できる (録音のピッチずれ耐性)', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '宮城県', datetime: dt, blocks: 4 });
  const bits = signal.blocks.map((b) => b.bits).join('');
  const pcm = renderShifted(bits, 48000, 1027, 643);
  const r = analyzeSignal(pcm, 48000);
  assert.ok(r.consensus, 'ブロック未検出');
  assert.equal(r.consensus.area.name, '宮城県');
  assert.equal(r.consensus.classification, '第一種開始信号');
});

test('トーンが-5Hzずれていても復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 2, area: '岩手県', datetime: dt, blocks: 4 });
  const bits = signal.blocks.map((b) => b.bits).join('');
  const pcm = renderShifted(bits, 48000, 1019, 635);
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.consensus?.area?.name, '岩手県');
  assert.equal(r.consensus.classification, '第二種開始信号');
});

test('±300ppmのクロックスキューでも復号できる (民生機器の水晶精度)', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '秋田県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000);
  // 48000Hzで生成した波形を「実は48014.4/47985.6Hzだった」として解析する
  // = 録音側クロックが±300ppmずれている状況 (トーン・ビットクロックとも一括でずれる)
  for (const claimed of [48000 * 1.0003, 48000 * 0.9997]) {
    const r = analyzeSignal(pcm, claimed);
    assert.equal(r.consensus?.area?.name, '秋田県', `claimed=${claimed}`);
    assert.equal(r.consensus.totalErrors, 0, `claimed=${claimed}`);
  }
});

test('波形が±0.4でハードクリップしても復号できる (過大入力耐性)', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '山形県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000, { gain: 0.9 });
  const clipped = pcm.map((v) => Math.max(-0.4, Math.min(0.4, v)));
  const r = analyzeSignal(clipped, 48000);
  assert.equal(r.consensus?.area?.name, '山形県');
});

test('DCオフセットが乗っていても復号できる', () => {
  const signal = buildSignal({ kind: 'end', area: '地域共通', datetime: dt, blocks: 2 });
  const { pcm } = renderSignalPcm(signal, 48000, { gain: 0.4 });
  const offset = pcm.map((v) => v + 0.3);
  const r = analyzeSignal(offset, 48000);
  assert.equal(r.consensus?.classification, '終了信号');
});
