// EWS信号ツール Web UI
// ロジックはすべて src/ews/ の共有ライブラリを使用する (ブラウザ/Node共通)。
import {
  SIGNAL_NAMES,
  AREA_CODES, KIND_NAMES, findArea,
  buildSignal, nowDatetime,
  renderSignalPcm,
  writeWav16, readWav,
  analyzeSignal, StreamingAnalyzer,
  DAY_CODES, MONTH_CODES, HOUR_CODES, YEAR_CODES,
} from '../src/ews/index.js';

const $ = (id) => document.getElementById(id);

/* ======================== タブ ======================== */
const tabs = [...document.querySelectorAll('.tab')];
function selectTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    $(t.getAttribute('aria-controls')).hidden = !selected;
  }
  tab.focus();
}
for (const t of tabs) t.addEventListener('click', () => selectTab(t));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  if (e.key === 'ArrowRight') selectTab(tabs[(i + 1) % tabs.length]);
  if (e.key === 'ArrowLeft') selectTab(tabs[(i + tabs.length - 1) % tabs.length]);
});

/* ======================== 共有オーディオ ======================== */
let audioCtx = null;
function ctx() {
  if (!audioCtx) audioCtx = new (window.AudioContext ?? window.webkitAudioContext)();
  updateHeader();
  return audioCtx;
}
function updateHeader() {
  $('header-audio').textContent = audioCtx
    ? `AUDIO: ${audioCtx.sampleRate} Hz / ${audioCtx.state}`
    : 'AUDIO: --';
}

/* ======================== 信号生成 ======================== */
const FIELD_CLASSES = {
  '前置符号': 'bf-preamble', '固定符号': 'bf-fixed', '地域区分符号': 'bf-area',
  '月日区分符号': 'bf-md', '年時区分符号': 'bf-yh',
};

function populateAreas() {
  const sel = $('gen-area');
  for (const kind of ['common', 'wide', 'pref']) {
    const og = document.createElement('optgroup');
    og.label = KIND_NAMES[kind];
    for (const a of AREA_CODES.filter((x) => x.kind === kind)) {
      const op = document.createElement('option');
      op.value = a.bits;
      op.textContent = `${a.name}（${a.bits}）`;
      og.appendChild(op);
    }
    sel.appendChild(og);
  }
}

function datetimeFromInput() {
  const v = $('gen-datetime').value;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return nowDatetime();
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
}
function setDatetimeNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  $('gen-datetime').value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentParams() {
  const kindVal = new FormData($('gen-form')).get('kind');
  const kind = kindVal === 'end' ? 'end' : 'start';
  const type = kindVal === 'start2' ? 2 : 1;
  const medium = new FormData($('gen-form')).get('medium');

  let areaBits;
  const customOn = $('gen-area-custom-on').checked;
  if (customOn) {
    const v = $('gen-area-custom').value.trim();
    const ok = /^[01]{12}$/.test(v);
    $('gen-area-custom').setAttribute('aria-invalid', String(!ok));
    $('gen-area-custom-err').hidden = ok;
    areaBits = ok ? v : null;
  } else {
    areaBits = $('gen-area').value;
  }

  const overrides = {};
  if ($('ovr-md-on').checked) {
    overrides.monthDay = { month: +$('ovr-month').value, day: +$('ovr-day').value, hoshi: +$('ovr-md-hoshi').value };
  }
  if ($('ovr-yh-on').checked) {
    overrides.yearHour = { hour: +$('ovr-hour').value, yearDigit: +$('ovr-year').value, hoshi: +$('ovr-yh-hoshi').value };
  }

  return {
    kind, type, medium, areaBits,
    datetime: datetimeFromInput(),
    blocks: Math.max(1, Math.floor(+$('gen-blocks').value || 1)),
    leadSilenceSeconds: Math.max(0, +$('gen-lead').value || 0),
    overrides: Object.keys(overrides).length ? overrides : undefined,
    sampleRate: +$('gen-rate').value,
    gain: +$('gen-gain').value,
  };
}

let currentSignal = null;

