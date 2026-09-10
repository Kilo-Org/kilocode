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
  العربية |
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

<p align="center">وكيل البرمجة بالذكاء الاصطناعي مفتوح المصدر — Kilo على OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> هذا الفرع معاينة تطوير، وليس منتج Kilo المنشور أو ترقية تستبدل v1. يحتفظ بواجهة Kilo الأصلية مع نقل بيئة التشغيل إلى v2. تستخدم المعاينة تخزين `kilo2` منفصلًا، ويجب بدء الاستيراد صراحةً. لا تُنقل بيانات v1 تلقائيًا.

---

### التثبيت

استخدم Bun 1.4 أو أحدث. ثبّت الاعتماديات من نسخة المستودع هذه، ثم اختر CLI أو VS Code. لم يكتمل التحقق من التثبيت الجديد وجميع المنصات للإصدار بعد. حزم npm وإصدارات Marketplace المنشورة لا تثبّت هذا الفرع.

```sh
bun install
```

#### CLI

افتح واجهة Kilo التفاعلية لسطر الأوامر. يمكنك تحديد مجلد المشروع، مثل `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

ابنِ إضافة Kilo الأصلية وافتحها في ملف تطوير معزول لـ VS Code. ثبّت VS Code وأضف `code` إلى PATH، أو اضبط `VSCODE_BIN`. تبدأ الإضافة خادمها المحلي تلقائيًا. نقل الإضافة لم يكتمل بعد.

```sh
bun run extension
```

### الوكلاء

ينفّذ **Code** التغييرات. يبحث **Plan** ويفحص الافتراضات ويحفظ خطة ويعرض الانتقال إلى التنفيذ. يجيب **Ask** دون تعديل الملفات. يبحث **Debug** في المشكلات. يمكن إعداد وكلاء مخصصين. تعتمد الأدوات والصلاحيات المتاحة على الإعدادات.

### ما الذي يفعله

نُفذت أجزاء من المحادثات الأصلية والأدوات والصلاحيات وتكامل نماذج وحسابات Gateway والإعدادات والذاكرة والفهرسة والعزل والطرفيات. لا يزال التكافؤ الكامل مع VS Code الأصلي وJetBrains والإكمال التلقائي/FIM والصوت وبعض مسارات السحابة غير مكتمل. ما زالت هناك متطلبات للمشاركة والتحقق من الخدمات المنشورة والتوقيع والتوزيع عبر المنصات. وجود الشيفرة لا يعني اجتياز التحقق الشامل.

### التوثيق

راجع خطة الانتقال وخطط الاختبار لمعرفة حالة الفرع. تصف وثائق Kilo العامة المنتج المنشور وقد تختلف عن هذه المعاينة.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### المساهمة

نرحّب بالمساهمات. اقرأ دليل المساهمة وقواعد تفرع v2 قبل تغيير الشيفرة المشتركة. ضع سلوك Kilo في حزمه الخاصة متى أمكن، وتحقق من الحزم المتأثرة، وحافظ على نسب العمل إلى المشروع الأصلي.

- [المساهمة](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### الترخيص

[MIT](LICENSE)

### FAQ

<details>
<summary>من أين جاء Kilo CLI؟</summary>

Kilo CLI هو fork من [OpenCode](https://github.com/anomalyco/opencode)، وتم تحسينه للعمل داخل منصة Kilo agentic engineering.

</details>
