<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | বাংলা | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code, JetBrains বা CLI-তে AI দিয়ে তৈরি করার জন্য ওপেন সোর্স কোডিং এজেন্ট।</p>

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

Kilo Code হলো একটি AI কোডিং এজেন্ট যা আপনি যেখানে কাজ করেন সেখানেই কাজ করে: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) এবং [CLI](https://kilo.ai/cli)। এটি ওপেন সোর্স এবং খোলা মূল্যনীতির। আপনি 500টির বেশি মডেল থেকে বেছে নিতে পারেন, কাজের মাঝখানে মডেল বদলাতে পারেন এবং কোনো অতিরিক্ত চার্জ ছাড়াই মডেল প্রদানকারীর রেট পরিশোধ করেন। শুরু করতে API key দরকার নেই।

### ইনস্টলেশন

আপনি কোথায় Kilo চালাতে চান তা বেছে নিন।

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code extension](vscode:extension/kilocode.kilo-code) সরাসরি ইনস্টল করুন, অথবা [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) থেকে নিন। একটি অ্যাকাউন্ট তৈরি করলে GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 এবং Gemini 3.1 Pro Preview সহ 500টির বেশি মডেলে প্রদানকারীর দামে অ্যাক্সেস পাবেন।

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

তারপর শুরু করতে যেকোনো প্রজেক্ট ডিরেক্টরিতে `kilo` চালান।

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

JetBrains Marketplace থেকে [Kilo Code plugin](https://plugins.jetbrains.com/plugin/28350-kilo-code) ইনস্টল করুন, অথবা যেকোনো JetBrains IDE-তে `Settings → Plugins`-এ "Kilo Code" খুঁজুন।

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

লোকাল মেশিন ছাড়াই ওয়েব থেকে [app.kilo.ai/cloud](https://app.kilo.ai/cloud)-এ Kilo চালান।

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

[app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)-এ আপনার pull request-এ স্বয়ংক্রিয় AI code review সেট আপ করুন।

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

[app.kilo.ai/claw](https://app.kilo.ai/claw)-এ আপনার always-on AI agent চালু করুন।

</details>

<details>
<summary>GitHub Releases থেকে CLI ইনস্টল করুন (বাইনারি)</summary>

[Releases page](https://github.com/Kilo-Org/kilocode/releases) থেকে সর্বশেষ বাইনারি ডাউনলোড করুন।

| প্ল্যাটফর্ম | Asset |
|---|---|
| Windows (বেশিরভাগ PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

নোট: `x64-baseline` হলো AVX ছাড়া পুরোনো CPU-এর জন্য compatibility build। `musl` হলো Alpine বা glibc ছাড়া minimal Docker image-এর জন্য statically linked build। `kilo-vscode-*.vsix` হলো VS Code extension package, CLI নয়। `Source code` archive source থেকে build করার জন্য।

</details>

### Agents

Kilo বিশেষায়িত agents সহ আসে, কাজ অনুযায়ী আপনি এগুলোর মধ্যে বদলাতে পারেন। আপনি নিজের custom agents-ও বানাতে পারেন।

- **Code** - ডিফল্ট। প্রাকৃতিক ভাষা থেকে কোড implement এবং edit করে।
- **Plan** - কোনো কোড লেখার আগে architecture design করে এবং implementation plan লেখে।
- **Ask** - কোনো ফাইল না ছুঁয়ে আপনার codebase সম্পর্কে প্রশ্নের উত্তর দেয়।
- **Debug** - সমস্যা troubleshoot এবং trace করে।
- **Review** - আপনার পরিবর্তন review করে এবং performance, security, style ও test coverage-এর সমস্যা তুলে ধরে।

[agents এবং custom agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) সম্পর্কে আরও জানুন।

### এটি কী করে

- প্রাকৃতিক ভাষা থেকে একাধিক ফাইলে **code generation**।
- ghost-text suggestion এবং Tab দিয়ে accept করার **inline autocomplete**।
- agent যেন নিজের কাজ review ও correct করে তার জন্য **self-checking**।
- command চালানো এবং web automate করার জন্য **terminal ও browser control**।
- agent-এর ক্ষমতা বাড়ায় এমন MCP server খুঁজে ও যুক্ত করার জন্য **MCP marketplace**।
- latency, cost এবং reasoning কাজের সাথে মেলাতে mid-task switching সহ **500টির বেশি model**।

### Autonomous Mode (CI/CD)

CI/CD pipeline-এর জন্য prompts ছাড়া পুরোপুরি autonomous operation পেতে `kilo run`-এর সাথে `--auto` ব্যবহার করুন:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` সব permission prompt বন্ধ করে এবং agent-কে confirmation ছাড়া যেকোনো action execute করতে দেয়। শুধু trusted environment-এ ব্যবহার করুন।

### ডকুমেন্টেশন

Configuration এবং বাকি সবকিছুর জন্য [docs](https://kilo.ai/docs) দেখুন।

### Contributing

Developer, writer এবং সবাইকে contribution-এর জন্য স্বাগতম। environment setup, coding standard এবং pull request খোলার পদ্ধতির জন্য [Contributing Guide](/CONTRIBUTING.md) দিয়ে শুরু করুন। VS Code extension এবং CLI release process-এর জন্য [RELEASING.md](../RELEASING.md), এবং JetBrains plugin-এর জন্য [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) দেখুন।

অংশ নেওয়ার আগে আমাদের [Code of Conduct](/CODE_OF_CONDUCT.md) পড়ুন।

### License

MIT। attribution এবং license notice রেখে আপনি এই code ব্যবহার, পরিবর্তন এবং distribute করতে পারেন, commercial ব্যবহারসহ। [License](/LICENSE) দেখুন।

### FAQ

<details>
<summary>Kilo CLI কোথা থেকে এসেছে?</summary>

Kilo CLI হলো [OpenCode](https://github.com/anomalyco/opencode)-এর একটি fork, Kilo agentic engineering platform-এর মধ্যে কাজ করার জন্য উন্নত করা হয়েছে।

</details>

---

**কমিউনিটিতে যোগ দিন** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
