// 信号列の組み立て — 昭和60年郵政省告示第405号 第1項・第2項
//
//   第一種開始信号及び第二種開始信号: 無信号期間(1秒間以上)のあと、
//     100ビットのブロックを4以上 (中波放送又は短波放送は10以上) 連接する。
//   終了信号: 無信号期間(1秒間以上)のあと、100ビット+無信号期間92ビット
//     = 192ビットのブロックを2以上 (中波放送又は短波放送は4以上) 連接する。
//
// [解説] p.762: 開始信号は1ブロック1.5秒(=正確には1.5625秒)で4〜10ブロック、
// 終了信号は1ブロック3秒で2〜4ブロック繰り返して送出される。

import {
  BLOCK_BITS, END_SILENCE_BITS, MIN_BLOCKS, LEAD_SILENCE_MIN_SECONDS,
  BIT_SECONDS, SIGNAL_NAMES,
} from './constants.js';
import { findArea } from './area-codes.js';
import { blockFields } from './block.js';

// 現在時刻 (実行環境のローカル時刻) を datetime 形式で返す。
// 日本国内の放送はJSTで運用されるため、日本で使う場合はそのままJSTになる。
export function nowDatetime(date = new Date()) {
  return {
    year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
    hour: date.getHours(), minute: date.getMinutes(),
  };
}

// 信号列を組み立てる。
//   kind: 'start' | 'end'
//   type: 1 | 2
//   area: 地域名 / 12ビット文字列 / 整数 / {bits} オブジェクト
//   datetime: { year, month, day, hour, minute } (省略時: 現在時刻)
//   medium: 'tvfm' (テレビ・FM等) | 'amsw' (中波・短波) — 最少ブロック数の既定に使用
//   blocks: ブロック数の明示指定 (省略時: 媒体ごとの最少値)
//   leadSilenceSeconds: 先頭無信号期間 (既定1秒。告示は「1秒間以上」)
//   overrides: 検証用の手動指定 (block.js参照)。全ブロックに適用され、
//     注1・注2の自動規則 (偶数ブロックの前後日時) を外せる
export function buildSignal({
  kind, type = 1, area = '地域共通', datetime = nowDatetime(),
  medium = 'tvfm', blocks, leadSilenceSeconds = LEAD_SILENCE_MIN_SECONDS,
  overrides,
} = {}) {
  if (kind !== 'start' && kind !== 'end') throw new RangeError(`kindはstart/endです: ${kind}`);
  if (medium !== 'tvfm' && medium !== 'amsw') throw new RangeError(`mediumはtvfm/amswです: ${medium}`);

  let areaBits;
  if (typeof area === 'object' && area?.bits) areaBits = area.bits;
  else if (typeof area === 'string' && /^[01]{12}$/.test(area.trim())) areaBits = area.trim();
  else {
    const found = findArea(area);
    if (!found) throw new RangeError(`地域が見つかりません: ${area}`);
    areaBits = found.bits;
  }

  const minBlocks = MIN_BLOCKS[kind][medium];
  const n = blocks ?? minBlocks;
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`ブロック数が不正です: ${blocks}`);

  const blockList = [];
  for (let i = 1; i <= n; i++) {
    const fields = blockFields({ kind, type, areaBits, datetime, blockIndex: i, overrides });
    blockList.push({
      index: i,
      bits: fields.map((f) => f.bits).join(''),
      fields,
      silenceBits: kind === 'end' ? END_SILENCE_BITS : 0,
    });
  }

  const bitsPerBlock = BLOCK_BITS + (kind === 'end' ? END_SILENCE_BITS : 0);
  const durationSeconds = leadSilenceSeconds + n * bitsPerBlock * BIT_SECONDS;

  return {
    kind, type: kind === 'end' ? null : type, areaBits,
    area: findArea(areaBits),
    datetime, medium, leadSilenceSeconds,
    blocks: blockList,
    name: SIGNAL_NAMES[kind === 'end' ? 'end' : `start${type}`],
    minBlocks, belowMinimum: n < minBlocks,
    totalBits: n * bitsPerBlock,
    durationSeconds,
  };
}
