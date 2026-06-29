<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | 繁體中文 | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">用於在 VS Code、JetBrains 或 CLI 中運用 AI 建構的開源編碼代理。</p>

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

Kilo Code 是一個 AI 編碼代理，可在你工作的任何地方使用：[VS Code](https://kilo.ai/landing/vs-code)、[JetBrains](https://kilo.ai/features/jetbrains-native) 和 [CLI](https://kilo.ai/cli)。它是開源專案，並採用開放定價。你可以從 500 多個模型中選擇，在任務中途切換模型，並按模型供應商的價格付費，沒有加價。開始使用不需要 API 金鑰。

### 安裝

選擇你想執行 Kilo 的位置。

<details open>
<summary><strong>VS Code</strong></summary>

<br>

直接安裝 [Kilo Code 擴充功能](vscode:extension/kilocode.kilo-code)，或從 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) 取得。建立帳戶後，你可以按供應商價格使用 500 多個模型，包括 GPT-5.5、Claude Opus 4.7、Claude Sonnet 4.6 和 Gemini 3.1 Pro Preview。

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

然後在任何專案目錄中執行 `kilo` 即可開始。

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

從 JetBrains Marketplace 安裝 [Kilo Code 外掛](https://plugins.jetbrains.com/plugin/28350-kilo-code)，或在任何 JetBrains IDE 的 `Settings → Plugins` 中搜尋 "Kilo Code"。

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

無需本機電腦，在 Web 上透過 [app.kilo.ai/cloud](https://app.kilo.ai/cloud) 執行 Kilo。

</details>

<details>
<summary><strong>程式碼審查</strong></summary>

<br>

在 [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) 為你的 Pull Request 設定自動 AI 程式碼審查。

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

在 [app.kilo.ai/claw](https://app.kilo.ai/claw) 啟動你的常駐 AI 代理。

</details>

<details>
<summary>從 GitHub Releases 安裝 CLI（二進位檔）</summary>

從 [Releases 頁面](https://github.com/Kilo-Org/kilocode/releases) 下載最新二進位檔。

| 平台 | 資源 |
|---|---|
| Windows（大多數 PC） | `kilo-windows-x64.zip` |
| macOS（Apple Silicon） | `kilo-darwin-arm64.zip` |
| macOS（Intel） | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

注意：`x64-baseline` 是面向不支援 AVX 的舊 CPU 的相容性建置。`musl` 是面向 Alpine 或沒有 glibc 的極簡 Docker 映像的靜態連結建置。`kilo-vscode-*.vsix` 是 VS Code 擴充功能套件，不是 CLI。`Source code` 封存檔用於從原始碼建置。

</details>

### Agents

Kilo 內建可依任務切換的專用 Agents。你也可以建立自己的自訂 Agents。

- **Code** - 預設。根據自然語言實作和編輯程式碼。
- **Plan** - 在撰寫任何程式碼之前設計架構並撰寫實作計畫。
- **Ask** - 回答關於程式碼庫的問題，不修改任何檔案。
- **Debug** - 疑難排解並追蹤問題。
- **Review** - 審查你的變更，並找出效能、安全性、風格和測試覆蓋率方面的問題。

深入了解 [agents 和自訂 agents](https://kilo.ai/docs/code-with-ai/agents/using-agents)。

### 功能

- **程式碼產生**：以自然語言跨多個檔案產生程式碼。
- **行內自動完成**：提供 ghost-text 建議，按 Tab 接受。
- **自我檢查**：讓代理審查並修正自己的工作。
- **終端機和瀏覽器控制**：執行命令並自動化網頁操作。
- **MCP 市集**：尋找並連接 MCP 伺服器，擴充代理能力。
- **500 多個模型**：支援任務中途切換，讓你根據延遲、成本和推理能力匹配任務。

### 自主模式（CI/CD）

使用 `--auto` 執行 `kilo run`，可在 CI/CD 管線中進行無提示的完全自主操作：

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` 會停用所有權限提示，並允許代理在無需確認的情況下執行任何操作。僅在可信任環境中使用。

### 文件

關於設定和其他內容，請查看[文件](https://kilo.ai/docs)。

### 貢獻

歡迎開發者、作者以及所有人參與貢獻。請先閱讀 [Contributing Guide](/CONTRIBUTING.md)，了解環境設定、程式碼標準以及如何建立 Pull Request。VS Code 擴充功能和 CLI 的發布流程請參閱 [RELEASING.md](../RELEASING.md)，JetBrains 外掛請參閱 [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md)。

參與前請閱讀我們的 [Code of Conduct](/CODE_OF_CONDUCT.md)。

### 授權

MIT。你可以使用、修改和散布此程式碼，包括商業用途，只要保留署名和授權聲明。請參閱 [License](/LICENSE)。

### FAQ

<details>
<summary>Kilo CLI 從何而來？</summary>

Kilo CLI 是 [OpenCode](https://github.com/Kilo-Org/kilocode) 的 fork，並增強為可在 Kilo agentic engineering 平台中使用。

</details>

---

**加入社群** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
