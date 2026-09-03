<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | 日本語 | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code、JetBrains、CLI で AI を使って開発するためのオープンソースのコーディングエージェント。</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code は、[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native)、[CLI](https://kilo.ai/cli) など、あなたが作業する場所で使える AI コーディングエージェントです。オープンソースで、透明な価格体系を採用しています。500 以上のモデルから選択し、タスクの途中で切り替え、追加料金なしでモデルプロバイダーの料金を支払います。開始に API キーは不要です。

### インストール

Kilo を実行する場所を選んでください。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code 拡張機能](vscode:extension/kilocode.kilo-code)を直接インストールするか、[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) から入手してください。アカウントを作成すると、GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6、Gemini 3.1 Pro Preview を含む 500 以上のモデルを、すべてプロバイダー価格で利用できます。

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

その後、任意のプロジェクトディレクトリで `kilo` を実行して開始します。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace から [Kilo Code プラグイン](https://plugins.jetbrains.com/plugin/28350-kilo-code)をインストールするか、任意の JetBrains IDE の `Settings → Plugins` で "Kilo Code" を検索してください。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

ローカルマシンなしで、Web から [app.kilo.ai/cloud](https://app.kilo.ai/cloud) で Kilo を実行できます。

</details>

<details>
<summary><strong>コードレビュー</strong></summary>

<br>

[app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) で pull request に自動 AI コードレビューを設定できます。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

[app.kilo.ai/claw](https://app.kilo.ai/claw) で常時稼働する AI エージェントを起動できます。

</details>

<details>
<summary>GitHub Releases から CLI をインストールする（バイナリ）</summary>

[Releases ページ](https://github.com/Kilo-Org/kilocode/releases)から最新のバイナリをダウンロードしてください。

| プラットフォーム | アセット |
|---|---|
| Windows（ほとんどの PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

注: `x64-baseline` は AVX のない古い CPU 向けの互換ビルドです。`musl` は Alpine や glibc のない最小 Docker イメージ向けの静的リンクビルドです。`kilo-vscode-*.vsix` は VS Code 拡張機能パッケージであり、CLI ではありません。`Source code` アーカイブはソースからビルドするためのものです。

</details>

### Agents

Kilo には、タスクに応じて切り替えられる特化型 agents が含まれています。独自のカスタム agents も作成できます。

- **Code** - デフォルト。自然言語からコードを実装、編集します。
- **Plan** - コードを書く前にアーキテクチャを設計し、実装計画を作成します。
- **Ask** - ファイルを変更せずにコードベースに関する質問に答えます。
- **Debug** - 問題のトラブルシューティングと追跡を行います。
- **Review** - 変更をレビューし、パフォーマンス、セキュリティ、スタイル、テストカバレッジの問題を検出します。

[agents とカスタム agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) について詳しく学べます。

### 機能

- 自然言語から複数ファイルにわたる **コード生成**。
- ghost-text 提案と Tab での受け入れに対応した **インライン補完**。
- エージェントが自分の作業をレビューして修正する **セルフチェック**。
- コマンド実行と Web 自動化のための **ターミナルとブラウザ制御**。
- エージェントの機能を拡張する MCP サーバーを見つけて接続する **MCP マーケットプレイス**。
- レイテンシ、コスト、推論能力を作業に合わせるため、タスク途中の切り替えに対応した **500 以上のモデル**。

### 自律モード（CI/CD）

CI/CD パイプライン向けに、プロンプトなしで完全自律動作させるには `kilo run` に `--auto` を指定します。

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` はすべての権限プロンプトを無効にし、エージェントが確認なしで任意の操作を実行できるようにします。信頼できる環境でのみ使用してください。

### ドキュメント

設定やその他の内容については、[ドキュメント](https://kilo.ai/docs)をご覧ください。

### コントリビューション

開発者、ライター、その他すべての方からのコントリビューションを歓迎します。環境設定、コーディング標準、pull request の作成方法については [Contributing Guide](/CONTRIBUTING.md) から始めてください。VS Code 拡張機能と CLI のリリース手順は [RELEASING.md](../RELEASING.md)、JetBrains プラグインについては [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) を参照してください。

参加する前に [Code of Conduct](/CODE_OF_CONDUCT.md) を確認してください。

### ライセンス

MIT。帰属表示とライセンス通知を保持する限り、商用利用を含め、このコードを使用、変更、配布できます。[License](/LICENSE) を参照してください。

### FAQ

<details>
<summary>Kilo CLI はどこから来たのですか？</summary>

Kilo CLI は [OpenCode](https://github.com/anomalyco/opencode) の fork であり、Kilo agentic engineering プラットフォーム内で動作するように強化されています。

</details>

---

**コミュニティに参加** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
