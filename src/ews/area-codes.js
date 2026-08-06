// 地域符号 (12ビット) — 昭和60年郵政省告示第405号 別表第1号からの転記
//
// 「1 地域共通符号」「2 広域符号」「3 県域符号」の全53符号。
// bits は告示の表の左→右の並び (= 送出順) をそのまま文字列にしたもの。
// code はその12ビットを最上位ビット先頭の整数と見なした値 (照合・表示用)。
//
// 全符号はハミング重み6 (1が6個・0が6個) の定重み符号で、
// 任意の2符号間のハミング距離が大きく取られた誤り耐性設計になっている。
// (この性質はテストで検証している)
//
// 同じ12ビット表は ISDB (ARIB STD-B10 第2部 付録D 表D-2) の
// terrestrial_delivery_system_descriptor / emergency_information_descriptor の
// area_code としても使われる。

export const AREA_CODES = [
  // 1 地域共通符号
  { bits: '001101001101', name: '地域共通', kind: 'common' },
  // 2 広域符号
  { bits: '010110100101', name: '関東広域圏', kind: 'wide' },
  { bits: '011100101010', name: '中京広域圏', kind: 'wide' },
  { bits: '100011010101', name: '近畿広域圏', kind: 'wide' },
  { bits: '011010011001', name: '鳥取・島根圏', kind: 'wide' },
  { bits: '010101010011', name: '岡山・香川圏', kind: 'wide' },
  // 3 県域符号
  { bits: '000101101011', name: '北海道', kind: 'pref' },
  { bits: '010001100111', name: '青森県', kind: 'pref' },
  { bits: '010111010100', name: '岩手県', kind: 'pref' },
  { bits: '011101011000', name: '宮城県', kind: 'pref' },
  { bits: '101011000110', name: '秋田県', kind: 'pref' },
  { bits: '111001001100', name: '山形県', kind: 'pref' },
  { bits: '000110101110', name: '福島県', kind: 'pref' },
  { bits: '110001101001', name: '茨城県', kind: 'pref' },
  { bits: '111000111000', name: '栃木県', kind: 'pref' },
  { bits: '100110001011', name: '群馬県', kind: 'pref' },
  { bits: '011001001011', name: '埼玉県', kind: 'pref' },
  { bits: '000111000111', name: '千葉県', kind: 'pref' },
  { bits: '101010101100', name: '東京都', kind: 'pref' },
  { bits: '010101101100', name: '神奈川県', kind: 'pref' },
  { bits: '010011001110', name: '新潟県', kind: 'pref' },
  { bits: '010100111001', name: '富山県', kind: 'pref' },
  { bits: '011010100110', name: '石川県', kind: 'pref' },
  { bits: '100100101101', name: '福井県', kind: 'pref' },
  { bits: '110101001010', name: '山梨県', kind: 'pref' },
  { bits: '100111010010', name: '長野県', kind: 'pref' },
  { bits: '101001100101', name: '岐阜県', kind: 'pref' },
  { bits: '101001011010', name: '静岡県', kind: 'pref' },
  { bits: '100101100110', name: '愛知県', kind: 'pref' },
  { bits: '001011011100', name: '三重県', kind: 'pref' },
  { bits: '110011100100', name: '滋賀県', kind: 'pref' },
  { bits: '010110011010', name: '京都府', kind: 'pref' },
  { bits: '110010110010', name: '大阪府', kind: 'pref' },
  { bits: '011001110100', name: '兵庫県', kind: 'pref' },
  { bits: '101010010011', name: '奈良県', kind: 'pref' },
  { bits: '001110010110', name: '和歌山県', kind: 'pref' },
  { bits: '110100100011', name: '鳥取県', kind: 'pref' },
  { bits: '001100011011', name: '島根県', kind: 'pref' },
  { bits: '001010110101', name: '岡山県', kind: 'pref' },
  { bits: '101100110001', name: '広島県', kind: 'pref' },
  { bits: '101110011000', name: '山口県', kind: 'pref' },
  { bits: '111001100010', name: '徳島県', kind: 'pref' },
  { bits: '100110110100', name: '香川県', kind: 'pref' },
  { bits: '000110011101', name: '愛媛県', kind: 'pref' },
  { bits: '001011100011', name: '高知県', kind: 'pref' },
  { bits: '011000101101', name: '福岡県', kind: 'pref' },
  { bits: '100101011001', name: '佐賀県', kind: 'pref' },
  { bits: '101000101011', name: '長崎県', kind: 'pref' },
  { bits: '100010100111', name: '熊本県', kind: 'pref' },
  { bits: '110010001101', name: '大分県', kind: 'pref' },
  { bits: '110100011100', name: '宮崎県', kind: 'pref' },
  { bits: '110101000101', name: '鹿児島県', kind: 'pref' },
  { bits: '001101110010', name: '沖縄県', kind: 'pref' },
];

export const KIND_NAMES = { common: '地域共通符号', wide: '広域符号', pref: '県域符号' };

for (const a of AREA_CODES) a.code = parseInt(a.bits, 2);

const byBits = new Map(AREA_CODES.map((a) => [a.bits, a]));
const byName = new Map(AREA_CODES.map((a) => [a.name, a]));

// 名前・ビット列・整数値のいずれからでも地域を引く。見つからなければ null。
export function findArea(input) {
  if (typeof input === 'number') {
    return AREA_CODES.find((a) => a.code === input) ?? null;
  }
  const s = String(input).trim();
  if (byName.has(s)) return byName.get(s);
  if (/^[01]{12}$/.test(s)) return byBits.get(s) ?? null;
  if (/^0x[0-9a-f]{1,3}$/i.test(s)) {
    return AREA_CODES.find((a) => a.code === parseInt(s, 16)) ?? null;
  }
  return null;
}

// 12ビット列に最も近い地域符号 (誤り訂正つき復号用)。
// 返り値: { area, dist } — dist は受信ビットとのハミング距離。
export function nearestArea(bits12) {
  let best = null;
  let bestDist = Infinity;
  for (const a of AREA_CODES) {
    let d = 0;
    for (let i = 0; i < 12; i++) if (a.bits[i] !== bits12[i]) d++;
    if (d < bestDist) { best = a; bestDist = d; }
  }
  return { area: best, dist: bestDist };
}

// 参考情報: 各広域圏に対応する県域 (放送対象地域)。
// [解説] p.762 の例 (千葉県に設定した受信機は「千葉県」「関東広域」
// 「地域共通(全国)」のいずれかの符号で起動する) に基づく受信機起動の説明に使う。
// この対応表自体は告示ではなく放送対象地域 (放送法関係) に基づく参考情報。
export const WIDE_AREA_MEMBERS = {
  '関東広域圏': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中京広域圏': ['岐阜県', '愛知県', '三重県'],
  '近畿広域圏': ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '鳥取・島根圏': ['鳥取県', '島根県'],
  '岡山・香川圏': ['岡山県', '香川県'],
};
