# مرجع واجهات برمجة التطبيقات (API Reference)

> **نظرة عامة:** وثائق واجهات برمجة التطبيقات الرئيسية
> **الجمهور:** المطورون والمساهمون
> **التحديث:** الإصدار 4.143.2

## 🏗️ نظرة عامة على API

Kilo Code يوفر واجهات برمجة تطبيقات متعددة للتفاعل مع مختلف مكونات النظام.

### 1. امتداد VS Code API

```typescript
// src/extension.ts
export interface ExtensionAPI {
	// إرسال طلبات API
	apiRequest: (request: ApiRequest) => Promise<ApiResponse>

	// إدارة الحالة
	getState: () => Promise<ExtensionState>

	// تنفيذ الأوامر
	executeCommand: (command: string, ...args: any[]) => Promise<any>
}
```

### 2. WebView API

```typescript
// webview-ui/src/types.ts
export interface WebViewAPI {
	// إرسال رسائل إلى الامتداد
	postMessage: (message: ExtensionMessage) => void

	// استقبال رسائل من الامتداد
	onMessage: (handler: (message: ExtensionMessage) => void) => void

	// إدارة الحالة
	getState: () => Promise<WebViewState>
}
```

### 3. CLI API

```typescript
// cli/src/types.ts
export interface CLI_API {
	// تشغيل الأوامر
	runCommand: (command: string, options?: CLIOptions) => Promise<CLIResult>

	// إدارة الجلسات
	createSession: (config: SessionConfig) => Promise<Session>

	// معالجة الملفات
	processFile: (filePath: string, options?: ProcessOptions) => Promise<ProcessResult>
}
```

## 🔧 واجهات برمجة التطبيقات الأساسية

### 1. API Provider Interface

```typescript
// src/api/providers/types.ts
export interface APIProvider {
	name: string
	description: string

	// إرسال طلب
	sendRequest: (request: ApiRequest) => Promise<ApiResponse>

	// التحقق من الصحة
	validateConfig: (config: ProviderConfig) => boolean

	// الحصول على المعلومات
	getInfo: () => ProviderInfo
}
```

**المproviders المتاحة:**

```typescript
// OpenAI Provider
export class OpenAIProvider implements APIProvider {
	name = "openai"
	description = "OpenAI API provider"

	async sendRequest(request: ApiRequest): Promise<ApiResponse> {
		// تنفيذ طلب OpenAI
	}
}

// Anthropic Provider
export class AnthropicProvider implements APIProvider {
	name = "anthropic"
	description = "Anthropic Claude API provider"

	async sendRequest(request: ApiRequest): Promise<ApiResponse> {
		// تنفيذ طلب Anthropic
	}
}

// Kilo Code Provider
export class KiloCodeProvider implements APIProvider {
	name = "kilocode"
	description = "Kilo Code API provider"

	async sendRequest(request: ApiRequest): Promise<ApiResponse> {
		// تنفيذ طلب Kilo Code
	}
}
```

### 2. Tool Interface

```typescript
// src/core/tools/types.ts
export interface Tool {
	name: string
	description: string
	parameters: ToolParameters

	// تنفيذ الأداة
	execute: (params: ToolParameters) => Promise<ToolResult>

	// التحقق من الصحة
	validate: (params: ToolParameters) => boolean
}

export interface ToolParameters {
	[key: string]: any
}

export interface ToolResult {
	success: boolean
	data?: any
	error?: string
}
```

**الأدوات المتاحة:**

```typescript
// ReadFile Tool
export class ReadFileTool implements Tool {
	name = "read_file"
	description = "Read the contents of a file"
	parameters = {
		file_path: "string",
		start_line: "number?",
		end_line: "number?",
	}

	async execute(params: ToolParameters): Promise<ToolResult> {
		// قراءة الملف
	}
}

// WriteFile Tool
export class WriteFileTool implements Tool {
	name = "write_file"
	description = "Write content to a file"
	parameters = {
		file_path: "string",
		content: "string",
	}

	async execute(params: ToolParameters): Promise<ToolResult> {
		// كتابة الملف
	}
}

// ExecuteCommand Tool
export class ExecuteCommandTool implements Tool {
	name = "execute_command"
	description = "Execute a terminal command"
	parameters = {
		command: "string",
		cwd: "string?",
	}

	async execute(params: ToolParameters): Promise<ToolResult> {
		// تنفيذ الأمر
	}
}
```

