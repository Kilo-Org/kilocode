# Configuration Management

The configuration management system provides centralized handling of extension settings, secrets, and state
through the `ContextProxy` class. This system abstracts VS Code's extension context and provides a unified
interface for managing both global and workspace-specific configuration.

## Location

`src/core/config/`

## Core Components

### ContextProxy.ts

The main configuration management class that wraps VS Code's ExtensionContext and provides enhanced functionality.

**Key Features:**

- Unified interface for global state, secrets, and workspace state
- In-memory caching for performance optimization
- Type-safe configuration access
- Automatic initialization and synchronization
- Import/export functionality for settings

### Architecture

#### Singleton Pattern

```typescript
export class ContextProxy {
	private static _instance: ContextProxy | null = null

	static async getInstance(context: vscode.ExtensionContext) {
		if (this._instance) {
			return this._instance
		}

		this._instance = new ContextProxy(context)
		await this._instance.initialize()
		return this._instance
	}
}
```

#### State Management

The system manages three types of state:

1. **Global State**: Persistent across all workspaces
2. **Secret State**: Encrypted storage for sensitive data
3. **Workspace State**: Specific to current workspace

### Configuration Types

#### GlobalSettings

Settings that apply across all workspaces:

```typescript
interface GlobalSettings {
	customModes?: CustomMode[]
	maxReadFileLine?: number
	enableDiff?: boolean
	// ... other global settings
}
```

#### ProviderSettings

API provider and model configuration:

```typescript
interface ProviderSettings {
	apiProvider?: string
	apiModelId?: string
	apiKey?: string
	openAiHeaders?: Record<string, string>
	// ... other provider settings
}
```

#### SecretState

Encrypted storage for sensitive information:

```typescript
interface SecretState {
	apiKey?: string
	openAiApiKey?: string
	anthropicApiKey?: string
	// ... other secrets
}
```

## Key Methods

### State Access

```typescript
// Global state
getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K]
updateGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K])

// Secrets
getSecret(key: SecretStateKey): string | undefined
storeSecret(key: SecretStateKey, value?: string): Promise<void>

// Workspace state
getWorkspaceState(context: vscode.ExtensionContext, key: string): Promise<any>
updateWorkspaceState(context: vscode.ExtensionContext, key: string, value: any): Promise<void>
```

### Configuration Access Methods

```typescript
// Get typed configuration objects
getGlobalSettings(): GlobalSettings
getProviderSettings(): ProviderSettings

// Set configuration with validation
setProviderSettings(values: ProviderSettings): Promise<void>
setValues(values: RooCodeSettings): Promise<void>
```

### Import/Export

```typescript
// Export settings for backup/sharing
export(): Promise<GlobalSettings | undefined>

// Reset all configuration
resetAllState(): Promise<void>
```

## Caching Strategy

### In-Memory Cache

The system maintains in-memory caches for performance:

```typescript
private stateCache: GlobalState
private secretCache: SecretState
```

### Cache Synchronization

- **Initialization**: Loads all state into cache on startup
- **Updates**: Synchronous cache updates with asynchronous persistence
- **Refresh**: Manual refresh capability for secrets

### Pass-Through Keys

Certain keys bypass caching for real-time updates:

```typescript
const PASS_THROUGH_STATE_KEYS = ["taskHistory"]
```

## Configuration Schema Validation

### Zod Integration

Uses Zod schemas for runtime validation:

```typescript
try {
	return globalSettingsSchema.parse(values)
} catch (error) {
	if (error instanceof ZodError) {
		TelemetryService.instance.captureSchemaValidationError({
			schemaName: "GlobalSettings",
			error,
		})
	}
	// Fallback to unvalidated values
}
```

### Error Handling

- Graceful degradation when validation fails
- Telemetry capture for schema validation errors
- Fallback to default values when possible

## Special Handling

### OpenAI Headers

Special handling for OpenAI headers to ensure proper serialization:

```typescript
if (values.openAiHeaders !== undefined) {
	if (!values.openAiHeaders || Object.keys(values.openAiHeaders).length === 0) {
		values.openAiHeaders = {}
	}
}
```

### Custom Modes

Filtering of custom modes during export:

```typescript
globalSettings.customModes = globalSettings.customModes?.filter((mode) => mode.source === "global")
```

## Integration Points

### Extension Activation

```typescript
// In extension.ts
const contextProxy = await ContextProxy.getInstance(context)
```

### Provider Integration

```typescript
// In ClineProvider
const settings = this.contextProxy.getProviderSettings()
const apiHandler = buildApiHandler(settings)
```

### Webview Communication

Configuration changes are automatically synchronized with the webview through the provider's state management.

## Error Handling and Recovery

### Initialization Errors

```typescript
for (const key of GLOBAL_STATE_KEYS) {
	try {
		this.stateCache[key] = this.originalContext.globalState.get(key)
	} catch (error) {
		logger.error(`Error loading global ${key}: ${error.message}`)
	}
}
```

### Secret Access Errors

Graceful handling of secret storage failures with logging and fallback behavior.

## Testing Considerations

### Mock Context

For testing, the system can be initialized with a mock VS Code context:

```typescript
const mockContext = {
	globalState: new MockMemento(),
	secrets: new MockSecretStorage(),
	// ... other mock properties
}
```

### State Isolation

Each test should reset the singleton instance to ensure isolation.

## Performance Optimizations

- **Lazy Loading**: Configuration loaded only when needed
- **Batch Updates**: Multiple configuration changes batched together
- **Cache Invalidation**: Selective cache updates rather than full reloads
- **Async Persistence**: Non-blocking writes to storage

## Security Considerations

- **Secret Encryption**: All sensitive data stored in VS Code's encrypted secret storage
- **Access Control**: Type-safe access to configuration values
- **Validation**: Schema validation prevents invalid configuration states
- **Export Filtering**: Secrets excluded from export functionality
