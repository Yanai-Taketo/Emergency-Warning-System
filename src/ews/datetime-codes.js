// 日符号・月符号・時符号・年符号 (各5ビット) —
// 昭和60年郵政省告示第405号 別表第2号〜第5号からの転記
//
// 表の値は告示の左→右の並び (= 送出順) の文字列。
// いずれも「値を最下位ビットから先に送るLSBファースト」の系統的な構成に
// なっている (単純な2進表現とはビット順が逆であることに注意):
//   日符号: 日(1〜31)をLSBファースト5ビットで表現 (1日=10000, 16日=00001)
//   月符号: 月(1〜12)のLSBファースト4ビット + 末尾に1 (1月=10001)
//   時符号: (時 mod 8) + 8×(3 − ⌊時/8⌋) のLSBファースト5ビット
//   年符号: 西暦下1桁(ただし0は10と読み替え) + 16 のLSBファースト5ビット。
//           昭和60年(1985年)から10年周期で繰り返す (告示 別表第5号 注)
// この規則性はテストで全表と照合して検証している。

// 別表第2号 日符号 (インデックス = 日。[0]は未使用)
export const DAY_CODES = [null,
  '10000', '01000', '11000', '00100', '10100', '01100', '11100', '00010',
  '10010', '01010', '11010', '00110', '10110', '01110', '11110', '00001',
  '10001', '01001', '11001', '00101', '10101', '01101', '11101', '00011',
  '10011', '01011', '11011', '00111', '10111', '01111', '11111',
];

// 別表第3号 月符号 (インデックス = 月。[0]は未使用)
export const MONTH_CODES = [null,
  '10001', '01001', '11001', '00101', '10101', '01101', '11101', '00011',
  '10011', '01011', '11011', '00111',
];

// 別表第4号 時符号 (インデックス = 時 0〜23)
export const HOUR_CODES = [
  '00011', '10011', '01011', '11011', '00111', '10111', '01111', '11111',
  '00001', '10001', '01001', '11001', '00101', '10101', '01101', '11101',
  '00010', '10010', '01010', '11010', '00110', '10110', '01110', '11110',
];

// 別表第5号 年符号 (インデックス = 西暦の下1桁 0〜9)
// 告示は昭和60年(1985)〜昭和69年(=平成6年,1994)の10符号を定め、
// 以後は順次繰り返して使用する (注)。1985→下1桁5, …, 1990→下1桁0。
export const YEAR_CODES = [
  '01011', // 下1桁 0 (例: 1990, 2010, 2020)
  '10001', // 1
  '01001', // 2
  '11001', // 3
  '00101', // 4
  '10101', // 5 (昭和60年=1985)
  '01101', // 6
  '11101', // 7
  '00011', // 8
  '10011', // 9
];

export function dayCode(day) {
  const c = DAY_CODES[day];
  if (!c) throw new RangeError(`日が範囲外です: ${day}`);
  return c;
}
export function monthCode(month) {
  const c = MONTH_CODES[month];
  if (!c) throw new RangeError(`月が範囲外です: ${month}`);
  return c;
}
export function hourCode(hour) {
  const c = HOUR_CODES[hour];
  if (!c) throw new RangeError(`時が範囲外です: ${hour}`);
  return c;
}
// 西暦年 (4桁) または下1桁 (0〜9) を受け付ける
export function yearCode(year) {
  if (!Number.isInteger(year) || year < 0) throw new RangeError(`年が範囲外です: ${year}`);
  return YEAR_CODES[year % 10];
}

function nearestIn(codes, bits5, startIndex) {
  let best = -1;
  let bestDist = Infinity;
  for (let v = startIndex; v < codes.length; v++) {
    if (!codes[v]) continue;
    let d = 0;
    for (let i = 0; i < 5; i++) if (codes[v][i] !== bits5[i]) d++;
    if (d < bestDist) { best = v; bestDist = d; }
  }
  return { value: best, dist: bestDist };
}

// 受信5ビット列から最も近い値を引く (復号用)。{ value, dist } を返す。
export const nearestDay = (bits5) => nearestIn(DAY_CODES, bits5, 1);
export const nearestMonth = (bits5) => nearestIn(MONTH_CODES, bits5, 1);
export const nearestHour = (bits5) => nearestIn(HOUR_CODES, bits5, 0);
// 年は「西暦下1桁」(0〜9) が返る
export const nearestYearDigit = (bits5) => nearestIn(YEAR_CODES, bits5, 0);
