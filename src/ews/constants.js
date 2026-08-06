// 緊急警報信号 (EWS: Emergency Warning System) — 定数定義
//
// 本ファイルの数値・符号はすべて一次資料からの転記であり、推測を含まない。
//
// [規則] 無線設備規則 (昭和25年電波監理委員会規則第18号) 第9条の3
//        「緊急警報信号発生装置」
//   一  周波数偏位方式 (FSK)。マーク周波数 1,024Hz・スペース周波数 640Hz。
//       周波数の許容偏差は各 ±10ppm (百万分の10)
//   二  位相は周波数偏位時において連続していること (連続位相FSK)
//   三  伝送速度は毎秒64ビット。許容偏差 ±10ppm
//   四  歪率は5%以下
//   五  構成は別に告示するところによる (→ [告示])
//
// [告示] 昭和60年郵政省告示第405号
//        「無線設備規則第九条の三第五号の規定に基づく緊急警報信号の構成」
//        (昭和60年6月1日) — 信号構成図・符号構成表・別表第1号〜第5号
//
// [解説] 伊藤泰宏 (NHK放送技術研究所)「緊急警報放送」
//        映像情報メディア学会誌 Vol.61, No.6, pp.761-763 (2007)
//        https://www.jstage.jst.go.jp/article/itej/61/6/61_6_761/_pdf
//
// ビット表現について: 本ライブラリのビット列は '0'/'1' の文字列で、
// 左端のビットから順に送出される (告示の構成図・別表の左→右の並びと同一)。

// [規則] 第9条の3 一〜三
export const MARK_HZ = 1024;    // "1"
export const SPACE_HZ = 640;    // "0"
export const BIT_RATE = 64;     // bit/s
export const BIT_SECONDS = 1 / BIT_RATE; // 15.625 ms
// 1ビットは 640Hz×15.625ms = 10周期 / 1024Hz×15.625ms = 16周期 (整数周期)

// [告示] 符号の構成 — 前置符号 (4ビット)
export const PREAMBLE_START = '1100'; // 第一種開始信号及び第二種開始信号
export const PREAMBLE_END = '0011';   // 終了信号

// [告示] 符号の構成 — 固定符号 (16ビット)
export const FIXED_CODE_1 = '0000111001101101'; // 第一種開始信号及び終了信号
export const FIXED_CODE_2 = '1111000110010010'; // 第二種開始信号 (第一種の全ビット反転)

// [告示] 第1項・第2項 信号構成図
//   開始信号ブロック: 前置4 + (固定16+地域区分16+固定16+月日区分16+固定16+年時区分16)=96
//                     = 100ビット (1.5625秒)。4以上連接 (中波・短波は10以上)
//   終了信号ブロック: 上記100ビット + 無信号期間92ビット = 192ビット (3.0秒)。
//                     2以上連接 (中波・短波は4以上)
//   いずれも先頭に1秒間以上の無信号期間を置く
export const BLOCK_BITS = 100;
export const END_SILENCE_BITS = 92;
export const LEAD_SILENCE_MIN_SECONDS = 1;
export const MIN_BLOCKS = {
  start: { tvfm: 4, amsw: 10 }, // テレビ・FM: 4以上 / 中波・短波: 10以上
  end: { tvfm: 2, amsw: 4 },    // テレビ・FM: 2以上 / 中波・短波: 4以上
};

// ブロック内の各符号のビットオフセット (開始・終了共通)
export const BLOCK_LAYOUT = [
  { name: '前置符号', offset: 0, bits: 4 },
  { name: '固定符号', offset: 4, bits: 16 },
  { name: '地域区分符号', offset: 20, bits: 16 },
  { name: '固定符号', offset: 36, bits: 16 },
  { name: '月日区分符号', offset: 52, bits: 16 },
  { name: '固定符号', offset: 68, bits: 16 },
  { name: '年時区分符号', offset: 84, bits: 16 },
];

// 信号種別の表示名
export const SIGNAL_NAMES = {
  start1: '第一種開始信号',
  start2: '第二種開始信号',
  end: '終了信号',
};

// ハミング距離 (ビット文字列比較の共通ユーティリティ)
export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}
