#!/usr/bin/env node
// 緊急警報信号 解析CLI — WAVファイルから信号内容を復号する
//
// 使い方:
//   node tools/ews-decode.js input.wav            人が読めるレポート
//   node tools/ews-decode.js input.wav --json     JSON出力
//   node tools/ews-decode.js input.wav --verbose  ブロックごとの詳細つき

import { readFileSync } from 'node:fs';
import { readWav } from '../src/ews/wav.js';
import { analyzeSignal } from '../src/ews/decode.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const verbose = args.includes('--verbose');

if (!file) {
  console.error('使い方: node tools/ews-decode.js input.wav [--json] [--verbose]');
  process.exit(2);
}

const { pcm, sampleRate, channels, bitsPerSample } = readWav(readFileSync(file));
const result = analyzeSignal(pcm, sampleRate);

if (asJson) {
  console.log(JSON.stringify({
    file, sampleRate, channels, bitsPerSample,
    durationSeconds: pcm.length / sampleRate,
    consensus: result.consensus,
    blocks: verbose ? result.blocks : result.blocks.map((b) => ({
      kind: b.kind, type: b.type, offsetBits: b.offsetBits,
      startSeconds: b.startSeconds, area: b.area,
      day: b.day, month: b.month, hour: b.hour, yearDigit: b.yearDigit,
      hoshiDay: b.hoshiDay, hoshiHour: b.hoshiHour,
      structureErrors: b.structureErrors, fieldErrors: b.fieldErrors,
    })),
  }, null, 2));
  process.exit(result.consensus ? 0 : 1);
}

console.log(`ファイル   : ${file} (${sampleRate}Hz, ${channels}ch, ${bitsPerSample}bit, ${(pcm.length / sampleRate).toFixed(2)}秒)`);
if (!result.consensus) {
  console.log('緊急警報信号は検出されませんでした');
  process.exit(1);
}
const c = result.consensus;
console.log(`判定       : ${c.classification} (${c.blockCount}ブロック検出, 誤り合計${c.totalErrors}ビット)`);
console.log(`地域       : ${c.area.name} [${c.area.bits}]${c.area.dist ? ` (受信符号との距離${c.area.dist})` : ''}`);
console.log(`月日       : ${c.month}月${c.day}日${c.hasAdjacentDay ? ' (偶数ブロックに前後日の符号あり)' : ''}`);
console.log(`時刻       : ${c.hour}時台${c.hasAdjacentHour ? ' (偶数ブロックに前後時の符号あり)' : ''}`);
console.log(`年         : 西暦下1桁${c.yearDigit} (候補: ${c.yearCandidates.join(', ')})`);
console.log(`受信機起動 : ${c.receiverNote}`);

if (verbose) {
  console.log('\nブロック詳細:');
  for (const b of result.blocks) {
    console.log(`  #${b.offsetBits}bit目 (${b.startSeconds?.toFixed(3)}秒〜) ${b.kind === 'end' ? '終了' : `第${b.type}種開始`}`);
    console.log(`    地域=${b.area.name}(距離${b.area.dist}) 月日=${b.month.value}/${b.day.value}※${b.hoshiDay} 年時=${b.hour.value}時/下1桁${b.yearDigit.value}※${b.hoshiHour}`);
    console.log(`    構造誤り${b.structureErrors} フィールド誤り${b.fieldErrors}`);
    console.log(`    ${b.bits}`);
  }
}