### 3. Service Interface

```typescript
// src/services/types.ts
export interface Service {
	name: string
	version: string

	// بدء الخدمة
	start: () => Promise<void>

	// إيقاف الخدمة
	stop: () => Promise<void>

	// الحصول على الحالة
	getStatus: () => ServiceStatus
}

export interface ServiceStatus {
	running: boolean
	uptime: number
	memory: number
	errors: string[]
}
```

**الخدمات المتاحة:**

```typescript
// MCP Service
export class McpService implements Service {
	name = "mcp"
	version = "1.0.0"

	async start(): Promise<void> {
		// بدء خدمة MCP
	}

	async stop(): Promise<void> {
		// إيقاف خدمة MCP
	}

	getStatus(): ServiceStatus {
		// الحصول على حالة الخدمة
	}
}

// Code Index Service
export class CodeIndexService implements Service {
	name = "code-index"
	version = "1.0.0"

	async start(): Promise<void> {
		// بدء خدمة فهرسة الكود
	}

	async stop(): Promise<void> {
		// إيقاف خدمة فهرسة الكود
	}

	getStatus(): ServiceStatus {
		// الحصول على حالة الخدمة
	}
}
```

## 🤖 ميزات الذكاء الاصطناعي المتقدمة

### 1. Chat API

```typescript
// src/services/chat/types.ts
export interface ChatService {
	// إنشاء جلسة دردشة
	createSession: (config: SessionConfig) => Promise<ChatSession>

	// إرسال رسالة
	sendMessage: (sessionId: string, message: ChatMessageInput) => Promise<ChatResponse>

	// الحصول على تاريخ الدردشة
	getHistory: (sessionId: string, limit?: number) => Promise<ChatMessage[]>

	// إضافة سياق
	addContext: (sessionId: string, context: ContextReference) => Promise<void>

	// حذف جلسة
	deleteSession: (sessionId: string) => Promise<void>
}

export interface ChatSession {
	id: string
	userId: string
	title: string
	createdAt: Date
	updatedAt: Date
	context: CompletionContext
	metadata: SessionMetadata
}

export interface ChatMessageInput {
	content: string
	includeCitations?: boolean
	files?: FileReference[]
}

export interface ChatResponse {
	message: string
	citations: Citation[]
	context: CompletionContext
	timestamp: Date
}

export interface Citation {
	id: string
	messageId: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
	metadata: CitationMetadata
}
```

### 2. Edit Guidance API

```typescript
// src/services/edit-guidance/types.ts
export interface EditGuidanceService {
	// إنشاء خطة تعديل
	createPlan: (config: PlanConfig) => Promise<EditPlan>

	// تنفيذ خطوة
	executeStep: (planId: string, stepId: string) Promise<StepResult>

	// تخطي خطوة
	skipStep: (planId: string, stepId: string) => Promise<void>

	// الحصول على الخطة
	getPlan: (planId: string) => Promise<EditPlan>

	// إلغاء الخطة
	cancelPlan: (planId: string) => Promise<void>

	// تحليل الكود المرتبط
	analyzeRelatedCode: (filePath: string) => Promise<RelatedCodeAnalysis>
}

export interface EditPlan {
	id: string
	userId: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	steps: EditStep[]
	createdAt: Date
	updatedAt: Date
	metadata: PlanMetadata
}

export interface EditStep {
	id: string
	planId: string
	order: number
	title: string
	type: "create" | "update" | "delete" | "move"
	files: FileReference[]
	description: string
	status: "pending" | "completed" | "skipped" | "failed"
	dependencies: string[]
	metadata: StepMetadata
}

export interface StepResult {
	success: boolean
	changes: FileChange[]
	errors?: string[]
	warnings?: string[]
}

export interface RelatedCodeAnalysis {
	relatedFiles: FileReference[]
	imports: ImportReference[]
	functionCalls: FunctionCallReference[]
	classReferences: ClassReference[]
}
```

