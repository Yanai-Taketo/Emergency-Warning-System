#!/usr/bin/env node
// 緊急警報信号 生成CLI
//
// 使い方:
//   node tools/ews-gen.js --kind start --type 1 --area 東京都 --out ews.wav
//   node tools/ews-gen.js --kind end --area 地域共通 --date 2026-09-01T11:59 --out end.wav
//   node tools/ews-gen.js --list-areas
//   node tools/ews-gen.js --all-areas outdir --kind start --type 2
//
// 主なオプション (すべてのパラメーターを任意に変更できる):
//   --kind start|end        信号種別 (開始/終了) [必須]
//   --type 1|2              第一種/第二種 (開始のみ意味を持つ。既定1)
//   --area <地域>           地域名 / 12ビット / 0x16進 (既定: 地域共通)
//   --date YYYY-MM-DDTHH:MM 送出日時 (既定: 現在時刻)
//   --blocks N              ブロック数 (既定: 媒体の規定最少値)
//   --medium tvfm|amsw      テレビ・FM (開始4/終了2) | 中波・短波 (開始10/終了4)
//   --lead SEC              先頭無信号期間 (既定1秒。告示は1秒間以上)
//   --rate HZ               サンプリング周波数 (既定48000)
//   --gain 0..1             振幅 (既定0.7)
//   --out FILE.wav          出力ファイル
//   --json                  構成をJSONで出力
//   検証用オーバーライド (注1・注2の自動規則を外して固定):
//   --day N --month N --hoshi-day 0|1     月日区分符号を固定
//   --hour N --year-digit N --hoshi-hour 0|1  年時区分符号を固定

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildSignal, nowDatetime } from '../src/ews/signal.js';
import { renderSignalPcm } from '../src/ews/modulate.js';
import { writeWav16 } from '../src/ews/wav.js';
import { AREA_CODES, KIND_NAMES } from '../src/ews/area-codes.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function parseDate(s) {
  if (!s || s === 'now') return nowDatetime();
  // 末尾までの完全一致を要求する (タイムゾーン接尾辞等は不可 — 壁時計時刻のみ)。
  // 値の範囲・日付の実在性は buildSignal 側の validateDatetime が検査する。
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`日時の形式が不正です (YYYY-MM-DDTHH:MM, タイムゾーン指定は不可): ${s}`);
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
}

// 値つきオプションの取り出し。値が省略されていたら (--out --json のような並びも) エラー。
function strOpt(args, key) {
  const v = args[key];
  if (v === undefined) return undefined;
  if (v === true) throw new Error(`--${key} には値が必要です`);
  return v;
}
function numOpt(args, key, { int = false, min = -Infinity, max = Infinity } = {}) {
  const s = strOpt(args, key);
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!Number.isFinite(v) || (int && !Number.isInteger(v)) || v < min || v > max) {
    throw new Error(`--${key} の値が不正です: ${s}`);
  }
  return v;
}

function buildOverrides(args) {
  const overrides = {};
  if (args.day !== undefined || args.month !== undefined || args['hoshi-day'] !== undefined) {
    if (args.day === undefined || args.month === undefined) {
      throw new Error('月日区分符号の固定には --day と --month の両方が必要です');
    }
    overrides.monthDay = {
      day: numOpt(args, 'day', { int: true, min: 1, max: 31 }),
      month: numOpt(args, 'month', { int: true, min: 1, max: 12 }),
      hoshi: numOpt(args, 'hoshi-day', { int: true, min: 0, max: 1 }) ?? 0,
    };
  }
  if (args.hour !== undefined || args['year-digit'] !== undefined || args['hoshi-hour'] !== undefined) {
    if (args.hour === undefined || args['year-digit'] === undefined) {
      throw new Error('年時区分符号の固定には --hour と --year-digit の両方が必要です');
    }
    overrides.yearHour = {
      hour: numOpt(args, 'hour', { int: true, min: 0, max: 23 }),
      yearDigit: numOpt(args, 'year-digit', { int: true, min: 0, max: 9 }),
      hoshi: numOpt(args, 'hoshi-hour', { int: true, min: 0, max: 1 }) ?? 0,
    };
  }
  return Object.keys(overrides).length ? overrides : undefined;
}

