// FSK復調 — 640Hz/1024Hzの2トーンをGoertzelアルゴリズムで判別する。
//
// 実放送の録音 (マイク経由・再サンプリング・レベル差・雑音混入) でも
// 復号できるよう、次の方針をとる:
//   1. 1ビット幅 (15.625ms) の窓で 640Hz と 1024Hz のパワーを求め、
//      その差を軟判定値 d = (P1024 − P640)/(P1024 + P640) とする。
//   2. ビット境界は未知なので、窓を1/8ビットずつずらした8通りの位相で
//      ビット列を切り出し、それぞれをデコーダに渡して同期パターンの
//      一致度が最も高い位相を採用する (decode.js 側で選択)。
//
// 窓幅1ビットのGoertzelの主ローブ幅は ±64Hz 程度あるため、録音機器の
// クロック誤差による数Hzのずれは問題にならない。

import { MARK_HZ, SPACE_HZ, BIT_RATE } from './constants.js';

export const PHASES_PER_BIT = 8;

// 汎用Goertzel: pcm[start..start+len) の freq 成分パワー
export function goertzelPower(pcm, start, len, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) {
    const s0 = pcm[start + i] + cw * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - cw * s1 * s2;
}

// 1/8ビット刻みの軟判定グリッドを計算する。
// 返り値 { d, presence, steps, stepOffset } :
//   d[k]        トーン判定 (-1=640Hz優勢 … +1=1024Hz優勢)
//   presence[k] トーン存在度 (0..1程度。両トーン合計パワー/全パワー)
//   位置kの窓は サンプル round(k*bitSamples/8) から1ビット幅
export function toneGrid(pcm, sampleRate) {
  const bitSamples = sampleRate / BIT_RATE;
  const win = Math.round(bitSamples);
  const steps = Math.max(0, Math.floor((pcm.length - win) / (bitSamples / PHASES_PER_BIT)) + 1);
  const d = new Float32Array(steps);
  const presence = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    const start = Math.round((k * bitSamples) / PHASES_PER_BIT);
    const pMark = goertzelPower(pcm, start, win, MARK_HZ, sampleRate);
    const pSpace = goertzelPower(pcm, start, win, SPACE_HZ, sampleRate);
    let energy = 0;
    for (let i = 0; i < win; i++) energy += pcm[start + i] * pcm[start + i];
    const tone = pMark + pSpace;
    d[k] = tone > 0 ? (pMark - pSpace) / tone : 0;
    // 純音なら goertzelパワー ≈ (振幅²·N²)/4、全エネルギー = 振幅²·N/2
    presence[k] = energy > 0 ? tone / (energy * win * 0.5) : 0;
  }
  return { d, presence, steps, bitSamples };
}

// グリッドから位相 phase (0..7) のビット列を切り出す。
// 返り値 { bits, soft, presence } : bits は '0'/'1' 文字列。
export function sliceBits(grid, phase) {
  const n = Math.floor((grid.steps - phase) / PHASES_PER_BIT) + ((grid.steps - phase) % PHASES_PER_BIT > 0 ? 1 : 0);
  let bits = '';
  const soft = new Float32Array(Math.max(0, n));
  const presence = new Float32Array(Math.max(0, n));
  for (let i = 0; i < n; i++) {
    const k = phase + i * PHASES_PER_BIT;
    bits += grid.d[k] >= 0 ? '1' : '0';
    soft[i] = grid.d[k];
    presence[i] = grid.presence[k];
  }
  return { bits, soft, presence, phase };
}

// ビットインデックス→サンプル位置 (位相ずらし込み)。UI表示用。
export function bitToSample(grid, phase, bitIndex) {
  return Math.round(((phase + bitIndex * PHASES_PER_BIT) * grid.bitSamples) / PHASES_PER_BIT);
}
