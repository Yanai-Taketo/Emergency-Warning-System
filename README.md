# 緊急警報放送 (EWS) 信号ツール

**▶ 公開サイト: https://yanai-taketo.github.io/Emergency-Warning-System/**
(インストール不要・ブラウザだけで動きます)

日本の**緊急警報放送** (Emergency Warning System) のアナログ音声信号——
いわゆる「ピロピロ音」(640Hz/1024Hz FSK, 64bit/s)——を、
**生成**(全53地域・全信号種別・全パラメーター可変)し、
**解析**(流れているEWS音声からの内容復号、マイク入力のリアルタイム解析対応)
するための学習・検証用ツールです。

ブラウザだけで動きます (GitHub Pages でホスティング可能、ビルド不要)。
同じライブラリを Node.js の CLI・テストからも使用します。

> **注意**
> - 生成した音声を大音量で再生すると、**近くの緊急警報放送対応受信機
>   (EWS対応ラジオ・防災ラジオ等) が実際に起動する可能性があります**。
>   スピーカー再生時は音量と周囲に注意してください。
> - この信号を**電波として送信することは電波法により免許が必要**です。
>   本ツールは音声信号の学習・手元での検証のみを目的としています。

## 一次資料

技術仕様はすべて以下の一次資料からの転記に基づきます (推測を含みません)。
詳細な転記と実装対応表は [docs/SPEC.md](docs/SPEC.md) を参照してください。

1. 無線設備規則 第9条の3「緊急警報信号発生装置」— 変調方式・周波数・伝送速度
2. 昭和60年郵政省告示第405号「無線設備規則第九条の三第五号の規定に基づく
   緊急警報信号の構成」— 信号構成・符号構成・別表第1〜5号 (地域符号ほか)
3. 伊藤泰宏 (NHK放送技術研究所)「緊急警報放送」映像情報メディア学会誌
   Vol.61, No.6, pp.761-763 (2007) — 運用・システム解説

## 使い方 1 — ブラウザ (GitHub Pages / ローカル)

```bash
python3 -m http.server 8000   # リポジトリ直下で
# → http://localhost:8000/
```

- **信号生成**: 信号種別 (第一種開始/第二種開始/終了)・地域 (53地域+任意12ビット)・
  日時 (分単位、偶数ブロックの前後日時規則に反映)・ブロック数・媒体・
  無信号期間・サンプリング周波数・音量をすべて任意に変更して、再生・WAV保存。
  ブロックごとのビット構成を色分け表示。
- **信号解析**: マイク入力のリアルタイム解析、または音声ファイルのドロップ。
  信号種別・地域・月日・時刻・年 (下1桁)・ブロックごとの誤り数を表示。
- **資料**: 符号表・地域符号一覧と一次資料へのリンク。

GitHub Pages を有効化する場合: リポジトリ Settings → Pages → Source を
"GitHub Actions" にすると `.github/workflows/pages.yml` がデプロイします。

## 使い方 2 — CLI (Node.js 18+)

```bash
# 生成: 第二種開始信号 (津波警報で使われる)、和歌山県、4ブロック
node tools/ews-gen.js --kind start --type 2 --area 和歌山県 --out tsunami.wav

# 生成: 終了信号、地域共通、日時指定
node tools/ews-gen.js --kind end --area 地域共通 --date 2026-09-01T11:59 --out end.wav

# 全53地域を一括生成
node tools/ews-gen.js --all-areas out/ --kind start --type 1

# 地域符号一覧
node tools/ews-gen.js --list-areas

# 検証用: 月日・年時区分符号を任意に固定 (告示 注1・注2の自動規則を外す)
node tools/ews-gen.js --kind start --day 17 --month 1 --hoshi-day 1 \
  --hour 5 --year-digit 5 --out custom.wav

# 解析
node tools/ews-decode.js tsunami.wav
node tools/ews-decode.js tsunami.wav --json --verbose
```

解析出力の例:

```
判定       : 第二種開始信号 (4ブロック検出, 誤り合計0ビット)
地域       : 和歌山県 [001110010110]
月日       : 8月6日
時刻       : 13時台
年         : 西暦下1桁6 (候補: 1996, 2006, 2016, 2026)
受信機起動 : 和歌山県に設定された受信機が対象 (広域圏・地域共通の符号でも起動する)
```

## 使い方 3 — ライブラリ (ブラウザ/Node 共通 ES Modules)

```js
import {
  buildSignal, renderSignalPcm, writeWav16,   // 生成
  analyzeSignal, StreamingAnalyzer,           // 解析
} from './src/ews/index.js';

// 生成
const signal = buildSignal({ kind: 'start', type: 1, area: '東京都',
  datetime: { year: 2026, month: 8, day: 6, hour: 13, minute: 30 } });
const { pcm } = renderSignalPcm(signal, 48000);

// 一括解析
const result = analyzeSignal(pcm, 48000);
console.log(result.consensus.classification, result.consensus.area.name);

// リアルタイム解析 (マイクなどのチャンク入力)
const an = new StreamingAnalyzer(48000);
an.push(chunk);              // 到着順に投入
const live = an.analyze();   // いつでも現時点の解析結果を取得
```

## テスト

```bash
node --test
```

告示の表・符号構成との照合、全53地域の生成→音声→解析の往復一致、
雑音 (SNR6dB)・小レベル・44.1kHz/8kHz・録音欠け等の耐性、
ストリーミング解析と一括解析の一致などを検証しています。

## リポジトリ構成

```
index.html            Webアプリ (GitHub Pages対応・ビルド不要)
web/                  UI実装
src/ews/              信号ライブラリ (ブラウザ/Node共通・依存なし)
tools/                CLI (ews-gen.js / ews-decode.js)
test/                 node:test テストスイート
docs/SPEC.md          一次資料の転記と実装対応表
```

## ライセンス

MIT
