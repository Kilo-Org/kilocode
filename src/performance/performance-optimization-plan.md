# 🚀 خطة تحسين أداء طلبات الريكوست في Kilo Code

## 📊 نظرة عامة على المشكلة

بناءً على تحليل الكود، تم تحديد الأسباب الرئيسية للبطء في إعداد وإرسال الطلبات:

1. **عمليات قاعدة البيانات البطيئة** - استعلامات recursive ونقص الفهارس
2. **تحميل النماذج المتكرر** - استدعاء API في كل طلب
3. **حساب التوكنز المتكرر** - استدعاء API بدون تخزين مؤقت
4. **المعالجة التسلسلية** - عمليات يمكن أن تكون متوازية

---

## 🎯 الأولويات العالية (High Priority)

### 1. تحسين استعلامات قاعدة البيانات وإضافة الفهارس

**الملف:** `src/services/storage/database-manager.ts`  
**الأولوية:** ⭐⭐⭐⭐⭐  
**التأثير:** تحسين 40-50% في سرعة الاستعلامات

#### المشاكل الحالية:

- استعلامات `getSymbolContext` و `findImpactedFiles` تستخدم CTE بدون limits
- نقص الفهارس المركبة للاستعلامات الشائعة
- عمليات cascade delete بطيئة

#### الحلول المقترحة:

```sql
-- إضافة فهارس مركبة جديدة
CREATE INDEX idx_symbols_file_type ON symbols(file_id, type);
CREATE INDEX idx_relationships_from_type ON relationships(from_symbol_id, type);
CREATE INDEX idx_code_chunks_file_symbol ON code_chunks(file_id, symbol_id);
```

#### التعديلات المطلوبة:

- [ ] إضافة LIMIT للاستعلامات العودية
- [ ] إضافة فهارس مركبة في `createIndexes()`
- [ ] تحسين استعلامات `getSymbolContext`

---

### 2. تخزين النماذج مؤقتاً في OpenRouter Handler

**الملف:** `src/api/providers/openrouter.ts` (سطر 114-138)  
**الأولوية:** ⭐⭐⭐⭐⭐  
**التأثير:** تحسين 30-40% في وقت الاستجابة الأولي

#### المشكلة الحالية:

```typescript
// يتم التحميل في كل مرة في الـ constructor
private async loadDynamicModels(): Promise<void> {
    const [models, endpoints] = await Promise.all([
        getModels({ provider: "openrouter" }),
        getModelEndpoints({...}),
    ])
}
```

#### الحل المقترح:

```typescript
// إضافة cache مع TTL
class ModelCache {
	private cache = new Map<string, { data: any; timestamp: number }>()
	private readonly TTL = 5 * 60 * 1000 // 5 دقائق

	async get(key: string, fetcher: () => Promise<any>): Promise<any> {
		const cached = this.cache.get(key)
		if (cached && Date.now() - cached.timestamp < this.TTL) {
			return cached.data
		}

		const data = await fetcher()
		this.cache.set(key, { data, timestamp: Date.now() })
		return data
	}
}
```

#### التعديلات المطلوبة:

- [ ] إنشاء `ModelCache` class
- [ ] تعديل `loadDynamicModels()` لاستخدام الـ cache
- [ ] إضافة cache invalidation عند تغيير الإعدادات

---

### 3. تخزين عد التوكنز مؤقتاً

**الملف:** `src/api/providers/anthropic.ts` (سطر 478-497)  
**الأولوية:** ⭐⭐⭐⭐  
**التأثير:** تحسين 20-30% في الطلبات المتكررة

#### المشكلة الحالية:

```typescript
override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
    try {
        const response = await this.client.messages.countTokens({
            model: apiModelId,
            messages: [{ role: "user", content: content }],
        })
        return response.input_tokens
    } catch (error) {
        return super.countTokens(content) // Fallback to tiktoken
    }
}
```

#### الحل المقترح:

```typescript
// LRU cache لتخزين نتائج عد التوكنز
class TokenCache {
	private cache = new Map<string, number>()
	private readonly maxSize = 1000

	private getContentHash(content: Array<Anthropic.Messages.ContentBlockParam>): string {
		return JSON.stringify(content).slice(0, 100) // Simple hash
	}

	get(content: Array<Anthropic.Messages.ContentBlockParam>): number | null {
		const hash = this.getContentHash(content)
		return this.cache.get(hash) || null
	}

	set(content: Array<Anthropic.Messages.ContentBlockParam>, count: number): void {
		const hash = this.getContentHash(content)
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			this.cache.delete(firstKey)
		}
		this.cache.set(hash, count)
	}
}
```

#### التعديلات المطلوبة:

- [ ] إنشاء `TokenCache` class
- [ ] تعديل `countTokens()` لاستخدام الـ cache
- [ ] إضافة cache size management

