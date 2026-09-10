<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  日本語 |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">オープンソースの AI コーディングエージェント — OpenCode v2 上の Kilo。</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> このブランチは開発プレビューであり、公開済みの Kilo 製品や v1 の上書きアップグレードではありません。元の Kilo UI を維持しながらランタイムを v2 に移行しています。独立した `kilo2` ストレージを使用し、インポートは明示的に行います。既存の v1 データは自動移行されません。

---

### インストール

Bun 1.4 以降を使用してください。このチェックアウトで依存関係をインストールし、CLI または VS Code を選びます。新規インストールと全プラットフォームのリリース検証は未完了です。公開済み npm パッケージや Marketplace 版では、このブランチはインストールされません。

```sh
bun install
```

#### CLI

Kilo の対話型 CLI を開きます。`bun run dev /path/to/project` のようにプロジェクトを指定できます。

```sh
bun run dev
```

#### VS Code

元の Kilo 拡張機能をビルドし、独立した VS Code 開発プロファイルで開きます。VS Code をインストールして `code` を PATH に追加するか、`VSCODE_BIN` を設定してください。拡張機能はローカルサーバーを自動起動します。移行はまだ未完了です。

```sh
bun run extension
```

### エージェント

**Code** は変更を実装します。**Plan** は調査し、前提を問い直し、計画を保存して実装への引き継ぎを提案します。**Ask** はファイルを編集せずに回答します。**Debug** は問題を調査します。カスタムエージェントも設定できます。ツールと権限は設定に依存します。

### 機能

ネイティブ会話、ツールと権限、Gateway のモデル・アカウント統合、設定、メモリ、索引、サンドボックス、端末アダプターの一部が実装済みです。元の VS Code の完全な機能互換、JetBrains、補完/FIM、音声、一部クラウド機能は未完了です。共有、配備済みサービスの検証、署名、各プラットフォームへの配布も未検証の項目があります。ソースの存在だけでエンドツーエンドの合格とはいえません。

### ドキュメント

このブランチの状況は移行計画とテスト計画を参照してください。一般の Kilo ドキュメントは公開製品向けであり、このプレビューとは異なる場合があります。

- [移行の進捗 (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [移行状況の管理](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### コントリビューション

貢献を歓迎します。共有コードを変更する前に貢献ガイドと v2 フォーク規約を読んでください。可能な限り Kilo 専用パッケージに処理を置き、影響するパッケージを検証し、上流の帰属表示を保持してください。

- [コントリビューション](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### ライセンス

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI はどこから来たのですか？</summary>

Kilo CLI は [OpenCode](https://github.com/anomalyco/opencode) の fork であり、Kilo agentic engineering プラットフォーム内で動作するように強化されています。

</details>