### 3. Completions API

```typescript
// src/services/completions/types.ts
export interface CompletionsService {
	// الحصول على الإكمالات
	getCompletions: (context: CompletionRequest) => Promise<Completion[]>

	// الحصول على السياق
	getContext: (filePath: string, position: number) => Promise<CompletionContext>

	// ترجمة من اللغة الطبيعية إلى الكود
	translateNLToCode: (comment: string, context: CompletionContext) => Promise<string>

	// تحديث الفهرس
	updateIndex: (filePath: string) => Promise<void>

	// مسح ذاكرة التخزين المؤقت
	clearCache: () => Promise<void>
}

export interface CompletionRequest {
	filePath: string
	position: number
	surroundingCode: string
	context: {
		includeSemantic?: boolean
		maxFiles?: number
		includeDependencies?: boolean
		includeTests?: boolean
	}
}

export interface Completion {
	text: string
	confidence: number
	source: "semantic" | "pattern" | "nl-translation"
	metadata: CompletionMetadata
}

export interface CompletionContext {
	id: string
	filePath: string
	position: number
	surroundingCode: string
	projectContext: ProjectContext
	semanticContext: SemanticContext
	metadata: ContextMetadata
}

export interface ProjectContext {
	projectPath: string
	language: string
	framework?: string
	dependencies: string[]
	recentFiles: string[]
	gitBranch?: string
	metadata: ProjectMetadata
}

export interface SemanticContext {
	embeddings: number[][]
	relevantFiles: FileReference[]
	concepts: string[]
	relationships: ConceptRelationship[]
	metadata: SemanticMetadata
}
```

### 4. Slack Integration API

```typescript
// src/services/slack-integration/types.ts
export interface SlackIntegrationService {
	// تكامل التكامل
	setupIntegration: (config: SlackConfig) => Promise<SlackIntegration>

	// مشاركة رسالة
	shareMessage: (request: ShareRequest) => Promise<ShareResult>

	// مشاركة مقتطف كود
	shareCode: (request: CodeShareRequest) => Promise<ShareResult>

	// الحصول على التكاملات
	getIntegrations: (userId: string) => Promise<SlackIntegration[]>

	// حذف تكامل
	deleteIntegration: (integrationId: string) => Promise<void>

	// التحقق من الاتصال
	verifyConnection: (integrationId: string) => Promise<boolean>
}

export interface SlackIntegration {
	id: string
	userId: string
	workspaceId: string
	channelId?: string
	botToken: string // Encrypted
	userToken: string // Encrypted
	isActive: boolean
	createdAt: Date
	lastUsed?: Date
	metadata: SlackMetadata
}

export interface ShareRequest {
	content: string
	channelId: string
	format?: "plain" | "code-block" | "markdown"
	messageId?: string
	includeContext?: boolean
}

export interface CodeShareRequest {
	code: string
	filePath: string
	language: string
	channelId: string
	startLine?: number
	endLine?: number
	format?: "code-block" | "diff"
}

export interface ShareResult {
	success: boolean
	messageId: string
	timestamp: Date
	url?: string
	error?: string
}
```

## 📡 أنواع الرسائل

### 1. Extension Messages

```typescript
// @roo/ExtensionMessage
export interface ExtensionMessage {
	type: "apiRequest" | "state" | "settings" | "error"
	data?: any
	timestamp: number
	id: string
}

// API Request Message
export interface ApiRequestMessage extends ExtensionMessage {
	type: "apiRequest"
	data: {
		request: ApiRequest
		requestId: string
	}
}

// State Message
export interface StateMessage extends ExtensionMessage {
	type: "state"
	data: {
		state: ExtensionState
		partial: boolean
	}
}

// Error Message
export interface ErrorMessage extends ExtensionMessage {
	type: "error"
	data: {
		error: string
		code?: string
		details?: any
	}
}
```

