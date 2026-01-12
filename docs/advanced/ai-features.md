# ميزات الذكاء الاصطناعي المتقدمة

> **نظرة عامة:** وثائق الميزات الجديدة للذكاء الاصطناعي في Kilo Code
> **الإصدار:** 4.144.0
> **التاريخ:** 12 يناير 2026

## 📋 نظرة عامة

يقدم Kilo Code الآن ميزات متقدمة للذكاء الاصطناعي مستوحاة من Augment Code لتعزيز قدرات البرمجة الخاصة بك:

1. **الدردشة المحسنة مع اكتشاف المصادر** - استجابات AI مع استشهادات مصدر قابلة للنقر
2. **نظام إرشادات التعديل التالي** - إرشادات خطوة بخطوة للتغييرات متعددة الملفات
3. **الإكمالات الذكية المدركة للسياق** - إكمالات كود تفهم الكود بالكامل
4. **تكامل Slack** - شارك المحادثات ومقتطفات الكود مع فريقك

---

## 1. الدردشة المحسنة مع اكتشاف المصادر

### نظرة عامة

تتيح لك ميزة الدردشة المحسنة طرح أسئلة حول قاعدة الكود الخاصة بك والحصول على استجابات AI مع استشهادات مصدر دقيقة وقابلة للنقر.

### الميزات الرئيسية

- **استشهادات المصدر**: كل استجابة AI تتضمن مراجع للملفات والأسطر الفعلية
- **روابط قابلة للنقر**: انقر على أي استشهاد لفتح الملف في السطر المحدد
- **دقة عالية**: استشهادات دقيقة بنسبة 95% بناءً على الفهرسة الدلالية
- **سياق متعدد الملفات**: AI يفهم العلاقات بين الملفات المختلفة

### مثال على الاستخدام

```typescript
// سؤال في الدردشة
"How does authentication work in this project?"

// استجابة AI مع استشهادات
Authentication is handled by the `AuthService` class
[src/services/auth/AuthService.ts:45-67].

The service uses JWT tokens for session management
[src/services/auth/jwt.ts:12-34].

Login routes are defined in the auth controller
[src/controllers/auth.ts:89-112].

📚 Sources:
- src/services/auth/AuthService.ts (lines 45-67)
- src/services/auth/jwt.ts (lines 12-34)
- src/controllers/auth.ts (lines 89-112)
```

### API

```typescript
// إنشاء جلسة دردشة
const session = await kiloCode.chat.createSession({
	title: "Auth System Analysis",
	initialContext: {
		filePath: "/project/src/auth/index.ts",
		position: 0,
	},
})

// إرسال رسالة
const response = await kiloCode.chat.sendMessage(session.id, {
	content: "How does authentication work?",
	includeCitations: true,
})

// الاستجابة تتضمن
interface ChatResponse {
	message: string
	citations: Citation[]
	context: CompletionContext
}

interface Citation {
	id: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
}
```

### الإعدادات

```json
{
	"kilo-code.chat": {
		"enableCitations": true,
		"maxContextFiles": 100,
		"citationThreshold": 0.7,
		"autoSaveContext": true
	}
}
```

---

## 2. نظام إرشادات التعديل التالي

### نظرة عامة

يوفر نظام إرشادات التعديل التالي إرشادات خطوة بخطوة للتغييرات متعددة الملفات، مما يضمن عدم تفويت أي تغييرات ذات صلة أثناء إعادة الهيكلة.

### الميزات الرئيسية

- **تحليل AST**: يحدد الكود المرتبط عبر ملفات متعددة باستخدام تحليل بناء الجملة المجرد
- **خطوات قابلة للتنفيذ**: يولد خطوات تعديل منظمة مع تتبع التبعيات
- **معاينة التغييرات**: عرض معاينة لكل خطوة قبل التنفيذ
- **تنفيذ تدريجي**: تنفيذ خطوة بخطوة مع القدرة على تخطي أو التراجع

### مثال على الاستخدام

```typescript
// إنشاء خطة تعديل
const plan = await kiloCode.editGuidance.createPlan({
	title: "Rename getUserData to fetchUserProfile",
	description: "Rename function across all files",
	files: ["src/services/userService.ts"],
	type: "refactor",
})

// الخطة تتضمن
interface EditPlan {
	id: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	steps: EditStep[]
}

interface EditStep {
	id: string
	order: number
	title: string
	type: "create" | "update" | "delete" | "move"
	files: FileReference[]
	description: string
	status: "pending" | "completed" | "skipped" | "failed"
	dependencies: string[]
}

// تنفيذ خطوة
const result = await kiloCode.editGuidance.executeStep(plan.id, stepId)
```

### مثال على الخطة

```
📋 Edit Plan: Rename `getUserData` to `fetchUserProfile`

Step 1: Update function definition
📁 src/services/userService.ts:23
- Rename function `getUserData` to `fetchUserProfile`

Step 2: Update imports (3 files)
📁 src/components/UserProfile.ts:5
📁 src/pages/Dashboard.ts:8
📁 src/utils/userHelpers.ts:12

Step 3: Update function calls (7 locations)
📁 src/components/UserProfile.ts:45
📁 src/pages/Dashboard.ts:67
...

[Execute Plan] [Skip Step] [Cancel]
```

