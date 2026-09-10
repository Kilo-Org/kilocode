<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  繁體中文 |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
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

<p align="center">開源 AI 程式開發代理 — 基於 OpenCode v2 的 Kilo。</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> 此分支是開發預覽版，不是已發布的 Kilo 產品，也不是 v1 的原地升級。它保留 Kilo 原有介面，並將執行環境遷移至 v2。預覽版使用獨立的 `kilo2` 儲存空間；匯入必須明確執行，不會自動遷移現有 v1 資料。

---

### 安裝

請使用 Bun 1.4 或更新版本。在此程式碼目錄安裝相依套件後，選擇下方的 CLI 或 VS Code 工作流程。全新安裝及所有平台尚未完成發布驗證。已發布的 npm 套件和 Marketplace 版本不會安裝此分支。

```sh
bun install
```

#### CLI

啟動 Kilo 互動式 CLI。可指定專案目錄，例如 `bun run dev /path/to/project`。

```sh
bun run dev
```

#### VS Code

建置並在獨立的 VS Code 開發設定中開啟原有 Kilo 擴充功能。請先安裝 VS Code，將 `code` 加入 PATH，或設定 `VSCODE_BIN`。擴充功能會自動啟動本機伺服器。遷移仍未完成。

```sh
bun run extension
```

### 代理

**Code** 實作變更。**Plan** 調查問題、質疑假設、儲存計畫，並提供轉入實作階段的選項。**Ask** 回答問題而不編輯檔案。**Debug** 排查問題。仍可設定自訂代理。可用工具與權限取決於設定。

### 功能

已實作的部分包括原生對話、工具與權限、Gateway 模型與帳戶整合、設定、記憶、索引、沙箱與終端機介接。完整的原有 VS Code 功能對等、JetBrains、自動補全/FIM、語音及部分雲端流程仍待完成。分享、已部署服務驗證、簽署與跨平台散布仍有未完成的驗收條件。有原始碼不代表已通過端對端驗收。

### 文件

請參閱遷移計畫與測試計畫，了解此分支的狀態。Kilo 通用文件介紹的是已發布產品，可能與此預覽版不同。

- [遷移進度 (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [遷移追蹤](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### 貢獻

歡迎貢獻。修改共用程式碼前，請閱讀貢獻指南與 v2 分支慣例。盡可能將 Kilo 行為放在專屬套件中，驗證受影響的套件，並保留上游署名。

- [貢獻](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### 授權

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI 從何而來？</summary>

Kilo CLI 是 [OpenCode](https://github.com/anomalyco/opencode) 的 fork，並增強為可在 Kilo agentic engineering 平台中使用。

</details>