function summarize(signal, sampleRate, gain) {
  const lines = [];
  lines.push(`信号種別   : ${signal.name}`);
  lines.push(`地域       : ${signal.area?.name ?? '(表外)'} [${signal.areaBits}]`);
  const d = signal.datetime;
  lines.push(`送出日時   : ${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`);
  lines.push(`ブロック数 : ${signal.blocks.length} (${signal.medium === 'tvfm' ? 'テレビ・FM 最少' : '中波・短波 最少'}${signal.minBlocks})${signal.belowMinimum ? ' ※告示の最少数未満' : ''}`);
  lines.push(`長さ       : ${signal.durationSeconds.toFixed(4)}秒 (先頭無信号${signal.leadSilenceSeconds}秒込み) / ${sampleRate}Hz / gain ${gain}`);
  for (const b of signal.blocks) {
    lines.push(`  ブロック${b.index}: ${b.fields.map((f) => f.bits).join(' ')}`);
    const md = b.fields[4].value; const yh = b.fields[6].value;
    lines.push(`    月日=${md.month}/${md.day} ※${md.hoshi}  年時=${yh.hour}時/下1桁${yh.year % 10} ※${yh.hoshi}${b.silenceBits ? `  +無信号${b.silenceBits}ビット` : ''}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['list-areas']) {
    for (const a of AREA_CODES) {
      console.log(`${a.bits}  0x${a.code.toString(16).padStart(3, '0')}  ${KIND_NAMES[a.kind]}  ${a.name}`);
    }
    return;
  }

  const common = {
    kind: strOpt(args, 'kind'),
    type: numOpt(args, 'type', { int: true, min: 1, max: 2 }) ?? 1,
    datetime: parseDate(strOpt(args, 'date')),
    medium: strOpt(args, 'medium') ?? 'tvfm',
    blocks: numOpt(args, 'blocks', { int: true, min: 1, max: 1000 }),
    leadSilenceSeconds: numOpt(args, 'lead', { min: 0, max: 3600 }),
    overrides: buildOverrides(args),
  };
  const sampleRate = numOpt(args, 'rate', { int: true, min: 2100, max: 384000 }) ?? 48000;
  const gain = numOpt(args, 'gain', { min: 0, max: 1 }) ?? 0.7;

  if (!common.kind) {
    console.error('使い方: node tools/ews-gen.js --kind start|end [--type 1|2] [--area 地域] [--out FILE.wav]');
    console.error('        node tools/ews-gen.js --list-areas');
    process.exitCode = 2;
    return;
  }

  if (args['all-areas']) {
    const dir = typeof args['all-areas'] === 'string' ? args['all-areas'] : 'ews-out';
    mkdirSync(dir, { recursive: true });
    for (const a of AREA_CODES) {
      const signal = buildSignal({ ...common, area: a.name });
      const { pcm } = renderSignalPcm(signal, sampleRate, { gain });
      const label = common.kind === 'end' ? 'end' : `start${common.type}`;
      const file = join(dir, `ews_${label}_${a.code.toString(16).padStart(3, '0')}_${a.name.replace(/・/g, '')}.wav`);
      writeFileSync(file, writeWav16(pcm, sampleRate));
      console.log(file);
    }
    console.log(`${AREA_CODES.length}ファイルを${dir}/に出力しました`);
    return;
  }

  const signal = buildSignal({ ...common, area: strOpt(args, 'area') ?? '地域共通' });
  const { pcm } = renderSignalPcm(signal, sampleRate, { gain });

  if (args.json) {
    console.log(JSON.stringify({
      name: signal.name, kind: signal.kind, type: signal.type,
      area: signal.area, areaBits: signal.areaBits, datetime: signal.datetime,
      blocks: signal.blocks.map((b) => ({
        index: b.index, bits: b.bits, silenceBits: b.silenceBits,
        fields: b.fields.map((f) => ({ name: f.name, bits: f.bits, note: f.note })),
      })),
      belowMinimum: signal.belowMinimum,
      durationSeconds: signal.durationSeconds, sampleRate, gain,
    }, null, 2));
  } else {
    console.log(summarize(signal, sampleRate, gain));
  }

  if (signal.belowMinimum) {
    console.error(`警告: ブロック数${signal.blocks.length}は告示の最少数${signal.minBlocks}を下回っています (検証用)`);
  }
  const out = strOpt(args, 'out');
  if (out) {
    writeFileSync(out, writeWav16(pcm, sampleRate));
    console.log(`出力: ${out} (${(pcm.length / sampleRate).toFixed(3)}秒)`);
  }
}

try {
  main();
} catch (e) {
  console.error(`エラー: ${e.message}`);
  process.exitCode = 2;
}