### الإعدادات

```json
{
	"kilo-code.editGuidance": {
		"enabled": true,
		"maxStepsPerPlan": 50,
		"previewChanges": true,
		"confirmBeforeExecute": true,
		"autoDetectRelatedFiles": true
	}
}
```

---

## 3. الإكمالات الذكية المدركة للسياق

### نظرة عامة

توفر الإكمالات الذكية المدركة للسياق اقتراحات كود تفهم قاعدة الكود بالكامل، وليس فقط الملف الحالي.

### الميزات الرئيسية

- **سياق المشروع الكامل**: يفهم العلاقات بين الملفات والتبعيات
- **البحث الدلالي**: يحدد الكود ذو الصلة باستخدام التضمينات المتجهة
- **الترجمة من اللغة الطبيعية إلى الكود**: يحول التعليقات إلى كود
- **أنماط التعلم**: يتعلم من أنماط الكود الموجودة في المشروع

### مثال على الاستخدام

```typescript
// كتابة تعليق باللغة الطبيعية
// TODO: Fetch user data from API and handle loading state

// الضغط على Tab يولد
const [user, setUser] = useState<User | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
	const fetchUser = async () => {
		try {
			setLoading(true)
			const response = await userApi.getCurrentUser()
			setUser(response.data)
		} catch (err) {
			setError(err.message)
		} finally {
			setLoading(false)
		}
	}

	fetchUser()
}, [])
```

### API

```typescript
// الحصول على الإكمالات
const completions = await kiloCode.completions.getCompletions({
	filePath: "/project/src/components/User.tsx",
	position: 150,
	context: {
		includeSemantic: true,
		maxFiles: 50,
		includeDependencies: true,
		includeTests: false,
	},
})

interface CompletionContext {
	id: string
	filePath: string
	position: number
	surroundingCode: string
	projectContext: ProjectContext
	semanticContext: SemanticContext
}

interface ProjectContext {
	projectPath: string
	language: string
	framework?: string
	dependencies: string[]
	recentFiles: string[]
	gitBranch?: string
}

interface SemanticContext {
	embeddings: number[][]
	relevantFiles: FileReference[]
	concepts: string[]
	relationships: ConceptRelationship[]
}
```

### الإعدادات

```json
{
	"kilo-code.completions": {
		"enabled": true,
		"contextWindowSize": 8000,
		"semanticThreshold": 0.8,
		"debounceMs": 300,
		"includeDependencies": true,
		"maxFiles": 50
	}
}
```

---

## 4. تكامل Slack

### نظرة عامة

يتيح لك تكامل Slack مشاركة المحادثات ومقتطفات الكود مع فريقك مباشرة من VSCode.

### الميزات الرئيسية

- **مشاركة المحادثات**: شارك محادثات AI مع فريقك
- **مشاركة مقتطفات الكود**: شارك الكود مع تنسيق جميل
- **مناقشات مترابطة**: الردود تنشئ مؤشرات ترابط Slack
- **الإشارات**: أشر إلى أعضاء الفريق في المحتوى المشترك
- **تخزين آمن**: الرموز المميزة مخزنة بشكل آمن باستخدام SecretStorage

### مثال على الاستخدام

```typescript
// مشاركة محادثة إلى Slack
const result = await kiloCode.slack.share({
	content: "Check out this analysis...",
	channelId: "#dev-team",
	format: "code-block",
	messageId: "chat-message-id",
})

interface SlackIntegration {
	id: string
	workspaceId: string
	channelId?: string
	isActive: boolean
	createdAt: Date
	lastUsed?: Date
}

interface SharedMessage {
	id: string
	integrationId: string
	messageId?: string
	content: string
	channelId: string
	timestamp: Date
	response?: SlackResponse
}
```

### مثال على الرسالة المشتركة

```
🤖 Kilo Code Analysis

Question: How does the auth system work?

Answer: The authentication system uses JWT tokens with the
AuthService class...

📊 Context: 15 files analyzed, 8 citations included
🔗 View in Kilo Code: [link]
```

### الإعدادات

```json
{
	"kilo-code.slack": {
		"enabled": true,
		"defaultChannel": "#dev-team",
		"includeCodeBlocks": true,
		"autoFormat": true,
		"enableMentions": true
	}
}
```

### إعداد Slack

1. قم بتثبيت تطبيق Kilo Code Slack: https://slack.com/apps/A0123456789
2. انقر على "Add to Slack"
3. في VSCode، قم بتشغيل الأمر: `Kilo Code: Configure Slack Integration`
4. اتبع تدفق OAuth للاتصال بمساحة العمل الخاصة بك

---

## اختصارات لوحة المفاتيح

