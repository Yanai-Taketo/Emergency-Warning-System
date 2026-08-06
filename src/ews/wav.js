// WAV (RIFF) の読み書き。依存なしで Node・ブラウザ共通。
//
// 書き出し: 16bit PCM モノラル。
// 読み込み: PCM 8/16/24/32bit・IEEE float 32/64bit、任意チャンネル数
// (マルチチャンネルは平均してモノラル化して返す)。

// pcm: Float32Array (-1..1) → Uint8Array (RIFF/WAVE)
export function writeWav16(pcm, sampleRate) {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const tag = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);            // PCM
  dv.setUint16(22, 1, true);            // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

// bytes: Uint8Array | ArrayBuffer → { pcm: Float32Array(モノラル), sampleRate, channels, bitsPerSample, format }
export function readWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (off) => String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAVファイルではありません (RIFF/WAVEヘッダがありません)');

  let format = 0, channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataOff = -1, dataLen = 0;
  let off = 12;
  while (off + 8 <= dv.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      format = dv.getUint16(off + 8, true);
      channels = dv.getUint16(off + 10, true);
      sampleRate = dv.getUint32(off + 12, true);
      bitsPerSample = dv.getUint16(off + 22, true);
      if (format === 0xfffe && size >= 40) format = dv.getUint16(off + 32, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      dataOff = off + 8; dataLen = Math.min(size, dv.byteLength - dataOff);
    }
    off += 8 + size + (size & 1); // チャンクは2バイト境界
  }
  if (dataOff < 0) throw new Error('dataチャンクが見つかりません');
  if (!channels || !sampleRate) throw new Error('fmt チャンクが不正です');

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLen / (bytesPerSample * channels));
  const pcm = new Float32Array(frames);
  const read = sampleReader(dv, format, bitsPerSample);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      acc += read(dataOff + (i * channels + c) * bytesPerSample);
    }
    pcm[i] = acc / channels;
  }
  return { pcm, sampleRate, channels, bitsPerSample, format };
}

function sampleReader(dv, format, bits) {
  if (format === 3) { // IEEE float
    if (bits === 32) return (o) => dv.getFloat32(o, true);
    if (bits === 64) return (o) => dv.getFloat64(o, true);
    throw new Error(`未対応のfloatビット数: ${bits}`);
  }
  if (format === 1) { // PCM
    if (bits === 8) return (o) => (dv.getUint8(o) - 128) / 128;
    if (bits === 16) return (o) => dv.getInt16(o, true) / 0x8000;
    if (bits === 24) return (o) => {
      const v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
      return (v >= 0x800000 ? v - 0x1000000 : v) / 0x800000;
    };
    if (bits === 32) return (o) => dv.getInt32(o, true) / 0x80000000;
    throw new Error(`未対応のPCMビット数: ${bits}`);
  }
  throw new Error(`未対応のWAVフォーマット: ${format} (PCMかIEEE floatのみ対応)`);
}