### 2. WebView Messages

```typescript
// webview-ui/src/types.ts
export interface WebViewMessage {
	type: "userMessage" | "toolUse" | "apiResponse" | "stateUpdate"
	data: any
	timestamp: number
}

// User Message
export interface UserMessage extends WebViewMessage {
	type: "userMessage"
	data: {
		message: string
		files?: FileReference[]
		context?: string[]
	}
}

// Tool Use Message
export interface ToolUseMessage extends WebViewMessage {
	type: "toolUse"
	data: {
		tool: string
		parameters: any
		result?: any
	}
}
```

### 3. IPC Messages

```typescript
// @roo-code/ipc
export interface IPCMessage {
	channel: string
	data: any
	sender: string
	receiver: string
	timestamp: number
}

// Request Message
export interface IPCRequest extends IPCMessage {
	type: "request"
	requestId: string
	method: string
	params: any
}

// Response Message
export interface IPCResponse extends IPCMessage {
	type: "response"
	requestId: string
	result?: any
	error?: string
}
```

## 🔐 المصادقة والأمان

### 1. Authentication API

```typescript
// src/services/auth/types.ts
export interface AuthService {
	// تسجيل الدخول
	login: (credentials: LoginCredentials) => Promise<AuthResult>

	// تسجيل الخروج
	logout: () => Promise<void>

	// تحديث التوكن
	refreshToken: () => Promise<string>

	// التحقق من الصحة
	verifyToken: (token: string) => Promise<boolean>
}

export interface LoginCredentials {
	username: string
	password: string
	provider?: string
}

export interface AuthResult {
	success: boolean
	token?: string
	refreshToken?: string
	user?: UserInfo
	error?: string
}
```

### 2. Security API

```typescript
// src/services/security/types.ts
export interface SecurityService {
	// تشفير البيانات
	encrypt: (data: string, key: string) => Promise<string>

	// فك تشفير البيانات
	decrypt: (encryptedData: string, key: string) => Promise<string>

	// التحقق من الصلاحيات
	checkPermission: (action: string, resource: string) => Promise<boolean>

	// تسجيل الأحداث الأمنية
	logSecurityEvent: (event: SecurityEvent) => void
}
```

## 📊 التتبع والتحليلات

### 1. Telemetry API

```typescript
// @roo-code/telemetry
export interface TelemetryService {
	// تتبع حدث
	trackEvent: (eventName: string, properties?: TelemetryProperties) => void

	// تتبع استثناء
	trackException: (exception: Error, properties?: TelemetryProperties) => void

	// تتبع مقياس
	trackMetric: (name: string, value: number, properties?: TelemetryProperties) => void

	// تتبع صفحة
	trackPageView: (page: string, properties?: TelemetryProperties) => void
}

export interface TelemetryProperties {
	[key: string]: string | number | boolean
}
```

### 2. Events API

```typescript
// src/services/events/types.ts
export interface EventService {
	// إرسال حدث
	emit: (event: string, data?: any) => void

	// الاستماع لحدث
	on: (event: string, handler: (data?: any) => void) => void

	// إلغاء الاستماع
	off: (event: string, handler: (data?: any) => void) => void

	// إرسال حدث مرة واحدة
	once: (event: string, handler: (data?: any) => void) => void
}
```

## 🗄️ قاعدة البيانات والتخزين

### 1. Database API

```typescript
// src/services/database/types.ts
export interface DatabaseService {
	// تنفيذ استعلام
	query: (sql: string, params?: any[]) => Promise<DatabaseResult>

	// تنفيذ استعلام واحد
	get: (sql: string, params?: any[]) => Promise<any>

	// تنفيذ استعلام متعدد
	all: (sql: string, params?: any[]) => Promise<any[]>

	// تنفيذ تحديث
	run: (sql: string, params?: any[]) => Promise<DatabaseResult>
}

export interface DatabaseResult {
	success: boolean
	data?: any
	error?: string
	changes?: number
	lastID?: number
}
```

