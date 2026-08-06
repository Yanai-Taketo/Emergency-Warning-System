// 緊急警報信号のビット列解析 (フレーム同期・符号復号・多数決)
//
// 手順:
//   1. ビット列から同期パターン (前置符号4 + 固定符号16 = 20ビット) を
//      誤り2ビット以内で探す。
//   2. 候補位置でブロック内の残り2つの固定符号 (オフセット36, 68) を検査し、
//      構造が確認できたら100ビットをブロックとして切り出す。
//   3. 各区分符号を復号する。地域符号・日・月・時・年符号は表引きで、
//      一致しない場合は最近傍符号 (ハミング距離付き) を返す。
//   4. 複数ブロックの多数決で総合判定 (コンセンサス) を作る。
//      月日・年時は※=0 (送出日時に対応) のブロックを優先する。
//
// 符号の位置・意味はすべて昭和60年郵政省告示第405号による (block.js参照)。

import {
  PREAMBLE_START, PREAMBLE_END, FIXED_CODE_1, FIXED_CODE_2,
  BLOCK_BITS, SIGNAL_NAMES, hamming,
} from './constants.js';
import { nearestArea, WIDE_AREA_MEMBERS } from './area-codes.js';
import { nearestDay, nearestMonth, nearestHour, nearestYearDigit } from './datetime-codes.js';
import { toneGrid, sliceBits, bitToSample, PHASES_PER_BIT } from './demodulate.js';

// 同期候補: 前置符号+固定符号 → 信号種別
const SYNC_PATTERNS = [
  { sync: PREAMBLE_START + FIXED_CODE_1, kind: 'start', type: 1 },
  { sync: PREAMBLE_START + FIXED_CODE_2, kind: 'start', type: 2 },
  { sync: PREAMBLE_END + FIXED_CODE_1, kind: 'end', type: null },
];

const MAX_SYNC_ERRORS = 2;   // 20ビット中
const MAX_FIXED_ERRORS = 3;  // 16ビット中 (2つ目・3つ目の固定符号)

// 1ブロック(100ビット)を復号する。bits.length === 100 が前提。
export function parseBlock(bits, { kind, type }) {
  const fixed = kind === 'end' || type === 1 ? FIXED_CODE_1 : FIXED_CODE_2;
  let structureErrors = 0;
  structureErrors += hamming(bits.slice(0, 4), kind === 'start' ? PREAMBLE_START : PREAMBLE_END);
  structureErrors += hamming(bits.slice(4, 20), fixed);
  structureErrors += hamming(bits.slice(36, 52), fixed);
  structureErrors += hamming(bits.slice(68, 84), fixed);

  // 地域区分符号: 開始 10[12]00 / 終了 01[12]11
  const areaK = bits.slice(20, 36);
  const areaFrame = kind === 'start' ? ['10', '00'] : ['01', '11'];
  structureErrors += hamming(areaK.slice(0, 2), areaFrame[0]) + hamming(areaK.slice(14), areaFrame[1]);
  const areaBits = areaK.slice(2, 14);
  const { area, dist: areaDist } = nearestArea(areaBits);

  // 月日区分符号: 開始 010[日5]※[月5]00 / 終了 100[日5]※[月5]11
  const mdK = bits.slice(52, 68);
  const mdFrame = kind === 'start' ? ['010', '00'] : ['100', '11'];
  structureErrors += hamming(mdK.slice(0, 3), mdFrame[0]) + hamming(mdK.slice(14), mdFrame[1]);
  const day = nearestDay(mdK.slice(3, 8));
  const hoshiDay = mdK[8] === '1' ? 1 : 0;
  const month = nearestMonth(mdK.slice(9, 14));

  // 年時区分符号: 開始 011[時5]※[年5]00 / 終了 101[時5]※[年5]11
  const yhK = bits.slice(84, 100);
  const yhFrame = kind === 'start' ? ['011', '00'] : ['101', '11'];
  structureErrors += hamming(yhK.slice(0, 3), yhFrame[0]) + hamming(yhK.slice(14), yhFrame[1]);
  const hour = nearestHour(yhK.slice(3, 8));
  const hoshiHour = yhK[8] === '1' ? 1 : 0;
  const yearDigit = nearestYearDigit(yhK.slice(9, 14));

  const fieldErrors = areaDist + day.dist + month.dist + hour.dist + yearDigit.dist;
  return {
    kind, type, bits,
    area: { bits: areaBits, name: area.name, code: area.code, areaKind: area.kind, dist: areaDist },
    day: { value: day.value, dist: day.dist },
    month: { value: month.value, dist: month.dist },
    hour: { value: hour.value, dist: hour.dist },
    yearDigit: { value: yearDigit.value, dist: yearDigit.dist },
    hoshiDay, hoshiHour,
    structureErrors, fieldErrors,
    totalErrors: structureErrors + fieldErrors,
  };
}

