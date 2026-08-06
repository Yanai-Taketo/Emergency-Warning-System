// 復号パイプライン全体のテスト — 全53地域の往復・雑音耐性・誤り耐性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_CODES } from '../src/ews/area-codes.js';
import { buildSignal } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { decodeBits, analyzeSignal, buildConsensus } from '../src/ews/decode.js';

const dt = { year: 2026, month: 8, day: 6, hour: 13, minute: 30 };

// 再現性のある擬似乱数 (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller による正規乱数
function addNoise(pcm, sigma, seed = 1) {
  const rand = rng(seed);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    out[i] = pcm[i] + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}

test('decodeBits: ビット列から直接ブロックを検出・復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '東京都', datetime: dt, blocks: 4 });
  const bits = signal.blocks.map((b) => b.bits).join('');
  const blocks = decodeBits(bits);
  assert.equal(blocks.length, 4);
  for (const b of blocks) {
    assert.equal(b.kind, 'start');
    assert.equal(b.type, 1);
    assert.equal(b.area.name, '東京都');
    assert.equal(b.totalErrors, 0);
  }
});

test('全53地域: 第一種開始信号の生成→音声→解析の往復が一致する', () => {
  for (const area of AREA_CODES) {
    const signal = buildSignal({ kind: 'start', type: 1, area: area.name, datetime: dt, blocks: 4, leadSilenceSeconds: 0.2 });
    const { pcm } = renderSignalPcm(signal, 48000);
    const r = analyzeSignal(pcm, 48000);
    assert.ok(r.consensus, `${area.name}: ブロック未検出`);
    assert.equal(r.consensus.classification, '第一種開始信号', area.name);
    assert.equal(r.consensus.area.name, area.name);
    assert.equal(r.consensus.area.dist, 0, area.name);
    assert.equal(r.consensus.day, 6);
    assert.equal(r.consensus.month, 8);
    assert.equal(r.consensus.hour, 13);
    assert.equal(r.consensus.yearDigit, 6);
  }
});

test('第二種開始信号が正しく分類される', () => {
  const signal = buildSignal({ kind: 'start', type: 2, area: '和歌山県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.consensus.classification, '第二種開始信号');
  assert.equal(r.consensus.type, 2);
  assert.equal(r.consensus.area.name, '和歌山県');
});

test('終了信号 (92ビット無信号期間つき) が正しく分類される', () => {
  const signal = buildSignal({ kind: 'end', area: '地域共通', datetime: dt, blocks: 2 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.consensus.classification, '終了信号');
  assert.equal(r.consensus.type, null);
  assert.equal(r.blocks.length, 2);
});

test('雑音下 (SNR約6dB) でも復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '北海道', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000, { gain: 0.5 });
  const noisy = addNoise(pcm, 0.18, 42); // 信号RMS≈0.35, 雑音σ=0.18 → SNR≈6dB
  const r = analyzeSignal(noisy, 48000);
  assert.ok(r.consensus, '雑音下でブロック未検出');
  assert.equal(r.consensus.classification, '第一種開始信号');
  assert.equal(r.consensus.area.name, '北海道');
});

test('小レベル (gain=0.05) でも復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '沖縄県', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000, { gain: 0.05 });
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.consensus?.area?.name, '沖縄県');
});

test('ビット境界に合わない端数オフセットがあっても復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '愛知県', datetime: dt, blocks: 4, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  // 先頭に半端な長さ (0.37ビット分) の無音を足す
  const offset = Math.round(750 * 0.37);
  const shifted = new Float32Array(pcm.length + offset);
  shifted.set(pcm, offset);
  const r = analyzeSignal(shifted, 48000);
  assert.equal(r.consensus?.area?.name, '愛知県');
  assert.equal(r.consensus.totalErrors, 0);
});

test('44.1kHz生成でも解析できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '京都府', datetime: dt, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 44100);
  const r = analyzeSignal(pcm, 44100);
  assert.equal(r.consensus?.area?.name, '京都府');
});

test('地域符号の1ビット誤りは最近傍復号で必ず復元される (最小距離4)', () => {
  // 地域符号間の最小ハミング距離は4なので、保証される訂正は1ビットまで。
  const signal = buildSignal({ kind: 'start', type: 1, area: '広島県', datetime: dt, blocks: 1 });
  const flip = (s, i) => s.slice(0, i) + (s[i] === '0' ? '1' : '0') + s.slice(i + 1);
  // 地域符号はブロックのオフセット22..34 (地域区分符号の「10」のあと)
  let bits = flip(signal.blocks[0].bits, 23);
  // 固定符号にも1ビット誤りを入れて構造照合の許容も同時に確認する
  bits = flip(bits, 40);
  const blocks = decodeBits(bits);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].area.name, '広島県');
  assert.equal(blocks[0].area.dist, 1);
  assert.equal(blocks[0].structureErrors, 1);
});