### 2. Storage API

```typescript
// src/services/storage/types.ts
export interface StorageService {
	// تخزين قيمة
	set: (key: string, value: any) => Promise<void>

	// استرجاع قيمة
	get: (key: string) => Promise<any>

	// حذف قيمة
	delete: (key: string) => Promise<void>

	// مسح كل شيء
	clear: () => Promise<void>

	// الحصول على كل المفاتيح
	keys: () => Promise<string[]>
}
```

## 🌐 الشبكة والاتصال

### 1. HTTP Client API

```typescript
// src/services/http/types.ts
export interface HttpClient {
	// طلب GET
	get: (url: string, options?: RequestOptions) => Promise<HttpResponse>

	// طلب POST
	post: (url: string, data?: any, options?: RequestOptions) => Promise<HttpResponse>

	// طلب PUT
	put: (url: string, data?: any, options?: RequestOptions) => Promise<HttpResponse>

	// طلب DELETE
	delete: (url: string, options?: RequestOptions) => Promise<HttpResponse>
}

export interface RequestOptions {
	headers?: Record<string, string>
	timeout?: number
	retries?: number
}

export interface HttpResponse {
	status: number
	data: any
	headers: Record<string, string>
	ok: boolean
}
```

### 2. WebSocket API

```typescript
// src/services/websocket/types.ts
export interface WebSocketService {
	// الاتصال
	connect: (url: string) => Promise<void>

	// قطع الاتصال
	disconnect: () => Promise<void>

	// إرسال رسالة
	send: (message: any) => void

	// الاستماع للرسائل
	onMessage: (handler: (message: any) => void) => void

	// الاستماع للأحداث
	onOpen: (handler: () => void) => void
	onClose: (handler: (code: number, reason: string) => void) => void
	onError: (handler: (error: Error) => void) => void
}
```

## 🎨 واجهة المستخدم API

### 1. UI Components API

```typescript
// webview-ui/src/components/types.ts
export interface UIComponent {
	// عرض المكون
	render: () => JSX.Element

	// الخصائص
	props: ComponentProps

	// الحالة
	state: ComponentState

	// الأحداث
	events: ComponentEvents
}

export interface ComponentProps {
	[key: string]: any
}

export interface ComponentState {
	[key: string]: any
}

export interface ComponentEvents {
	[key: string]: (...args: any[]) => void
}
```

### 2. Theme API

```typescript
// webview-ui/src/theme/types.ts
export interface ThemeService {
	// الحصول على السمة الحالية
	getCurrentTheme: () => Theme

	// تغيير السمة
	setTheme: (theme: Theme) => void

	// التبديل بين السمات
	toggleTheme: () => void

	// الاستماع لتغييرات السمة
	onThemeChange: (handler: (theme: Theme) => void) => void
}

export interface Theme {
	name: string
	colors: ThemeColors
	typography: ThemeTypography
	spacing: ThemeSpacing
}
```

## 📝 أمثلة الاستخدام

### 1. استخدام API Provider

```typescript
// إنشاء provider
const provider = new OpenAIProvider({
	apiKey: process.env.OPENAI_API_KEY,
	model: "gpt-4",
})

// إرسال طلب
const response = await provider.sendRequest({
	messages: [{ role: "user", content: "Hello, world!" }],
})
```

### 2. استخدام Tool

```typescript
// إنشاء أداة
const tool = new ReadFileTool()

// تنفيذ الأداة
const result = await tool.execute({
	file_path: "/path/to/file.txt",
	start_line: 1,
	end_line: 10,
})

if (result.success) {
	console.log(result.data)
} else {
	console.error(result.error)
}
```

### 3. استخدام Service

```typescript
// بدء خدمة
const service = new McpService()
await service.start()

// التحقق من الحالة
const status = service.getStatus()
console.log("Service status:", status)

// إيقاف الخدمة
await service.stop()
```

---

**ملاحظات:** هذه الوثائق قيد التطوير المستمر. للمزيد من المعلومات، راجع الكود المصدري أو تواصل مع فريق التطوير.
