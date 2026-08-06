// 別表第1号〜第5号の表の忠実性テスト。
// 各表の値が告示に記載された規則性・性質と一致することを機械的に検証し、
// さらに告示から直接転記したスポット値と照合する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREA_CODES, findArea, nearestArea } from '../src/ews/area-codes.js';
import {
  DAY_CODES, MONTH_CODES, HOUR_CODES, YEAR_CODES,
  dayCode, monthCode, hourCode, yearCode,
} from '../src/ews/datetime-codes.js';

const lsbFirst = (value, width) => {
  let s = '';
  for (let i = 0; i < width; i++) s += (value >> i) & 1;
  return s;
};

test('地域符号: 53符号 (共通1+広域5+県域47)', () => {
  assert.equal(AREA_CODES.length, 53);
  assert.equal(AREA_CODES.filter((a) => a.kind === 'common').length, 1);
  assert.equal(AREA_CODES.filter((a) => a.kind === 'wide').length, 5);
  assert.equal(AREA_CODES.filter((a) => a.kind === 'pref').length, 47);
});

test('地域符号: 全符号12ビット・ハミング重み6・重複なし', () => {
  const seen = new Set();
  for (const a of AREA_CODES) {
    assert.match(a.bits, /^[01]{12}$/, a.name);
    const weight = [...a.bits].filter((c) => c === '1').length;
    assert.equal(weight, 6, `${a.name} の重みが${weight}`);
    assert.ok(!seen.has(a.bits), `${a.name} が重複`);
    seen.add(a.bits);
  }
});

test('地域符号: 任意の2符号間のハミング距離は4以上 (誤り耐性設計)', () => {
  for (let i = 0; i < AREA_CODES.length; i++) {
    for (let j = i + 1; j < AREA_CODES.length; j++) {
      let d = 0;
      for (let k = 0; k < 12; k++) if (AREA_CODES[i].bits[k] !== AREA_CODES[j].bits[k]) d++;
      assert.ok(d >= 4, `${AREA_CODES[i].name}-${AREA_CODES[j].name} 間の距離が${d}`);
    }
  }
});

test('地域符号: 告示 別表第1号からのスポット転記と一致', () => {
  // 昭和60年郵政省告示第405号 別表第1号の記載値 (左→右)
  const expected = {
    '地域共通': '001101001101',
    '関東広域圏': '010110100101',
    '中京広域圏': '011100101010',
    '近畿広域圏': '100011010101',
    '鳥取・島根圏': '011010011001',
    '岡山・香川圏': '010101010011',
    '北海道': '000101101011',
    '千葉県': '000111000111',
    '東京都': '101010101100',
    '大阪府': '110010110010',
    '沖縄県': '001101110010',
  };
  for (const [name, bits] of Object.entries(expected)) {
    assert.equal(findArea(name).bits, bits, name);
  }
});

test('findArea: 名前・ビット列・16進・整数で引ける', () => {
  const tokyo = findArea('東京都');
  assert.equal(findArea('101010101100'), tokyo);
  assert.equal(findArea('0xaac'), tokyo);
  assert.equal(findArea('0x0aac'), tokyo, '先頭0つき4桁16進');
  assert.equal(findArea(0xaac), tokyo);
  assert.equal(findArea('存在しない県'), null);
  assert.equal(findArea('0x1aac'), null, '12ビットを超える値');
});

test('nearestArea: 1ビット誤りでも正しい地域に復号される', () => {
  for (const a of AREA_CODES) {
    const flipped = a.bits.slice(0, 5) + (a.bits[5] === '0' ? '1' : '0') + a.bits.slice(6);
    const { area, dist } = nearestArea(flipped);
    assert.equal(area.name, a.name);
    assert.equal(dist, 1);
  }
});

test('日符号: 日(1〜31)のLSBファースト5ビット (告示 別表第2号)', () => {
  assert.equal(DAY_CODES.length, 32);
  for (let d = 1; d <= 31; d++) assert.equal(dayCode(d), lsbFirst(d, 5), `${d}日`);
  // 告示からの転記スポット確認
  assert.equal(dayCode(1), '10000');
  assert.equal(dayCode(16), '00001');
  assert.equal(dayCode(31), '11111');
});

test('月符号: 月のLSBファースト4ビット+1 (告示 別表第3号)', () => {
  assert.equal(MONTH_CODES.length, 13);
  for (let m = 1; m <= 12; m++) assert.equal(monthCode(m), lsbFirst(m, 4) + '1', `${m}月`);
  assert.equal(monthCode(1), '10001');
  assert.equal(monthCode(12), '00111');
});

test('時符号: (時mod8)+8×(3−⌊時/8⌋) のLSBファースト5ビット (告示 別表第4号)', () => {
  assert.equal(HOUR_CODES.length, 24);
  for (let h = 0; h < 24; h++) {
    const v = (h % 8) + 8 * (3 - Math.floor(h / 8));
    assert.equal(hourCode(h), lsbFirst(v, 5), `${h}時`);
  }
  assert.equal(hourCode(0), '00011');
  assert.equal(hourCode(11), '11001');
  assert.equal(hourCode(23), '11110');
});

test('年符号: 下1桁(0は10)+16 のLSBファースト5ビット・10年周期 (告示 別表第5号)', () => {
  assert.equal(YEAR_CODES.length, 10);
  for (let digit = 0; digit <= 9; digit++) {
    const v = (digit === 0 ? 10 : digit) + 16;
    assert.equal(YEAR_CODES[digit], lsbFirst(v, 5), `下1桁${digit}`);
  }
  // 告示の記載: 昭和60年(1985)=10101, 昭和63年(1988)=00011, 昭和65年(1990)=01011
  assert.equal(yearCode(1985), '10101');
  assert.equal(yearCode(1988), '00011');
  assert.equal(yearCode(1990), '01011');
  // 10年周期 (別表第5号 注)
  assert.equal(yearCode(2025), yearCode(1985));
  assert.equal(yearCode(2026), yearCode(1986));
});

test('日・月・時・年の各表内に重複符号がない', () => {
  for (const table of [DAY_CODES.slice(1), MONTH_CODES.slice(1), HOUR_CODES, YEAR_CODES]) {
    assert.equal(new Set(table).size, table.length);
  }
});
