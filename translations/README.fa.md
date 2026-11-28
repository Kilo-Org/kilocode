<p align="center">
	<a href="../README.md">English</a> | 
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
	<a href="README.bn.md">বাংলা</a> | 
	<a href="README.gr.md">Ελληνικά</a> | 
	<a href="README.vi.md">Tiếng Việt</a> | 
	<a href="README.fa.md">فارسی</a>  
</p>

<div dir="rtl">

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">یک ایجنت کدنویسی متن‌باز برای توسعه با هوش مصنوعی در VS Code، JetBrains یا محیط خط فرمان CLI.</p>

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

«کیلو کد» (Kilo Code) یک دستیار برنامه‌نویسی مبتنی بر هوش مصنوعی است که در هر محیط کاری که استفاده می‌کنید — شامل [VS Code](https://kilo.ai/landing/vs-code)، [JetBrains](https://kilo.ai/features/jetbrains-native) و [CLI](https://kilo.ai/cli) — در دسترس شماست. این ابزار متن‌باز (Open Source) است و مدل قیمت‌گذاری شفافی دارد. شما می‌توانید از میان بیش از ۵۰۰ مدل مختلف انتخاب کنید، در حین انجام کار بین آن‌ها جابه‌جا شوید و دقیقاً همان هزینه‌ای را بپردازید که ارائه‌دهنده مدل تعیین کرده است (بدون هیچ‌گونه هزینه اضافی یا افزایش قیمت). برای شروع کار، نیازی به داشتن کلید API نیست.

### نصب

انتخاب کنید که می‌خواهید Kilo را کجا اجرا کنید.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

افزونه [Kilo Code](vscode:extension/kilocode.kilo-code) را مستقیماً نصب کنید یا آن را از [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) دریافت نمایید. با ایجاد حساب کاربری، به بیش از ۵۰۰ مدل مختلف — از جمله GPT-6 Astra، Claude Fable 5.1، Gemini 3.8 Flash، Grok 4.6 و DeepSeek V4.1 Flash — دسترسی خواهید داشت که همگی با قیمت‌گذاریِ ارائه‌دهندگان اصلی در دسترس هستند.

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

سپس برای شروع، در هر دایرکتوریِ پروژه، دستور `kilo` را اجرا کنید.

</details>

<details>
<summary><strong>JetBrains</strong></summary>
<br>
افزونه [Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) را از JetBrains Marketplace نصب کنید، یا در هر یک از محیط‌های توسعه (IDE) جت‌برینز (JetBrains)، عبارت «Kilo Code» را در مسیر `Settings → Plugins` جستجو نمایید.
<br><br>
</details>

<details>
<summary><strong>Cloud Agent</strong></summary>
<br>
Kilo را از طریق وب اجرا کنید — بدون نیاز به سیستم محلی — در [app.kilo.ai/cloud](https://app.kilo.ai/cloud).
<br><br>
</details>

<details>
<summary><strong>بازبینی‌های کد</strong></summary>
<br>
در [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews)، برای پول‌ریکوئست‌های (pull requests) خود، بازبینی خودکار کد توسط هوش مصنوعی را راه‌اندازی کنید.
<br><br>
</details>

<details>
<summary>رابط خط فرمان (CLI) را از بخش Releases در گیت‌هاب (فایل‌های اجرایی) نصب کنید.</summary>

آخرین فایل باینری را از [صفحهٔ انتشارها (Releases)](https://github.com/Kilo-Org/kilocode/releases) دانلود کنید.

<p>
| پلتفرم | دارایی |
<br>
|---|---|
<br>
| Windows (اکثر PC ها) | `kilo-windows-x64.zip` |
<br>
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
<br>
| macOS (Intel) | `kilo-darwin-x64.zip` |
<br>
| Linux x64 | `kilo-linux-x64.tar.gz` |
<br>
| Linux ARM | `kilo-linux-arm64.tar.gz` |
</p>


نکته:
- نسخه `x64-baseline` یک نسخه سازگار برای پردازنده‌های قدیمی‌تر فاقد قابلیت AVX است.
- نسخه `musl` نسخه‌ای با پیوند ایستا (statically linked) است که برای سیستم‌عامل Alpine یا ایمیج‌های حداقلی داکر (Docker) که فاقد کتابخانه glibc هستند، کاربرد دارد.
- فایل `kilo-vscode-*.vsix` بسته افزونه VS Code است و نه ابزار خط فرمان (CLI).
- آرشیوهای «کد منبع» (Source code) برای کامپایل و ساخت برنامه از روی کد منبع در نظر گرفته شده‌اند.

</details>

### Agents

Kilo به همراه عامل‌های تخصصی‌ای عرضه می‌شود که می‌توانید بسته به نوع وظیفه، بین آن‌ها جابه‌جا شوید. همچنین می‌توانید عامل‌های سفارشی خودتان را بسازید.

- **Code** - گزینه پیش‌فرض. پیاده‌سازی و ویرایش کد بر اساس زبان طبیعی.
- **Plan** - پیش از نوشتن هرگونه کد، معماری را طراحی کرده و برنامه‌های پیاده‌سازی را تدوین می‌کند.
- **Ask** - بدون دست‌کاری هیچ فایلی، به پرسش‌های مربوط به پایگاه کد (codebase) شما پاسخ می‌دهد.
- **Debug** - عیب‌یابی و ردیابی مشکلات.
- **Review** - تغییرات شما را بازبینی کرده و مشکلات مربوط به عملکرد، امنیت، سبک و پوشش تست را شناسایی می‌کند.

درباره [ایجنت‌ها و ایجنت‌های سفارشی](https://kilo.ai/docs/code-with-ai/agents/using-agents) بیشتر بدانید.

### عملکرد آن

- **تولید کد** از زبان طبیعی، در چندین فایل.
- **تکمیل خودکار درون‌خطی** (Inline autocomplete) همراه با پیشنهادهایی به صورت متن کم‌رنگ (ghost-text) و امکان پذیرش آن‌ها با کلید Tab.
- **خودارزیابی**، به‌طوری که عامل، کار خود را بازبینی و اصلاح می‌کند.
- **کنترل ترمینال و مرورگر** برای اجرای دستورات و خودکارسازی وب.
- **Kilo Marketplace** برای نصب ایجنت‌ها، مهارت‌ها، سرورهای MCP و افزونه‌هایی که قابلیت‌های ایجنت را گسترش می‌دهند.
- **بیش از ۵۰۰ مدل** با قابلیت تغییر در حین انجام کار؛ بدین ترتیب می‌توانید تأخیر، هزینه و قدرت استدلال را متناسب با نوع وظیفه تنظیم کنید.

### حالت خودکار (CI/CD)

برای عملکرد کاملاً خودکار و بدون نیاز به هیچ‌گونه پرسش یا ورودی، دستور `kilo run` را با گزینه `--auto` اجرا کنید؛ این قابلیت برای پایپ‌لاین‌های CI/CD طراحی شده است:

```bash
kilo run --auto "run tests and fix any failures"
```

گزینه `--auto` درخواست‌های مجوز را به‌طور خودکار تأیید می‌کند، مگر اینکه قاعده‌ای صراحتا آن اقدام را رد کرده باشد. تنها در محیط‌های قابل‌اعتماد از آن استفاده کنید.

### مستندات

برای پیکربندی و سایر موارد، [به مستندات مراجعه کنید](https://kilo.ai/docs).

### مشارکت

از مشارکت توسعه‌دهندگان، نویسندگان و تمامی افراد دیگر استقبال می‌شود. برای اطلاع از نحوه آماده‌سازی محیط توسعه، استانداردهای کدنویسی و چگونگی ارسال «درخواست ادغام» (Pull Request)، به [راهنمای مشارکت](/CONTRIBUTING.md) مراجعه کنید. همچنین برای آگاهی از فرآیند انتشار افزونه VS Code و ابزار خط فرمان (CLI)، فایل [RELEASING.md](RELEASING.md) را مطالعه نمایید؛ برای افزونه JetBrains نیز به فایل [packages/kilo-jetbrains/RELEASING.md](packages/kilo-jetbrains/RELEASING.md) مراجعه کنید.

لطفاً پیش از مشارکت، [مرام‌نامه](/CODE_OF_CONDUCT.md) ما را مطالعه کنید.

### مجوز

MIT. شما آزادید که از این کد استفاده کنید، آن را تغییر دهید و توزیع نمایید (از جمله برای مقاصد تجاری)، مشروط بر اینکه ارجاع به منبع و یادداشت‌های مربوط به مجوز را حفظ کنید. به [License](/LICENSE) مراجعه کنید.

### پرسش‌های متداول

<details>
<summary>Kilo CLI از کجا آمده است؟</summary>

Kilo CLI انشعابی (fork) از [OpenCode](https://github.com/anomalyco/opencode) است که برای کار در بستر پلتفرم مهندسی عامل‌محور (agentic engineering) Kilo، ارتقا یافته است.

</details>

---

**به جامعه بپیوندید** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)

</div>
