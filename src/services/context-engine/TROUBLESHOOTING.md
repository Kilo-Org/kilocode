# Context Engine Troubleshooting Guide

## Performance Issues

### "task queue exceeded allotted deadline" Warning

This warning indicates that Context Engine operations are taking too long and blocking VS Code's main thread.

#### Quick Fixes:

1. **Use Performance Configuration**:

```typescript
import { getOptimalConfig, PERFORMANCE_CONFIG } from "./context-engine"

// Use optimized settings
const engine = new ContextEngine(getOptimalConfig())
```

2. **Reduce File Size Limits**:

```json
{
	"kiloCode.contextEngine.maxFileSize": 262144,
	"kiloCode.contextEngine.debounceDelay": 2000
}
```

3. **Add More Exclusions**:

```json
{
	"kiloCode.contextEngine.excludedPaths": [
		"node_modules/**",
		".git/**",
		"dist/**",
		"build/**",
		".turbo/**",
		"*.min.js",
		"*.bundle.js"
	]
}
```

#### Advanced Solutions:

1. **Enable Performance Monitoring**:

```typescript
import { getPerformanceMonitor } from "./context-engine"

const monitor = getPerformanceMonitor()
console.log("Performance metrics:", monitor.getMetrics())
console.log("Recommendations:", monitor.getRecommendations())
```

2. **Use Background Processing**:

```typescript
const config = {
	...PERFORMANCE_CONFIG,
	enableBackgroundProcessing: true,
	maxConcurrentParsers: 1,
}
```

3. **Disable Heavy Features**:

```typescript
const parseOptions = {
	includeDocstrings: false,
	includePrivate: false,
	maxFileSize: 128 * 1024, // 128KB
}
```

## Memory Issues

### High Memory Usage

1. **Reduce Memory Threshold**:

```typescript
const config = {
	maxMemoryUsage: 0.4, // 40% instead of 70%
	enableGarbageCollection: true,
}
```

2. **Clear Caches Regularly**:

```typescript
// Clear caches every hour
setInterval(() => {
	engine.clearCaches()
}, 3600000)
```

## Parsing Errors

### Parser Failures

1. **Check File Exclusions**:

    - Add problematic file patterns to `excludedPaths`
    - Reduce `maxFileSize` for large files

2. **Enable Error Resilience**:

    - Parsers automatically handle errors and return partial results
    - Check error logs for specific issues

3. **Disable Problematic Languages**:

```typescript
// Skip certain file types if causing issues
const excludedExtensions = [".min.js", ".bundle.js", ".d.ts"]
```

## Configuration Examples

### Development Mode (Aggressive Performance):

```typescript
import { DEV_CONFIG } from "./context-engine"

const engine = new ContextEngine({
	...DEV_CONFIG,
	maxFileSize: 128 * 1024, // 128KB
	debounceDelay: 3000, // 3 seconds
	maxMemoryUsage: 0.3, // 30%
	enableBackgroundProcessing: false,
})
```

### Production Mode (Balanced):

```typescript
import { PERFORMANCE_CONFIG } from "./context-engine"

const engine = new ContextEngine({
	...PERFORMANCE_CONFIG,
	maxFileSize: 512 * 1024, // 512KB
	debounceDelay: 1000, // 1 second
	maxMemoryUsage: 0.5, // 50%
})
```

### Minimal Mode (Emergency):

```typescript
const minimalConfig = {
	maxFileSize: 64 * 1024, // 64KB only
	debounceDelay: 5000, // 5 seconds
	maxMemoryUsage: 0.2, // 20%
	excludedPaths: ["**/*"], // Exclude everything except specific patterns
	includePatterns: ["src/**/*.ts", "src/**/*.js"], // Only include essential files
}
```

## Monitoring Commands

### Check Performance:

```typescript
const monitor = getPerformanceMonitor()
console.log("Average parse time:", monitor.getMetrics().averageParseTime, "ms")
console.log("Memory usage:", (monitor.getMetrics().memoryUsage * 100).toFixed(1), "%")
```

### Get Recommendations:

```typescript
const recommendations = monitor.getRecommendations()
recommendations.forEach((rec) => console.log("💡", rec))
```

### Auto-adjust Settings:

```typescript
const optimalSettings = monitor.getOptimalSettings()
engine.updateConfig(optimalSettings)
```

## Emergency Disable

If Context Engine is causing severe performance issues:

```typescript
// Completely disable Context Engine
const engine = getContextEngine()
engine.dispose()
resetContextEngine()
```

Or in VS Code settings:

```json
{
	"kiloCode.contextEngine.enabled": false
}
```
