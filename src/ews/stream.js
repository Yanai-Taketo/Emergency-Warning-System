// リアルタイム (ストリーミング) 解析器
//
// マイク入力のように音声が少しずつ届く場合に、Goertzelグリッドを
// 増分計算しながら随時 analyze() できるようにする。結果は一括解析
// (decode.js の analyzeSignal) と同一のアルゴリズム・同一の形式。
//
// 使い方:
//   const an = new StreamingAnalyzer(48000);
//   an.push(chunk);        // Float32Array を到着順に渡す
//   const r = an.analyze();    // いつ呼んでもよい (毎秒など)
//   const s = an.status();     // レベル・トーン検出の瞬時値

import { MARK_HZ, SPACE_HZ, BIT_RATE } from './constants.js';
import { goertzelPower, PHASES_PER_BIT } from './demodulate.js';
import { decodeBits, buildConsensus } from './decode.js';

export class StreamingAnalyzer {
  // historySeconds: 解析対象として保持する長さ (古い分から捨てる)
  constructor(sampleRate, { historySeconds = 120 } = {}) {
    this.sampleRate = sampleRate;
    this.bitSamples = sampleRate / BIT_RATE;
    this.win = Math.round(this.bitSamples);
    this.stepSamples = this.bitSamples / PHASES_PER_BIT;
    this.maxSteps = Math.ceil((historySeconds * sampleRate) / this.stepSamples);

    this.d = [];         // 軟判定値 (ステップごと)
    this.presence = [];  // トーン存在度
    this.droppedSteps = 0; // 履歴打ち切りで捨てたステップ数 (8の倍数を保つ)

    this.tail = new Float32Array(0); // 未処理サンプル (次の窓の計算に必要な分)
    this.tailStart = 0;              // tail[0] の通算サンプル位置
    this.nextStep = 0;               // 次に計算するステップ番号 (通算)
    this.totalSamples = 0;
  }

  push(chunk) {
    const merged = new Float32Array(this.tail.length + chunk.length);
    merged.set(this.tail, 0);
    merged.set(chunk, this.tail.length);
    let start = this.tailStart;
    this.totalSamples += chunk.length;

    // 窓が丸ごと収まるステップをすべて計算する
    while (true) {
      const winStart = Math.round(this.nextStep * this.stepSamples);
      const off = winStart - start;
      if (off + this.win > merged.length) break;
      const pMark = goertzelPower(merged, off, this.win, MARK_HZ, this.sampleRate);
      const pSpace = goertzelPower(merged, off, this.win, SPACE_HZ, this.sampleRate);
      let energy = 0;
      for (let i = 0; i < this.win; i++) energy += merged[off + i] * merged[off + i];
      const tone = pMark + pSpace;
      this.d.push(tone > 0 ? (pMark - pSpace) / tone : 0);
      this.presence.push(energy > 0 ? tone / (energy * this.win * 0.5) : 0);
      this.nextStep++;
    }

    // 次のステップの窓開始位置より前のサンプルは不要
    const keepFrom = Math.round(this.nextStep * this.stepSamples);
    const cut = Math.max(0, keepFrom - start);
    this.tail = merged.slice(cut);
    this.tailStart = start + cut;

    // 履歴の打ち切り (位相の対応を保つため8ステップ=1ビット単位で捨てる)
    if (this.d.length > this.maxSteps) {
      const drop = Math.floor((this.d.length - this.maxSteps) / PHASES_PER_BIT) * PHASES_PER_BIT;
      if (drop > 0) {
        this.d.splice(0, drop);
        this.presence.splice(0, drop);
        this.droppedSteps += drop;
      }
    }
  }

  // 瞬時状態: 直近1ビット窓のレベルとトーン検出
  status() {
    const k = this.d.length - 1;
    if (k < 0) return { level: 0, tone: null, presence: 0 };
    const p = this.presence[k];
    const dv = this.d[k];
    let level = 0;
    for (let i = Math.max(0, this.tail.length - this.win); i < this.tail.length; i++) {
      level = Math.max(level, Math.abs(this.tail[i]));
    }
    return {
      level,
      presence: p,
      tone: p > 0.5 ? (dv >= 0 ? MARK_HZ : SPACE_HZ) : null,
    };
  }

  // 蓄積分を解析する。decode.js の analyzeSignal と同じ形式で返す。
  analyze() {
    const steps = this.d.length;
    let best = null;
    for (let phase = 0; phase < PHASES_PER_BIT; phase++) {
      const n = Math.ceil((steps - phase) / PHASES_PER_BIT);
      if (n < 100) continue;
      let bits = '';
      for (let i = 0; i < n; i++) bits += this.d[phase + i * PHASES_PER_BIT] >= 0 ? '1' : '0';
      const blocks = decodeBits(bits);
      if (blocks.length === 0) continue;
      const errors = blocks.reduce((s, b) => s + b.totalErrors, 0);
      const score = blocks.length * 1000 - errors;
      if (!best || score > best.score) best = { blocks, phase, score };
    }
    if (!best) return { blocks: [], consensus: null, phase: null };
    for (const b of best.blocks) {
      const step = this.droppedSteps + best.phase + b.offsetBits * PHASES_PER_BIT;
      b.startSample = Math.round(step * this.stepSamples);
      b.startSeconds = b.startSample / this.sampleRate;
    }
    return { blocks: best.blocks, consensus: buildConsensus(best.blocks), phase: best.phase };
  }
}
