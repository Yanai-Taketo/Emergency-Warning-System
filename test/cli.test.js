// CLIのスモークテスト — 生成→復号の実ファイル往復
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (tool, ...a) => execFileSync('node', [join(root, 'tools', tool), ...a], { encoding: 'utf8' });

test('ews-gen → ews-decode の実ファイル往復', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-'));
  try {
    const wav = join(dir, 'test.wav');
    const out = run('ews-gen.js',
      '--kind', 'start', '--type', '2', '--area', '和歌山県',
      '--date', '2026-08-06T13:30', '--out', wav);
    assert.match(out, /第二種開始信号/);
    assert.ok(existsSync(wav));

    const decoded = JSON.parse(run('ews-decode.js', wav, '--json'));
    assert.equal(decoded.consensus.classification, '第二種開始信号');
    assert.equal(decoded.consensus.area.name, '和歌山県');
    assert.equal(decoded.consensus.day, 6);
    assert.equal(decoded.consensus.month, 8);
    assert.equal(decoded.consensus.hour, 13);
    assert.equal(decoded.consensus.yearDigit, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ews-gen --list-areas は53地域を出力する', () => {
  const out = run('ews-gen.js', '--list-areas').trim().split('\n');
  assert.equal(out.length, 53);
  assert.match(out[0], /001101001101\s+0x34d\s+地域共通符号\s+地域共通/);
});

test('ews-gen オーバーライドで任意の月日・年時を固定できる', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-'));
  try {
    const wav = join(dir, 'ovr.wav');
    run('ews-gen.js', '--kind', 'start', '--area', '地域共通',
      '--date', '2026-08-06T14:05',
      '--day', '17', '--month', '1', '--hoshi-day', '1',
      '--hour', '5', '--year-digit', '5',
      '--out', wav);
    const decoded = JSON.parse(run('ews-decode.js', wav, '--json'));
    assert.equal(decoded.consensus.day, 17);
    assert.equal(decoded.consensus.month, 1);
    assert.equal(decoded.consensus.hour, 5);
    assert.equal(decoded.consensus.yearDigit, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ews-decode は信号なしWAVで終了コード1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-'));
  try {
    const wav = join(dir, 'silence.wav');
    // 0.5秒の無音WAVを生成CLI経由でなく直接作るため、leadのみの信号を使う
    run('ews-gen.js', '--kind', 'start', '--blocks', '1', '--gain', '0', '--out', wav);
    let code = 0;
    try { run('ews-decode.js', wav, '--json'); } catch (e) { code = e.status; }
    assert.equal(code, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