function rebuild() {
  const p = currentParams();
  $('gen-gain-db').textContent = `${(20 * Math.log10(p.gain)).toFixed(1)} dBFS`;
  if (!p.areaBits) { currentSignal = null; $('gen-summary').textContent = '地域符号が不正です'; $('gen-blocks-view').innerHTML = ''; return; }
  try {
    currentSignal = buildSignal({
      kind: p.kind, type: p.type, area: p.areaBits, datetime: p.datetime,
      medium: p.medium, blocks: p.blocks, leadSilenceSeconds: p.leadSilenceSeconds,
      overrides: p.overrides,
    });
  } catch (e) {
    currentSignal = null;
    $('gen-summary').textContent = `エラー: ${e.message}`;
    $('gen-blocks-view').innerHTML = '';
    return;
  }
  const s = currentSignal;
  $('gen-blocks-warn').hidden = !s.belowMinimum;
  const areaLabel = s.area ? s.area.name : '（表外の符号）';
  $('gen-summary').innerHTML =
    `${s.name}・${areaLabel} <span class="mono">[${s.areaBits}]</span>・${s.blocks.length}ブロック ／ ` +
    `全長 ${s.durationSeconds.toFixed(4)} 秒（${s.kind === 'end' ? '192' : '100'} bit × ${s.blocks.length}, 64 bit/s, 先頭無信号 ${s.leadSilenceSeconds} 秒）`;
  renderBlocks(s);
}

function renderBlocks(signal) {
  const view = $('gen-blocks-view');
  view.innerHTML = '';
  for (const b of signal.blocks) {
    const sec = document.createElement('section');
    sec.className = 'block';
    const md = b.fields[4].value;
    const yh = b.fields[6].value;
    const head = document.createElement('header');
    head.innerHTML = `ブロック ${b.index}` +
      `<span class="block-note">月日: ${md.month}/${md.day} ※${md.hoshi} ／ 年時: ${yh.hour}時・年${yh.year % 10} ※${yh.hoshi}` +
      `${b.silenceBits ? ` ／ +無信号${b.silenceBits}bit` : ''}</span>`;
    sec.appendChild(head);
    const p = document.createElement('p');
    p.className = 'bits';
    for (const f of b.fields) {
      const span = document.createElement('span');
      span.className = `bf ${FIELD_CLASSES[f.name]}`;
      span.title = f.note ? `${f.name}: ${f.note}` : f.name;
      if (f.name === '月日区分符号' || f.name === '年時区分符号') {
        // 3 + 5 + ※1 + 5 + 2 — ※ビットを単独強調する
        span.append(f.bits.slice(0, 8));
        const star = document.createElement('span');
        star.className = 'bf-star';
        star.title = '※ビット';
        star.textContent = f.bits[8];
        span.appendChild(star);
        span.append(f.bits.slice(9));
      } else {
        span.textContent = f.bits;
      }
      p.appendChild(span);
    }
    sec.appendChild(p);
    view.appendChild(sec);
  }
}

