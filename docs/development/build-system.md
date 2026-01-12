# نظام البناء وسير العمل التطويري

> **نظرة عامة:** نظام البناء المتوازي وسير العمل التطويري
> **الأدوات:** Turbo + pnpm + TypeScript + esbuild
> **الهدف:** بناء فعال وقابل للتوسع

## 🏗️ نظرة عامة على البنية

نظام البناء يستخدم Turbo لتنفيذ المهام بشكل متوازٍ عبر جميع حزم مساحة العمل، مع pnpm لإدارة الاعتماديات.

### المكونات الرئيسية

```
بنية النظام:
├── pnpm-workspace.yaml   # إعدادات مساحة العمل
├── turbo.json           # إعدادات Turbo
├── package.json         # الأوامر الرئيسية
├── scripts/             # سكربتات مخصصة
└── .husky/              # Git hooks
```

## 🚀 إعداد البيئة

### 1. المتطلبات الأساسية

```bash
# Node.js الإصدار المطلوب
node --version  # 20.19.2

# pnpm مدير الحزم
pnpm --version  # 10.8.1

# تثبيت الاعتماديات
pnpm install
```

### 2. التمهيد التلقائي

```javascript
// scripts/bootstrap.mjs
// يتم تشغيله تلقائياً قبل التثبيت
// يقوم بإعداد البيئة والاعتماديات
```

### 3. Git Hooks

```bash
# إعداد Git hooks تلقائياً
pnpm prepare

# التحقق من الكود قبل ال commit
husky pre-commit
```

## 📦 أوامر البناء

### 1. الأوامر الأساسية

```bash
# بناء المشروع بأكمله
pnpm build

# بناء جميع الحزم
pnpm bundle

# البناء للإصدار الإنتاجي
pnpm vsix:production

# البناء للنسخة الليلية
pnpm bundle:nightly
```

### 2. الفحص والجودة

```bash
# فحص الكود
pnpm lint

# فحص الأنواع
pnpm check-types

# تشغيل الاختبارات
pnpm test

# تنسيق الكود
pnpm format
```

### 3. التنظيف

```bash
# تنظيف الملفات المؤقتة
pnpm clean

# إزالة ملفات البناء
rimraf dist out bin .vite-port .turbo
```

## ⚡ نظام Turbo

### 1. إعدادات المهام

```json
// turbo.json
{
	"$schema": "https://turbo.build/schema.json",
	"tasks": {
		"lint": {},
		"check-types": {},
		"test": {
			"dependsOn": ["@roo-code/types#build"]
		},
		"build": {
			"outputs": ["dist/**"],
			"inputs": ["src/**", "package.json", "tsconfig.json"]
		}
	}
}
```

### 2. التبعيات بين المهام

- **test** يعتمد على **build** من @roo-code/types
- **jetbrains:bundle** يعتمد على **bundle** من الملحق
- **cli:build** يعتمد على **build** من CLI

### 3. التخزين المؤقت

```json
{
	"tasks": {
		"lint": {
			"cache": true
		},
		"clean": {
			"cache": false
		}
	}
}
```

## 🔧 بناء المكونات

### 1. امتداد VS Code

```bash
# بناء امتداد VS Code
pnpm vsix

# البناء للإصدار
pnpm vsix:production

# البناء للنسخة الليلية
pnpm vsix:nightly
```

### 2. واجهة الويب

```bash
# بناء واجهة الويب
pnpm --filter webview-ui build

# تشغيل وضع التطوير
pnpm --filter webview-ui dev

# بناء Storybook
pnpm --filter webview-ui storybook:build
```

### 3. CLI

```bash
# بناء CLI
pnpm cli:build

# تجميع CLI
pnpm cli:bundle

# تشغيل CLI
pnpm cli:run
```

### 4. ملحق JetBrains

```bash
# بناء ملحق JetBrains
pnpm jetbrains:build

# تجميع الملحق
pnpm jetbrains:bundle

# تشغيل بيئة التطوير
pnpm jetbrains:run
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

### 3. اختبارات الأداء

```bash
# تشغيل تقييمات الأداء
pnpm evals

# تقييمات محلية
dotenvx run -f packages/evals/.env.local pnpm evals
```

## 📊 إدارة الإصدارات

### 1. Changesets

```bash
# إنشاء changeset جديد
pnpm changeset

# تحديث الإصدارات
pnpm changeset:version