// ビット列からブロックを探して復号する。
export function decodeBits(bits) {
  const blocks = [];
  let i = 0;
  while (i + BLOCK_BITS <= bits.length) {
    let hit = null;
    for (const p of SYNC_PATTERNS) {
      const syncErr = hamming(bits.slice(i, i + 20), p.sync);
      if (syncErr > MAX_SYNC_ERRORS) continue;
      const fixed = p.kind === 'end' || p.type === 1 ? FIXED_CODE_1 : FIXED_CODE_2;
      const f2 = hamming(bits.slice(i + 36, i + 52), fixed);
      const f3 = hamming(bits.slice(i + 68, i + 84), fixed);
      if (f2 > MAX_FIXED_ERRORS || f3 > MAX_FIXED_ERRORS) continue;
      const score = syncErr + f2 + f3;
      if (!hit || score < hit.score) hit = { ...p, score };
    }
    if (hit) {
      const block = parseBlock(bits.slice(i, i + BLOCK_BITS), hit);
      block.offsetBits = i;
      blocks.push(block);
      i += BLOCK_BITS;
    } else {
      i += 1;
    }
  }
  return blocks;
}

// 複数ブロックから総合判定を作る。
export function buildConsensus(blocks) {
  if (blocks.length === 0) return null;

  // 信号種別: 多数決
  const byKind = new Map();
  for (const b of blocks) {
    const key = b.kind === 'end' ? 'end' : `start${b.type}`;
    byKind.set(key, (byKind.get(key) ?? 0) + 1);
  }
  const kindKey = [...byKind.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const majority = blocks.filter((b) => (b.kind === 'end' ? 'end' : `start${b.type}`) === kindKey);

  // 地域符号: ビットごとの多数決 → 最近傍表引き
  const areaVote = new Array(12).fill(0);
  for (const b of majority) {
    for (let i = 0; i < 12; i++) areaVote[i] += b.area.bits[i] === '1' ? 1 : -1;
  }
  const areaBits = areaVote.map((v) => (v >= 0 ? '1' : '0')).join('');
  const { area, dist: areaDist } = nearestArea(areaBits);

  // 値の多数決 (該当ブロックが無ければ null)
  const voteValue = (list) => {
    if (list.length === 0) return null;
    const c = new Map();
    for (const v of list) c.set(v, (c.get(v) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  // 月日・年時は※=0 (送出日時に対応する符号) のブロックを優先
  const md0 = majority.filter((b) => b.hoshiDay === 0);
  const yh0 = majority.filter((b) => b.hoshiHour === 0);
  const mdSrc = md0.length > 0 ? md0 : majority;
  const yhSrc = yh0.length > 0 ? yh0 : majority;

  const day = voteValue(mdSrc.map((b) => b.day.value));
  const month = voteValue(mdSrc.map((b) => b.month.value));
  const hour = voteValue(yhSrc.map((b) => b.hour.value));
  const yearDigit = voteValue(yhSrc.map((b) => b.yearDigit.value));

  const totalErrors = majority.reduce((s, b) => s + b.totalErrors, 0);

  // この符号で起動する受信機の説明 ([解説] p.762 の例に基づく参考情報)
  let receiverNote;
  if (area.kind === 'common') {
    receiverNote = '地域共通符号: 全国どの地域に設定された受信機も対象';
  } else if (area.kind === 'wide') {
    receiverNote = `${area.name}: ${(WIDE_AREA_MEMBERS[area.name] ?? []).join('・')}に設定された受信機が対象`;
  } else {
    receiverNote = `${area.name}に設定された受信機が対象 (広域圏・地域共通の符号でも起動する)`;
  }

  return {
    classification: SIGNAL_NAMES[kindKey],
    kind: kindKey === 'end' ? 'end' : 'start',
    type: kindKey === 'end' ? null : Number(kindKey.slice(-1)),
    area: { bits: areaBits, name: area.name, code: area.code, areaKind: area.kind, dist: areaDist },
    day, month, hour, yearDigit,
    // 年符号は西暦下1桁のみを伝える (10年周期)。候補年の例を添える。
    yearCandidates: yearDigit === null ? [] : candidateYears(yearDigit),
    hasAdjacentDay: majority.some((b) => b.hoshiDay === 1),
    hasAdjacentHour: majority.some((b) => b.hoshiHour === 1),
    blockCount: majority.length,
    totalErrors,
    receiverNote,
  };
}

function candidateYears(digit, around = new Date().getFullYear(), span = 30) {
  const years = [];
  for (let y = around - span; y <= around + 10; y++) {
    if (y % 10 === digit) years.push(y);
  }
  return years.slice(-4);
}

// PCMから一括解析する最上位API。
// 返り値: { blocks, consensus, phase, grid } (ブロックが無ければ consensus: null)
export function analyzeSignal(pcm, sampleRate) {
  const grid = toneGrid(pcm, sampleRate);
  let best = null;
  for (let phase = 0; phase < PHASES_PER_BIT; phase++) {
    const stream = sliceBits(grid, phase);
    const blocks = decodeBits(stream.bits);
    if (blocks.length === 0) continue;
    const errors = blocks.reduce((s, b) => s + b.totalErrors, 0);
    const score = blocks.length * 1000 - errors;
    if (!best || score > best.score) best = { blocks, phase, score, stream };
  }
  if (!best) return { blocks: [], consensus: null, phase: null };

  for (const b of best.blocks) {
    b.startSample = bitToSample(grid, best.phase, b.offsetBits);
    b.startSeconds = b.startSample / sampleRate;
  }
  return {
    blocks: best.blocks,
    consensus: buildConsensus(best.blocks),
    phase: best.phase,
  };
}