/* --- 再生・保存 --- */
let playingSource = null;
function setGenStatus(state, text) {
  $('gen-status').dataset.state = state;
  $('gen-status-text').textContent = text;
}
$('gen-play').addEventListener('click', async () => {
  if (!currentSignal) return;
  const p = currentParams();
  const { pcm } = renderSignalPcm(currentSignal, p.sampleRate, { gain: p.gain });
  const ac = ctx();
  await ac.resume();
  updateHeader();
  stopPlayback();
  const buf = ac.createBuffer(1, pcm.length, p.sampleRate);
  buf.copyToChannel(pcm, 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.onended = () => { if (playingSource === src) { playingSource = null; setGenStatus('idle', '待機'); $('gen-stop').disabled = true; } };
  src.start();
  playingSource = src;
  setGenStatus('running', '再生中');
  $('gen-stop').disabled = false;
});
function stopPlayback() {
  if (playingSource) { try { playingSource.stop(); } catch { /* 停止済み */ } playingSource = null; }
  setGenStatus('idle', '待機');
  $('gen-stop').disabled = true;
}
$('gen-stop').addEventListener('click', stopPlayback);

$('gen-save').addEventListener('click', () => {
  if (!currentSignal) return;
  const p = currentParams();
  const { pcm } = renderSignalPcm(currentSignal, p.sampleRate, { gain: p.gain });
  const wav = writeWav16(pcm, p.sampleRate);
  const s = currentSignal;
  const d = s.datetime;
  const pad = (n) => String(n).padStart(2, '0');
  const label = s.kind === 'end' ? 'end' : `start${s.type}`;
  const areaLabel = (s.area ? s.area.name : s.areaBits).replace(/[・\s]/g, '');
  const name = `ews_${label}_${areaLabel}_${d.year}${pad(d.month)}${pad(d.day)}-${pad(d.hour)}${pad(d.minute)}.wav`;
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

/* --- フォームイベント --- */
populateAreas();
setDatetimeNow();
$('gen-now').addEventListener('click', () => { setDatetimeNow(); rebuild(); });
$('gen-area-custom-on').addEventListener('change', () => {
  $('gen-area-custom').disabled = !$('gen-area-custom-on').checked;
  rebuild();
});
for (const id of ['ovr-md-on', 'ovr-yh-on']) {
  $(id).addEventListener('change', () => {
    const on = $(id).checked;
    const ids = id === 'ovr-md-on' ? ['ovr-month', 'ovr-day', 'ovr-md-hoshi'] : ['ovr-hour', 'ovr-year', 'ovr-yh-hoshi'];
    for (const x of ids) $(x).disabled = !on;
    rebuild();
  });
}
// 媒体・種別の変更時: ブロック数が直前の既定値のままなら新しい既定値に追従する
let lastDefaultBlocks = 4;
function defaultBlocks() {
  const kindVal = new FormData($('gen-form')).get('kind');
  const medium = new FormData($('gen-form')).get('medium');
  return (kindVal === 'end') ? (medium === 'amsw' ? 4 : 2) : (medium === 'amsw' ? 10 : 4);
}
$('gen-form').addEventListener('input', (e) => {
  if (e.target.name === 'kind' || e.target.name === 'medium') {
    const nd = defaultBlocks();
    if (+$('gen-blocks').value === lastDefaultBlocks) $('gen-blocks').value = nd;
    lastDefaultBlocks = nd;
  }
  rebuild();
});
rebuild();

/* ======================== 信号解析 ======================== */
function setAnaStatus(state, text) {
  $('ana-status').dataset.state = state;
  $('ana-status-text').textContent = text;
}

function renderResult(result, totalBits) {
  const c = result?.consensus;
  const empty = (id, text = '──') => { const el = $(id); el.className = 'empty'; el.textContent = text; };
  if (!c) {
    empty('r-class', '──（信号未検出）');
    for (const id of ['r-area', 'r-md', 'r-hour', 'r-year', 'r-err', 'r-recv']) empty(id);
    $('ana-blocks-table').hidden = true;
    $('ana-blocks-empty').hidden = false;
    return false;
  }
  const cls = c.kind === 'end' ? 'end' : `type${c.type}`;
  $('r-class').className = '';
  $('r-class').innerHTML = `<span class="classification ${cls}">${c.classification}</span>（${c.blockCount}ブロック検出）`;
  $('r-area').className = '';
  $('r-area').innerHTML = `${c.area.name} <span class="mono">[${c.area.bits}]</span>` +
    (c.area.dist ? `<span class="err-warn">（受信符号との距離 ${c.area.dist}）</span>` : '');
  $('r-md').className = '';
  $('r-md').textContent = `${c.month}月${c.day}日${c.hasAdjacentDay ? '（偶数ブロックに前後日の符号あり）' : ''}`;
  $('r-hour').className = '';
  $('r-hour').textContent = `${c.hour}時台${c.hasAdjacentHour ? '（偶数ブロックに前後時の符号あり）' : ''}`;
  $('r-year').className = '';
  $('r-year').textContent = `西暦下1桁 ${c.yearDigit}（候補: ${c.yearCandidates.join(', ')}）`;
  $('r-err').className = '';
  const errClass = c.totalErrors === 0 ? 'err-ok' : (c.totalErrors <= c.blockCount * 4 ? 'err-warn' : 'err-alert');
  $('r-err').innerHTML = `<span class="${errClass}">合計 ${c.totalErrors} bit</span>／${totalBits ?? c.blockCount * 100} bit中`;
  $('r-recv').className = '';
  $('r-recv').textContent = c.receiverNote;

  const tbody = $('ana-blocks-table').querySelector('tbody');
  tbody.innerHTML = '';
  for (const [i, b] of result.blocks.entries()) {
    const tr = document.createElement('tr');
    const kindLabel = b.kind === 'end' ? '終了' : `第${b.type === 2 ? '二' : '一'}種開始`;
    tr.innerHTML =
      `<td>${i + 1}</td>` +
      `<td class="mono">${b.startSeconds !== undefined ? b.startSeconds.toFixed(2) + ' s' : b.offsetBits + ' bit'}</td>` +
      `<td>${kindLabel}</td>` +
      `<td>${b.area.name}${b.area.dist ? `（距離${b.area.dist}）` : ''}</td>` +
      `<td class="mono">${b.month.value}/${b.day.value} ※${b.hoshiDay}</td>` +
      `<td class="mono">${b.hour.value}時・年${b.yearDigit.value} ※${b.hoshiHour}</td>` +
      `<td>${b.structureErrors + b.fieldErrors}</td>`;
    tbody.appendChild(tr);
  }
  $('ana-blocks-table').hidden = false;
  $('ana-blocks-empty').hidden = true;
  return true;
}

/* --- ファイル解析 --- */
async function analyzeFile(file) {
  $('ana-error').hidden = true;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let pcm, rate;
    try {
      const wav = readWav(bytes);
      pcm = wav.pcm; rate = wav.sampleRate;
    } catch {
      // WAV以外はブラウザのデコーダに委ねる (MP3/AAC/Ogg等)
      const ab = await ctx().decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      rate = ab.sampleRate;
      pcm = new Float32Array(ab.length);
      const tmp = new Float32Array(ab.length);
      for (let ch = 0; ch < ab.numberOfChannels; ch++) {
        ab.copyFromChannel(tmp, ch);
        for (let i = 0; i < ab.length; i++) pcm[i] += tmp[i] / ab.numberOfChannels;
      }
    }
    $('ana-src-info').textContent = `${file.name} — ${rate} Hz・${(pcm.length / rate).toFixed(2)} 秒`;
    setAnaStatus('running', '解析中');
    await new Promise((r) => setTimeout(r));  // ステータス描画を反映
    const result = analyzeSignal(pcm, rate);
    const detected = renderResult(result, Math.floor(pcm.length / rate * 64));
    setAnaStatus(detected ? 'detected' : 'idle', detected ? '信号検出' : '待機');
  } catch (e) {
    $('ana-error').textContent = `解析できませんでした: ${e.message}`;
    $('ana-error').hidden = false;
    setAnaStatus('idle', '待機');
  }
}
$('ana-drop').addEventListener('click', () => $('ana-file').click());
$('ana-drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') $('ana-file').click(); });
$('ana-file').addEventListener('change', () => { if ($('ana-file').files[0]) analyzeFile($('ana-file').files[0]); });
for (const ev of ['dragover', 'dragleave', 'drop']) {
  $('ana-drop').addEventListener(ev, (e) => {
    e.preventDefault();
    $('ana-drop').classList.toggle('is-over', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files[0]) analyzeFile(e.dataTransfer.files[0]);
  });
}