# النشر
pnpm changeset publish
```

### 2. إدارة الإصدارات

```json
// package.json
{
	"version": "4.143.2",
	"scripts": {
		"changeset:version": "cp CHANGELOG.md src/CHANGELOG.md && changeset version"
	}
}
```

### 3. التسجيل التلقائي

```bash
# تحديث سجل التغييرات
cp CHANGELOG.md src/CHANGELOG.md

# نسخ التغييرات مرة أخرى
cp -vf src/CHANGELOG.md .
```

## 🔗 الربط بين الحزم

### 1. ربط الحزم المحلية

```bash
# ربط جميع الحزم
pnpm link-workspace-packages

# فك الربط
pnpm unlink-workspace-packages
```

### 2. الربط اليدوي

```bash
# ربط حزمة معينة
pnpm link @roo-code/types

# فك الربط
pnpm unlink @roo-code/types
```

### 3. التحقق من الروابط

```bash
# عرض الروابط الحالية
pnpm list --depth=0

# التحقق من الاعتماديات
pnpm why @roo-code/types
```

## 🎚️ التحكم في الجودة

### 1. ESLint

```bash
# فحص الكود
pnpm lint

# فحص حزمة معينة
pnpm --filter src lint

# الإصلاح التلقائي
pnpm lint --fix
```

### 2. TypeScript

```bash
# فحص الأنواع
pnpm check-types

# فحص حزمة معينة
pnpm --filter src check-types

# البناء مع التحقق
pnpm build --check-types
```

### 3. التنسيق

```bash
# تنسيق الكود
pnpm format

# تنسيق حزمة معينة
pnpm --filter src format

# التحقق من التنسيق
pnpm format --check
```

## 🚀 سير العمل التطويري

### 1. بدء التطوير

```bash
# 1. تثبيت الاعتماديات
pnpm install

# 2. بناء المشروع
pnpm build

# 3. تشغيل الاختبارات
pnpm test

# 4. بدء التطوير
pnpm dev
```

### 2. دورة التطوير

```bash
# 1. إجراء التغييرات
# 2. فحص الكود
pnpm lint

# 3. فحص الأنواع
pnpm check-types

# 4. تشغيل الاختبارات
pnpm test

# 5. البناء
pnpm build
```

### 3. قبل ال commit

```bash
# 1. فحص الكود (تلقائي عبر Husky)
pnpm lint

# 2. فحص الأنواع (تلقائي عبر Husky)
pnpm check-types

# 3. تشغيل الاختبارات (تلقائي عبر Husky)
pnpm test

# 4. التنسيق (تلقائي عبر Husky)
pnpm format
```

## 📈 الأداء والتحسين

### 1. التخزين المؤقت

```bash
# عرض التخزين المؤقت
pnpm turbo status

# مسح التخزين المؤقت
pnpm turbo clean

# بناء بدون تخزين مؤقت
pnpm build --force
```

### 2. البناء المتوازي

```bash
# البناء المتوازي
pnpm build --parallel

# تحديد عدد العمليات
pnpm build --parallel=4

# البناء التدريجي
pnpm build --concurrent=2
```

### 3. التحسينات

```bash
# تحليل الحجم
pnpm bundle --analyze

# تحسين البناء
pnpm build --optimize

# البناء للإنتاج
pnpm build --production
```

## 🔧 تكامل CI/CD

### 1. GitHub Actions

```yaml
# .github/workflows/build.yml
name: Build
on: [push, pull_request]
jobs:
    build:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v2
            - run: pnpm install
            - run: pnpm lint
            - run: pnpm test
            - run: pnpm build
```

### 2. النشر التلقائي

```bash
# النشر عند النشر
pnpm changeset publish

# النشر اليدوي
pnpm vsix:production
```

### 3. المراقبة

```bash
# مراقبة الأداء
pnpm evals

# مراقبة الاختبارات
pnpm playwright --reporter=html
```

## 🛠️ الأدوات المساعدة

### 1. Knip

```bash
# فحص الملفات غير المستخدمة
pnpm knip

# فحص الاعتماديات
pnpm knip --include dependencies
```

### 2. Docker

```bash
# تشغيل مع Docker
docker compose -f packages/evals/docker-compose.yml up

# البناء مع Docker
docker build -t kilocode .
```

### 3. السكربتات المخصصة

```bash
# تثبيت VSIX
node scripts/install-vsix.js

# ربط الحزم
tsx scripts/link-packages.ts
```

---

**ملخص:** نظام البناء مصمم ليكون فعالاً وسريعاً مع دعم كامل للتطوير الموازي والجودة التلقائية.
