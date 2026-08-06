// FSK変調 — 無線設備規則第9条の3
//   一 マーク周波数1,024Hz ("1")・スペース周波数640Hz ("0")
//   二 位相は周波数偏位時において連続 (連続位相FSK)
//   三 伝送速度 毎秒64ビット
//
// 1ビット = 15.625ms は 640Hzのちょうど10周期・1024Hzのちょうど16周期
// なので、各ビット境界で位相は0に戻り、クリックのない綺麗な波形になる。
//
// サンプリング周波数が64の倍数でない場合 (例: 44100Hz → 689.0625サンプル/ビット)
// でも累積誤差が出ないよう、ビット境界は「通算ビット数×サンプル周波数/64」の
// 丸めで求める (ビットごとの丸めの積み上げをしない)。

import { MARK_HZ, SPACE_HZ, BIT_RATE } from './constants.js';

// signal: buildSignal() の返り値
// 返り値: { pcm: Float32Array, sampleRate }
export function renderSignalPcm(signal, sampleRate = 48000, { gain = 0.7 } = {}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 2 * MARK_HZ) {
    throw new RangeError(`サンプリング周波数が不正です (${2 * MARK_HZ}Hz超が必要): ${sampleRate}`);
  }
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) {
    throw new RangeError(`gainは0〜1です: ${gain}`);
  }
  const leadSamples = Math.round(signal.leadSilenceSeconds * sampleRate);

  // 送出ビット列を「音のあるビット」と「無信号ビット」の並びに展開する
  let bitString = '';
  const segments = []; // { bits: number, silent: boolean }
  for (const block of signal.blocks) {
    bitString += block.bits;
    segments.push({ bits: block.bits.length, silent: false });
    if (block.silenceBits) {
      bitString += ' '.repeat(block.silenceBits);
      segments.push({ bits: block.silenceBits, silent: true });
    }
  }

  const totalBits = bitString.length;
  const boundary = (k) => leadSamples + Math.round((k * sampleRate) / BIT_RATE);
  const pcm = new Float32Array(boundary(totalBits));

  let phase = 0;
  for (let k = 0; k < totalBits; k++) {
    const ch = bitString[k];
    const from = boundary(k);
    const to = boundary(k + 1);
    if (ch === ' ') { phase = 0; continue; } // 無信号期間
    const f = ch === '1' ? MARK_HZ : SPACE_HZ;
    const dp = (2 * Math.PI * f) / sampleRate;
    for (let s = from; s < to; s++) {
      pcm[s] = Math.sin(phase) * gain;
      phase += dp;
    }
    if (phase >= 2 * Math.PI) phase -= 2 * Math.PI * Math.floor(phase / (2 * Math.PI));
  }
  return { pcm, sampleRate };
}
