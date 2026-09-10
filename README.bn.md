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
  বাংলা |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">ওপেন সোর্স AI কোডিং এজেন্ট — OpenCode v2-এর ওপর Kilo।</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> এই ব্রাঞ্চটি ডেভেলপমেন্ট প্রিভিউ, প্রকাশিত Kilo পণ্য বা v1-এর ওপর সরাসরি আপগ্রেড নয়। মূল Kilo ইন্টারফেস রেখে রানটাইম v2-তে স্থানান্তর করা হচ্ছে। প্রিভিউটি আলাদা `kilo2` স্টোরেজ ব্যবহার করে; আমদানি স্পষ্টভাবে শুরু করতে হয়। বিদ্যমান v1 ডেটা স্বয়ংক্রিয়ভাবে স্থানান্তরিত হয় না।

---

### ইনস্টলেশন

Bun 1.4 বা নতুন সংস্করণ ব্যবহার করুন। এই চেকআউটে নির্ভরতা ইনস্টল করে CLI বা VS Code বেছে নিন। নতুন ইনস্টলেশন ও সব প্ল্যাটফর্মের রিলিজ যাচাই এখনো সম্পূর্ণ হয়নি। প্রকাশিত npm প্যাকেজ ও Marketplace সংস্করণ এই ব্রাঞ্চ ইনস্টল করে না।

```sh
bun install
```

#### CLI

Kilo-এর ইন্টারঅ্যাকটিভ CLI খুলুন। প্রকল্পের ডিরেক্টরি দেওয়া যায়, যেমন `bun run dev /path/to/project`।

```sh
bun run dev
```

#### VS Code

মূল Kilo এক্সটেনশন বিল্ড করে আলাদা VS Code ডেভেলপমেন্ট প্রোফাইলে খুলুন। VS Code ইনস্টল করে PATH-এ `code` যোগ করুন, অথবা `VSCODE_BIN` সেট করুন। এক্সটেনশন নিজেই স্থানীয় সার্ভার চালু করে। এক্সটেনশনের স্থানান্তর এখনো অসম্পূর্ণ।

```sh
bun run extension
```

### এজেন্ট

**Code** পরিবর্তন বাস্তবায়ন করে। **Plan** অনুসন্ধান করে, অনুমান যাচাই করে, পরিকল্পনা সংরক্ষণ করে এবং বাস্তবায়নে যাওয়ার বিকল্প দেয়। **Ask** ফাইল না বদলে উত্তর দেয়। **Debug** সমস্যা অনুসন্ধান করে। নিজস্ব এজেন্ট কনফিগার করা যায়। উপলব্ধ টুল ও অনুমতি কনফিগারেশনের ওপর নির্ভর করে।

### এটি কী করে

নেটিভ কথোপকথন, টুল ও অনুমতি, Gateway মডেল ও অ্যাকাউন্ট, সেটিংস, মেমরি, ইনডেক্সিং, স্যান্ডবক্স ও টার্মিনাল অ্যাডাপ্টারের কিছু অংশ বাস্তবায়িত হয়েছে। মূল VS Code-এর সম্পূর্ণ সমতা, JetBrains, অটো-কমপ্লিশন/FIM, ভয়েস এবং কিছু ক্লাউড কার্যপ্রবাহ অসম্পূর্ণ। শেয়ারিং, স্থাপিত পরিষেবা যাচাই, স্বাক্ষর ও বহু-প্ল্যাটফর্ম বিতরণের শর্তও বাকি আছে। সোর্স কোড থাকা মানেই শুরু থেকে শেষ পর্যন্ত যাচাই সম্পূর্ণ নয়।

### ডকুমেন্টেশন

ব্রাঞ্চের অবস্থা জানতে মাইগ্রেশন পরিকল্পনা ও পরীক্ষার পরিকল্পনা দেখুন। সাধারণ Kilo ডকুমেন্টেশন প্রকাশিত পণ্যের জন্য; এই প্রিভিউয়ের সঙ্গে পার্থক্য থাকতে পারে।

- [মাইগ্রেশনের অগ্রগতি (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [মাইগ্রেশন ট্র্যাকিং](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### অবদান

অবদান স্বাগত। শেয়ার করা কোড বদলানোর আগে অবদান নির্দেশিকা ও v2 ফর্কের নিয়ম পড়ুন। সম্ভব হলে Kilo-এর আচরণ নিজস্ব প্যাকেজে রাখুন, প্রভাবিত প্যাকেজ যাচাই করুন এবং মূল প্রকল্পের স্বীকৃতি বজায় রাখুন।

- [অবদান](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### লাইসেন্স

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI কোথা থেকে এসেছে?</summary>

Kilo CLI হলো [OpenCode](https://github.com/anomalyco/opencode)-এর একটি fork, Kilo agentic engineering platform-এর মধ্যে কাজ করার জন্য উন্নত করা হয়েছে।

</details>