| الميزة              | الاختصار               | الوصف                  |
| ------------------- | ---------------------- | ---------------------- |
| التركيز على الدردشة | `Cmd/Ctrl + Shift + A` | فتح دردشة Kilo Code    |
| مهمة جديدة          | `Cmd/Ctrl + Shift + N` | إنشاء مهمة دردشة جديدة |
| إضافة للسياق        | `Cmd/Ctrl + K, A`      | إضافة التحديد للسياق   |
| خطة التعديل         | `Cmd/Ctrl + Shift + E` | إنشاء خطة تعديل        |
| مشاركة إلى Slack    | `Cmd/Ctrl + Shift + S` | مشاركة المحتوى الحالي  |
| الاقتراح التالي     | `Tab`                  | قبول الإكمال           |
| الاقتراح السابق     | `Shift + Tab`          | التراجع عن الاقتراحات  |

---

## استكشاف الأخطاء وإصلاحها

### الاستشهادات لا تظهر

**المشكلة**: استجابات AI لا تتضمن استشهادات المصدر

**الحلول**:

1. تحقق من أن `kilo-code.chat.enableCitations` هو true
2. تأكد من فهرسة قاعدة الكود: `Kilo Code: Reindex Codebase`
3. تحقق من أذونات الملفات لدليل المشروع

### خطط التعديل لا يتم إنشاؤها

**المشكلة**: لا توجد اقتراحات تعديل عند إعادة الهيكلة

**الحلول**:

1. قم بتمكين `kilo-code.editGuidance.enabled`
2. تحقق من أن أنواع الملفات مدعومة
3. تأكد من عمل تحليل AST: `Kilo Code: Check AST Support`

### الإكمالات بطيئة

**المشكلة**: إكمالات الكود بطيئة

**الحلول**:

1. قلل `kilo-code.completions.maxFiles`
2. زد `kilo-code.completions.debounceMs`
3. قم بتعطيل البحث الدلالي إذا لم يكن مطلوبًا

### فشل تكامل Slack

**المشكلة**: لا يمكن الاتصال بمساحة عمل Slack

**الحلول**:

1. تحقق من أذونات تطبيق Slack
2. تحقق من اتصال الشبكة
3. إعادة المصادقة: `Kilo Code: Reconnect Slack`

---

## الأداء والتحسين

### قواعد البيانات الكبيرة

1. **الفهرسة التزايدية**: تمكين لتجنب إعادة الفهرسة الكاملة
2. **استثناءات الملفات**: استبعاد الدلائل الكبيرة:
    ```json
    {
    	"kilo-code.index.exclude": ["node_modules/**", "dist/**", "*.min.js"]
    }
    ```
3. **حدود السياق**: تقليل نافذة السياق لاستجابات أسرع

### استخدام الذاكرة

1. **إدارة ذاكرة التخزين المؤقت**: مسح ذاكرة التخزين المؤقت بشكل دوري
2. **المعالجة في الخلفية**: تمكين الفهرسة في الخلفية
3. **حدود الموارد**: تعيين حدود مناسبة

---

## الأمان والخصوصية

### خصوصية الكود

- يتم معالجة مقتطفات الكود محليًا حيثما أمكن
- آليات موافقة المستخدم لجمع البيانات
- إخفاء هوية البيانات للمشاركة الخارجية

### أمان بيانات الاعتماد

- يتم تخزين رموز Slack بشكل آمن باستخدام VSCode SecretStorage
- تخزين مشفر للبيانات الحساسة
- تدوير الرموز المميزة

---

## مثال متكامل

```typescript
// مثال على استخدام جميع الميزات معًا

// 1. إنشاء جلسة دردشة مع استشهادات
const session = await kiloCode.chat.createSession({
	title: "Refactor Auth System",
	initialContext: {
		filePath: "/project/src/auth/index.ts",
		position: 0,
	},
})

// 2. طرح سؤال
const response = await kiloCode.chat.sendMessage(session.id, {
	content: "How can I refactor the auth system to use OAuth?",
	includeCitations: true,
})

// 3. إنشاء خطة تعديل بناءً على الاستجابة
const plan = await kiloCode.editGuidance.createPlan({
	title: "Migrate to OAuth",
	description: response.message,
	files: response.citations.map((c) => c.sourcePath),
	type: "refactor",
})

// 4. تنفيذ الخطة خطوة بخطوة
for (const step of plan.steps) {
	const result = await kiloCode.editGuidance.executeStep(plan.id, step.id)
	if (!result.success) {
		console.error(`Step ${step.order} failed:`, result.error)
		break
	}
}

// 5. مشاركة النتائج مع الفريق
await kiloCode.slack.share({
	content: `Successfully refactored auth system in ${plan.steps.length} steps`,
	channelId: "#dev-team",
	messageId: response.messageId,
})
```

---

## الموارد الإضافية

- [دليل البدء السريع](../../specs/002-enhance-ai-features/quickstart.md)
- [مرجع API](../reference/api-reference.md)
- [نموذج البيانات](../../specs/002-enhance-ai-features/data-model.md)
- [الوثائق التقنية](../../specs/002-enhance-ai-features/research.md)

---

**آخر تحديث:** 12 يناير 2026  
**الإصدار:** 4.144.0  
**المرخصة:** MIT