/* --- マイク/デスクトップ音声 リアルタイム解析 --- */
let mic = null; // { stream, node, source, analyzer, statusTimer, analyzeTimer, peak, peakAt }

// 加工なしの生音声を要求する (EWSトーンをそのまま解析するため)
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

// source: 'mic' | 'display'
async function startCapture(source) {
  $('ana-error').hidden = true;
  try {
    let stream, label;
    if (source === 'display') {
      // 画面共有APIでタブ/システム音声を取得する。videoトラックはAPI上必須。
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('このブラウザは画面共有による音声取得に対応していません (Chrome / Edgeをお使いください)');
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: RAW_AUDIO,
        systemAudio: 'include',        // Chrome: 画面全体の共有でシステム音声を候補に出す
        selfBrowserSurface: 'exclude', // このタブ自身は候補から外す
      });
      if (stream.getAudioTracks().length === 0) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error('音声トラックがありません。共有ダイアログで「音声も共有」を有効にしてください。');
      }
      label = 'デスクトップ音声';
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
      label = 'マイク入力';
    }
    const ac = ctx();
    await ac.resume();
    updateHeader();
    const srcNode = ac.createMediaStreamSource(stream);
    const analyzer = new StreamingAnalyzer(ac.sampleRate);
    let node;
    try {
      const code = `class Cap extends AudioWorkletProcessor {
        process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
      } registerProcessor('ews-cap', Cap);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      await ac.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ac, 'ews-cap');
      node.port.onmessage = (e) => analyzer.push(e.data);
      srcNode.connect(node);
    } catch {
      // AudioWorkletが使えない環境向けのフォールバック
      node = ac.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => analyzer.push(e.inputBuffer.getChannelData(0).slice(0));
      srcNode.connect(node);
      node.connect(ac.destination); // ScriptProcessorは接続がないと動かない (無音出力)
    }
    mic = { stream, node, source: srcNode, analyzer, peak: 0, peakAt: 0 };
    mic.statusTimer = setInterval(updateMicStatus, 100);
    mic.analyzeTimer = setInterval(() => {
      const r = mic.analyzer.analyze();
      const detected = renderResult(r);
      setAnaStatus(detected ? 'detected' : 'running', detected ? '信号検出' : '解析中');
    }, 1000);
    // 共有停止 (ブラウザUIの「共有を停止」等) で自動的に解析を終了する
    for (const t of stream.getTracks()) t.addEventListener('ended', stopCapture);
    $('ana-mic').disabled = true;
    $('ana-display').disabled = true;
    $('ana-mic-stop').disabled = false;
    $('ana-src-info').textContent = `${label} — ${ac.sampleRate} Hz`;
    setAnaStatus('running', '解析中');
  } catch (e) {
    if (e.name === 'NotAllowedError' && source === 'display') return; // 共有ダイアログのキャンセル
    $('ana-error').textContent = e.name === 'NotAllowedError'
      ? 'マイク入力を利用できません。ブラウザの権限設定を確認してください。'
      : `解析を開始できませんでした: ${e.message}`;
    $('ana-error').hidden = false;
  }
}

function updateMicStatus() {
  if (!mic) return;
  const s = mic.analyzer.status();
  const now = performance.now();
  if (s.level >= mic.peak || now - mic.peakAt > 2000) { mic.peak = s.level; mic.peakAt = now; }
  const toDb = (v) => (v <= 0 ? -60 : Math.max(-60, 20 * Math.log10(v)));
  const db = toDb(s.level);
  const frac = (db + 60) / 60;
  $('ana-meter-mask').style.width = `${(1 - frac) * 100}%`;
  $('ana-meter-peak').style.left = `${((toDb(mic.peak) + 60) / 60) * 100}%`;
  $('ana-meter').setAttribute('aria-valuenow', String(Math.round(db)));
  $('ana-meter-db').textContent = `${db.toFixed(1)} dBFS`;
  $('ana-tone-640').classList.toggle('is-on', s.tone === 640);
  $('ana-tone-1024').classList.toggle('is-on', s.tone === 1024);
}

function stopCapture() {
  if (!mic) return;
  clearInterval(mic.statusTimer);
  clearInterval(mic.analyzeTimer);
  try { mic.source.disconnect(); mic.node.disconnect(); } catch { /* 切断済み */ }
  for (const t of mic.stream.getTracks()) t.stop();
  mic = null;
  $('ana-mic').disabled = false;
  $('ana-display').disabled = false;
  $('ana-mic-stop').disabled = true;
  $('ana-tone-640').classList.remove('is-on');
  $('ana-tone-1024').classList.remove('is-on');
  $('ana-meter-db').textContent = '-- dBFS';
  $('ana-meter-mask').style.width = '100%';
  setAnaStatus('idle', '待機');
}
$('ana-mic').addEventListener('click', () => startCapture('mic'));
$('ana-display').addEventListener('click', () => startCapture('display'));
$('ana-mic-stop').addEventListener('click', stopCapture);

/* ======================== 資料 ======================== */
function renderRefTables() {
  // 地域符号一覧
  const wrap = $('ref-areas');
  const table = document.createElement('table');
  table.className = 'data';
  table.innerHTML = '<thead><tr><th>分類</th><th>地域</th><th>地域符号 (12bit)</th><th>16進</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const a of AREA_CODES) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${KIND_NAMES[a.kind]}</td><td>${a.name}</td>` +
      `<td class="mono">${a.bits}</td><td class="mono">0x${a.code.toString(16).padStart(3, '0').toUpperCase()}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  // 日・月・時・年符号 (折りたたみ)
  const dt = $('ref-datetime');
  const mkTable = (title, rows) => {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = title;
    det.appendChild(sum);
    const w = document.createElement('div');
    w.className = 'table-wrap';
    const t = document.createElement('table');
    t.className = 'data';
    t.innerHTML = '<thead><tr><th>値</th><th>符号</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const [label, bits] of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${label}</td><td class="mono">${bits}</td>`;
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    w.appendChild(t);
    det.appendChild(w);
    dt.appendChild(det);
  };
  mkTable('別表第2号 日符号（1〜31日）',
    DAY_CODES.map((c, d) => c && [`${d}日`, c]).filter(Boolean));
  mkTable('別表第3号 月符号（1〜12月）',
    MONTH_CODES.map((c, m) => c && [`${m}月`, c]).filter(Boolean));
  mkTable('別表第4号 時符号（0〜23時）',
    HOUR_CODES.map((c, h) => [`${h}時`, c]));
  mkTable('別表第5号 年符号（西暦下1桁・10年周期）',
    YEAR_CODES.map((c, d) => [`下1桁 ${d}（例: ${2020 + d}年）`, c]));
}
renderRefTables();
updateHeader();

// SIGNAL_NAMESはCLIと共通の表示名 (バンドルの整合性チェックを兼ねて参照)
void SIGNAL_NAMES; void findArea;
