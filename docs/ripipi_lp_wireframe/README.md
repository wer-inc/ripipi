# Ripipi LP ワイヤーフレーム（美容室・サロン向け）

このフォルダは、スマホ優先・1枚完結のLPワイヤー（HTML/CSS/JS）です。Figmaでのデザインに移す前の**クリックできる叩き台**として使えます。

## 使い方

1. `index.html` をブラウザで開くだけで確認できます。
2. ABテスト/セグメント出し分け：URLにクエリを付けて文言を切り替えられます。

```
?variant=a|b|c   // ヒーローコピー A/B/C
?seg=beauty|seitai|food   // セグメント差し替え
?cta=demo|qr     // ヒーローの主要CTAの並び替え
?showPricing=false  // 料金を非表示
```

### 例
`index.html?variant=b&seg=beauty&cta=qr`

## 実装済みセクション

1. ヒーロー（見出し/サブ/CTA×2/デモQR/社会的証明）
2. 価値訴求（3カード）
3. 機能（4カード）
4. 効果の見える化（ノーショー削減額の試算ウィジェット）
5. 導入の流れ（4ステップ）
6. 料金（ライト/スタンダード/プロ）
7. FAQ
8. 最後のCTA＋デモフォーム（店名/電話 or LINEログイン）

## Figmaに移す時のガイド（Auto Layout前提）

- フレーム: iPhone 15 Pro（390×844）/ Desktop（1440×900）
- ベース: 余白多め・黒文字・白背景・アクセント1色。トークン：
  - `--accent` = `#10b981`（好みに合わせて変更）
  - Corner radius = 14
  - シャドウ = 0 6 16 / 6%
- コンポーネント
  - Button（Primary/Ghost/Line）: 高さ 48/56, 角丸 16, アイコンは任意
  - Card（Default/Recommended）: Padding 16, Gap 8, 角丸 14
  - Section: 上下 48（mobile） / 72（desktop）
  - Header: Sticky, 透明背景 + 1px border
- タイポ（Noto Sans JP）
  - H1: 28 → Desktop 32
  - H2: 20 → Desktop 24
  - Body: 16, 行間 1.6

## 計測（差し替えポイント）
- `data-track` 属性でイベント名を添付済み。`script.js` の `track()` を GA4 に置き換えてください。
- 推奨イベント: `view_hero`, `cta_click_demo`, `cta_click_qr`, `roi_calc`, `lead_submit` など。

## 差替え TODO
- ヒーローの社会的証明（実数・ロゴ）
- デモQR（`assets/qr-placeholder.svg` を本番QRに置換）
- プラン内容・金額の最終確定
- LINEログインの実装（LIFFのURL/SDK）

---

著作権 © 2025 Ripipi
