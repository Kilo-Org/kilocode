# دليل التثبيت والإعداد

> **نظرة عامة:** كيفية تثبيت وإعداد Kilo Code للتطوير
> **المستوى:** مبتدئ إلى متوسط
> **الوقت المقدر:** 15-30 دقيقة

## 🚀 المتطلبات الأساسية

### 1. النظام

- **macOS:** 10.15+ (Catalina أو أحدث)
- **Windows:** Windows 10 أو أحدث
- **Linux:** Ubuntu 18.04+ أو توزيع مكافئ

### 2. البرامج

```bash
# Node.js (الإصدار المطلوب)
node --version  # 20.19.2 أو أحدث

# pnpm (مدير الحزم)
pnpm --version  # 10.8.1 أو أحدث

# Git (لإدارة المصدر)
git --version   # 2.20.0 أو أحدث
```

### 3. VS Code (للتطوير)

```bash
# تثبيت VS Code
# macOS: brew install --cask visual-studio-code
# Windows: تحميل من https://code.visualstudio.com/
# Linux: sudo apt install code
```

## 📥 خطوات التثبيت

### 1. استنساخ المستودع

```bash
# استنساخ المستودع
git clone https://github.com/Kilo-Org/kilocode.git

# الدخول إلى المجلد
cd kilocode

# التحقق من الفرع
git branch -a
```

### 2. تثبيت الاعتماديات

```bash
# تثبيت جميع الاعتماديات
pnpm install

# التحقق من التثبيت
pnpm list --depth=0
```

### 3. إعداد البيئة

```bash
# نسخ ملف البيئة
cp .env.example .env

# تحرير ملف البيئة
nano .env
```

### 4. التحقق من التثبيت

```bash
# بناء المشروع
pnpm build

# تشغيل الاختبارات
pnpm test

# فحص الكود
pnpm lint
```

## 🔧 إعداد التطوير

### 1. VS Code Extensions

```bash
# الامتدادات الموصى بها
code --install-extension ms-vscode.vscode-typescript-next
code --install-extension esbenp.prettier-vscode
code --install-extension ms-vscode.vscode-eslint
code --install-extension bradlc.vscode-tailwindcss
```

### 2. إعدادات VS Code

```json
// .vscode/settings.json
{
	"typescript.preferences.importModuleSpecifier": "relative",
	"editor.formatOnSave": true,
	"editor.defaultFormatter": "esbenp.prettier-vscode",
	"editor.codeActionsOnSave": {
		"source.fixAll.eslint": true
	}
}
```

### 3. إعدادات Git

```bash
# إعداد Git hooks
pnpm prepare

# التحقق من الإعدادات
git config --list | grep hook
```

## 🏗️ بناء المشروع

### 1. البناء الكامل

```bash
# بناء جميع المكونات
pnpm build

# البناء للإنتاج
pnpm build --production

# البناء مع التحقق
pnpm build && pnpm test
```

### 2. بناء المكونات

```bash
# بناء امتداد VS Code
pnpm vsix

# بناء واجهة الويب
pnpm --filter webview-ui build

# بناء CLI
pnpm cli:build

# بناء ملحق JetBrains
pnpm jetbrains:build
```

### 3. التطوير المحلي

```bash
# تشغيل وضع التطوير
pnpm dev

# تشغيل واجهة الويب
pnpm --filter webview-ui dev

# تشغيل CLI
pnpm cli:run
```

## 🧪 الاختبار

### 1. اختبارات الوحدات

```bash
# تشغيل جميع الاختبارات
pnpm test

# اختبار حزمة معينة
pnpm --filter @roo-code/types test

# اختبار مع التغطية
pnpm test --coverage
```

### 2. اختبارات E2E

```bash
# تشغيل Playwright
pnpm playwright

# اختبار واجهة الويب
pnpm --filter webview-ui playwright

# اختبار امتداد VS Code
pnpm --filter src playwright
```

### 3. الفحص والجودة

```bash
# فحص الكود
pnpm lint

# فحص الأنواع
pnpm check-types

# تنسيق الكود
pnpm format
```

## 🔍 استكشاف الأخطاء

### 1. مشاكل التثبيت

```bash
# مسح التخزين المؤقت
pnpm store prune

# إعادة التثبيت
rm -rf node_modules
pnpm install

# التحقق من الاعتماديات
pnpm why @roo-code/types
```

### 2. مشاكل البناء

```bash
# تنظيف البناء
pnpm clean

# إعادة البناء
pnpm build --force

# التحقق من الأخطاء
pnpm build --verbose
```

### 3. مشاكل التطوير

```bash
# التحقق من البيئة
pnpm env

# التحقق من الروابط
pnpm list --depth=0

# التحقق من الإعدادات
pnpm config list
```

## 📚 المصادر الإضافية

### 1. الوثائق

- [بنية المشروع](../architecture/project-structure.md)
- [دليل التطوير](../development/development-guide.md)
- [نظام البناء](../development/build-system.md)

### 2. المجتمع

- [Discord](https://kilo.ai/discord)
- [GitHub Discussions](https://github.com/Kilo-Org/kilocode/discussions)
- [Reddit](https://www.reddit.com/r/kilocode/)

### 3. الدعم

- [Issues](https://github.com/Kilo-Org/kilocode/issues)
- [Wiki](https://github.com/Kilo-Org/kilocode/wiki)
- [Blog](https://blog.kilo.ai)

---

**الخطوات التالية:** بعد التثبيت، اقرأ [دليل التطوير](../development/development-guide.md) لمعرفة كيفية المساهمة في المشروع.