---

## 🔧 الأولويات المتوسطة (Medium Priority)

### 4. تحسين الاستعلامات العودية

**الملف:** `src/services/storage/database-manager.ts`  
**الأولوية:** ⭐⭐⭐  
**التأثير:** تحسين 15-20% في استعلامات السياق

#### التعديلات المطلوبة:

- [ ] إضافة depth limits لـ CTE queries
- [ ] تحسين `getSymbolContext` بـ early termination
- [ ] إضافة pagination لـ `findImpactedFiles`

---

### 5. المعالجة المتوازية للعمليات المستقلة

**الملفات:** متعددة في `src/api/providers/`  
**الأولوية:** ⭐⭐⭐  
**التأثير:** تحسين 10-15% في سرعة المعالجة

#### أمثلة للتحسين:

```typescript
// بدلاً من العمليات التسلسلية
const model = await this.fetchModel()
const tokens = await this.countTokens(content)

// استخدم المعالجة المتوازية
const [model, tokens] = await Promise.all([this.fetchModel(), this.countTokens(content)])
```

#### التعديلات المطلوبة:

- [ ] مراجعة `createMessage` في جميع الـ providers
- [ ] تطبيق `Promise.all` للعمليات المستقلة
- [ ] إضافة error handling للعمليات المتوازية

---

## 🚀 الأولويات المنخفضة (Low Priority)

### 6. إضافة Connection Pooling

**الأولوية:** ⭐⭐  
**التأثير:** تحسين 5-10% في العمليات المتزامنة

#### التعديلات المطلوبة:

- [ ] تثبيت `sqlite3-pool` package
- [ ] تعديل `DatabaseManager` لاستخدام connection pool
- [ ] إضافة pool configuration

---

### 7. المعالجة في الخلفية

**الأولوية:** ⭐⭐  
**التأثير:** تحسين تجربة المستخدم

#### التعديلات المطلوبة:

- [ ] إنشاء `BackgroundWorker` class
- [ ] نقل عمليات `cleanupOrphanedRecords` للخلفية
- [ ] إضافة progress indicators

---

### 8. مراقبة الأداء

**الأولوية:** ⭐  
**التأثير:** قياس وتحسين مستمر

#### التعديلات المطلوبة:

- [ ] إضافة performance metrics
- [ ] إنشاء dashboard للأداء
- [ ] إضافة alerting للبطء

---

## 📈 خريطة التنفيذ الزمنية

### الأسبوع 1-2: الأولويات العالية

- [ ] تحسين قاعدة البيانات (Task 1)
- [ ] تخزين النماذج مؤقتاً (Task 2)
- [ ] تخزين التوكنز مؤقتاً (Task 3)

### الأسبوع 3-4: الأولويات المتوسطة

- [ ] تحسين الاستعلامات العودية (Task 4)
- [ ] المعالجة المتوازية (Task 5)

### الأسبوع 5-6: الأولويات المنخفضة

- [ ] Connection Pooling (Task 6)
- [ ] المعالجة في الخلفية (Task 7)
- [ ] مراقبة الأداء (Task 8)

---

## 🎯 التأثير المتوقع

### قبل التحسين:

- وقت الاستجابة الأولي: 2-3 ثوانٍ
- وقت الطلب المتكرر: 1-2 ثانية
- استخدام الذاكرة: مرتفع

### بعد التحسين:

- وقت الاستجابة الأولي: 0.5-1 ثانية (**تحسين 60-70%**)
- وقت الطلب المتكرر: 0.2-0.5 ثانية (**تحسين 75-80%**)
- استخدام الذاكرة: منخفض بفضل الـ caching

---

## 🔍 كيفية قياس النجاح

### Metrics الرئيسية:

1. **Response Time** - وقت الاستجابة للطلبات
2. **Cache Hit Rate** - نسبة استخدام الـ cache
3. **Database Query Time** - وقت تنفيذ استعلامات قاعدة البيانات
4. **Memory Usage** - استخدام الذاكرة
5. **CPU Usage** - استخدام المعالج

### أدوات القياس:

- Chrome DevTools Performance
- Node.js Performance Hooks
- Custom Performance Monitoring

---

## 📝 ملاحظات التنفيذ

1. **الاختبار:** يجب اختبار كل تحسين بشكل منفصل
2. **المراقبة:** مراقبة الأداء بعد كل تغيير
3. **التراجع:** الاحتفاظ بـ backup قبل كل تغيير كبير
4. **التوثيق:** توثيق جميع التغييرات والأسباب

---

**المستخدم النهائي هيشوف:** تحسن ملحوظ في سرعة البرنامج، استجابة أسرع للأوامر، وتجربة استخدام أكثر سلاسة.