test('偶数ブロックの※=1 (前の時) があってもコンセンサスは送出時刻になる', () => {
  const early = { year: 2026, month: 8, day: 6, hour: 14, minute: 5 };
  const signal = buildSignal({ kind: 'start', type: 1, area: '地域共通', datetime: early, blocks: 4 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.consensus.hour, 14, '※=0の奇数ブロックの値が優先される');
  assert.equal(r.consensus.hasAdjacentHour, true);
});

const flipAt = (s, ...idx) => {
  let out = s;
  for (const i of idx) out = out.slice(0, i) + (out[i] === '0' ? '1' : '0') + out.slice(i + 1);
  return out;
};

test('多数決: 1ブロックの地域符号に3ビット誤りがあっても総合判定は正しい地域になる', () => {
  // 地域共通(001101001101)と北海道(000101101011)は距離4。3ビットを北海道方向へ
  // 倒すと当該ブロック単体は北海道(距離1)に誤復号されるが、残り3ブロックとの
  // ビット単位多数決で地域共通が復元される (告示が複数ブロックを連接させる意図)。
  const signal = buildSignal({ kind: 'start', area: '地域共通', datetime: dt, blocks: 4 });
  let bits = signal.blocks.map((b) => b.bits).join('');
  // 2ブロック目の地域符号 (ブロック内オフセット22..33) の相違位置 idx2,6,9
  bits = flipAt(bits, 100 + 22 + 2, 100 + 22 + 6, 100 + 22 + 9);
  const blocks = decodeBits(bits);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[1].area.name, '北海道', '単体ブロックは誤った地域に見える');
  assert.equal(blocks[1].area.dist, 1);
  const c = buildConsensus(blocks);
  assert.equal(c.area.name, '地域共通', 'ビット単位多数決で復元される');
  assert.equal(c.area.dist, 0);
});

test('多数決: 1ブロックの時符号が別の時に化けても値の多数決で送出時が選ばれる', () => {
  // 13時(10101)→1時(10011)は2ビット差 (時符号はブロック内オフセット87..91)
  const signal = buildSignal({ kind: 'start', area: '地域共通', datetime: dt, blocks: 4 });
  let bits = signal.blocks.map((b) => b.bits).join('');
  bits = flipAt(bits, 200 + 87 + 2, 200 + 87 + 3);
  const blocks = decodeBits(bits);
  assert.equal(blocks[2].hour.value, 1, '当該ブロック単体は1時に見える');
  const c = buildConsensus(blocks);
  assert.equal(c.hour, 13, '値の多数決で送出時が選ばれる');
});

test('多数決: 開始信号と終了信号が混在する録音では多数派の種別に分類される', () => {
  const start = buildSignal({ kind: 'start', type: 1, area: '東京都', datetime: dt, blocks: 4 });
  const end = buildSignal({ kind: 'end', area: '東京都', datetime: dt, blocks: 2, leadSilenceSeconds: 0.5 });
  const a = renderSignalPcm(start, 48000).pcm;
  const b = renderSignalPcm(end, 48000).pcm;
  const pcm = new Float32Array(a.length + b.length);
  pcm.set(a, 0);
  pcm.set(b, a.length);
  const r = analyzeSignal(pcm, 48000);
  assert.equal(r.blocks.length, 6, '開始4+終了2の全ブロックが検出される');
  assert.equal(r.consensus.classification, '第一種開始信号', '多数派 (4対2) の種別');
  assert.equal(r.consensus.blockCount, 4, 'コンセンサスは多数派種別のブロックから作られる');
});

test('信号が含まれない雑音のみの入力では何も検出されない', () => {
  const noise = addNoise(new Float32Array(48000 * 3), 0.3, 7);
  const r = analyzeSignal(noise, 48000);
  assert.equal(r.blocks.length, 0);
  assert.equal(r.consensus, null);
});

test('buildConsensus: 空配列はnull', () => {
  assert.equal(buildConsensus([]), null);
});

test('途中から始まる録音 (第1ブロック欠け) でも残りから復号できる', () => {
  const signal = buildSignal({ kind: 'start', type: 1, area: '福岡県', datetime: dt, blocks: 4, leadSilenceSeconds: 0 });
  const { pcm } = renderSignalPcm(signal, 48000);
  const cut = pcm.slice(Math.round(750 * 130)); // 1ブロック+30ビット分を切り落とす
  const r = analyzeSignal(cut, 48000);
  assert.ok(r.consensus);
  assert.equal(r.consensus.area.name, '福岡県');
  assert.equal(r.blocks.length, 2, '残り3ブロック中、完全な2ブロックが取れる');
});
