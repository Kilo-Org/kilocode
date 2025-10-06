# Ghost Benchmarks

Comprehensive benchmarking system for Ghost autocomplete functionality, combining file-based test cases with live LLM integration and advanced scoring metrics.

## Features

- 🏗️ **Multi-file test cases** with standardized cursor markers
- 🤖 **Dual execution modes**: Hardcoded responses for fast regression testing, Live LLM for comprehensive evaluation
- 📊 **Advanced scoring**: Pattern matching, semantic similarity, compilation validation
- 🎯 **Ghost integration**: Full compatibility with existing Ghost test framework
- 📋 **CLI interface**: Easy-to-use command-line tools for running benchmarks
- 📈 **Comprehensive reporting**: Console, JSON, and HTML output formats

## Architecture

### Core Components

- **BenchmarkRunner**: Main orchestrator that executes test cases using real Ghost system
- **TestCaseLoader**: Multi-file test case loading with format detection
- **LLMClient**: Live API integration with Kilo Code services
- **ScoreCalculator**: Comprehensive scoring and evaluation
- **CLI Interface**: User-friendly command-line tools

### Supported Strategies

1. **Mercury Coder** (`mercury`) - Specialized Mercury model with diff-based prompting
2. **Hole Filler** (`hole-filler`) - Chat models with hole-filler prompting and XML parsing
3. **Fill-in-Middle** (`fim`) - Code models with native FIM token support
4. **Legacy XML** (`legacy-xml`) - Traditional XML-based prompting for general models

### Current Profile Configuration

| Profile       | Model                         | Strategy    | Description                                        |
| ------------- | ----------------------------- | ----------- | -------------------------------------------------- |
| `mercury`     | `inception/mercury-coder`     | Mercury     | Specialized Mercury Coder with optimized prompting |
| `hole-filler` | `openai/gpt-4o-mini`          | Hole Filler | Chat model with hole-filler prompting              |
| `fim`         | `mistralai/codestral-2508`    | FIM         | Mistral Codestral with native FIM support          |
| `legacy-xml`  | `anthropic/claude-3.5-sonnet` | Legacy XML  | Claude 3.5 Sonnet with XML prompting               |

## Installation & Setup

### Prerequisites

- Node.js v20.18.1 (exact version via .nvmrc)
- pnpm v10.8.1 (enforced via preinstall script)
- Valid OpenRouter API key (for model access)

### Build Process

```bash
# Install dependencies
pnpm install

# Build the package
cd packages/ghost-benchmarks
pnpm build
```

The build process uses esbuild to create a standalone CLI bundle with all dependencies included.

## Usage

### CLI Interface

#### List Available Test Cases

```bash
# List all test cases
npm run benchmark:list

# List with statistics
ghost-benchmark list --stats
```

#### Run Single Test Case

```bash
npm run benchmark -- --profile <profile-name> --tests <test-name>
```

#### Run Multiple Test Cases

```bash
npm run benchmark -- --profile <profile-name> --tests <test1>,<test2>,<test3>
```

#### Run All Test Cases for a Profile

```bash
npm run benchmark -- --profile <profile-name>
```

#### Dual Execution Modes

```bash
# Run all test cases in hardcoded mode (fast, for CI)
ghost-benchmark run --mode hardcoded

# Run specific test cases with live LLM
ghost-benchmark run --mode live --profile mercury-coder --tests mercury-duplication-bug
```

#### Validation and Statistics

```bash
# Validate test case structure
ghost-benchmark validate

# Show statistics
ghost-benchmark stats
```

### CLI Examples

#### Test FIM Strategy with Single Test

```bash
npm run benchmark -- --profile fim --tests function-body-completion
```

#### Test Multiple Strategies

```bash
npm run benchmark -- --profile mercury --tests async-await-completion,class-method-completion
npm run benchmark -- --profile hole-filler --tests loop-completion,variable-assignment
```

#### Full Profile Evaluation

```bash
npm run benchmark -- --profile fim
npm run benchmark -- --profile mercury
npm run benchmark -- --profile legacy-xml
npm run benchmark -- --profile hole-filler
```

### Programmatic API

```typescript
import { BenchmarkRunner, TestCaseLoader } from "@kilocode/ghost-benchmarks"

// Create runner and load test cases
const runner = new BenchmarkRunner()
const loader = new TestCaseLoader()

// Run specific test case
const testCase = await loader.loadTestCase("mercury-duplication-bug")
const result = await runner.runTestCase(testCase, {
	mode: "hardcoded",
	profile: "mercury-coder",
})

// Run all tests
const summary = await runner.runAllTests({
	mode: "live",
	profile: "mercury-coder",
	categories: ["mercury-bug"],
})
```

## Test Cases

### Available Test Categories

1. **async-completion**: `async-await-completion`
2. **class-completion**: `class-method-completion`
3. **conditional-completion**: `conditional-completion`
4. **function-completion**: `function-body-completion`
5. **import-completion**: `import-statement-completion`
6. **loop-completion**: `loop-completion`
7. **method-completion**: `object-method-completion`
8. **variable-completion**: `variable-assignment`

### Test Case Structure

Each test case follows this directory structure:

```
test-case-name/
├── src/
│   ├── main.js          # Input file with ␣ cursor marker
│   ├── utils.js         # Additional context files
│   └── types.ts         # Supporting files
├── responses/
│   ├── mercury-coder.txt    # Hardcoded Mercury response
│   ├── gpt4-turbo.txt       # Hardcoded GPT-4 response
│   └── claude-sonnet.txt    # Hardcoded Claude response
├── expected/
│   ├── main.js          # Expected final result
│   └── utils.js         # Expected changes to other files
├── metadata.json        # Test configuration
└── README.md           # Test documentation
```

### Metadata Schema

```json
{
	"name": "test-case-name",
	"description": "Test case description",
	"category": "mercury-bug",
	"expectedPatterns": ["regex-pattern"],
	"expectedGroupCount": 1,
	"expectedSelectedGroup": 0,
	"shouldCompile": true,
	"minimumSimilarityScore": 0.8
}
```

### Test Case Contents

Each test case includes:

- **Input file content** with cursor position
- **Expected completion behavior**
- **Context information** (surrounding code, imports, etc.)
- **Success criteria** for validation

## Cursor Position System

- **Standard marker**: `␣` (U+2423 OPEN BOX)
- **Rule**: Exactly one file must contain the cursor marker
- **Active file**: File with cursor marker becomes the active editor context
- **Legacy support**: Automatic handling of `<|cursor|>` and `<| cursor |>` formats

## Results & Analysis

### Output Locations

- **Completion Files**: `completions/benchmark-<timestamp>/<profile>/`
- **Results JSON**: `results/benchmark-<timestamp>.json`
- **Console Output**: Real-time progress and summary statistics

### Performance Metrics

- **Pass Rate**: Percentage of successful completions
- **Average Response Time**: Mean completion time across all tests
- **Total Execution Time**: Complete benchmark run duration
- **Category Breakdown**: Success rates by completion type

### Example Results

```
📊 Benchmark Results
══════════════════════════════════════════════════

📈 Summary:
  ✅ Passed: 8
  ❌ Failed: 0
  📊 Pass Rate: 100.0%
  ⏱️  Total Time: 6786ms
  ⚡ Avg Time: 848ms

📁 Category Breakdown:
  ✅ async-completion: 1/1 (100%)
  ✅ class-completion: 1/1 (100%)
  ✅ conditional-completion: 1/1 (100%)
  ✅ function-completion: 1/1 (100%)
  ✅ import-completion: 1/1 (100%)
  ✅ loop-completion: 1/1 (100%)
  ✅ method-completion: 1/1 (100%)
  ✅ variable-completion: 1/1 (100%)
```

## Scoring System

The benchmark system uses multiple evaluation metrics:

### Accuracy Metrics

- **Exact Match**: Generated output exactly matches expected result
- **Semantic Similarity**: AST-based comparison for structural similarity
- **Pattern Matches**: Regex-based validation (Mark's approach)

### Quality Metrics

- **Compilation Status**: Generated code compiles/parses successfully
- **Test Preservation**: Existing tests continue to pass
- **Linting**: No new linting errors introduced

### Performance Metrics

- **Response Time**: API call duration
- **Token Usage**: For cost tracking and optimization
- **Cache Hit Rate**: Ghost suggestion cache effectiveness

## Performance Benchmarks

### Current Performance (as of 2025-01-30)

| Strategy    | Model                       | Pass Rate | Avg Time | Notes                          |
| ----------- | --------------------------- | --------- | -------- | ------------------------------ |
| Mercury     | inception/mercury-coder     | 100%      | 757ms    | Excellent targeted completions |
| FIM         | mistralai/codestral-2508    | 100%      | 848ms    | Native FIM support, very fast  |
| Hole-Filler | openai/gpt-4o-mini          | 90%       | 1837ms   | Good general completions       |
| Legacy-XML  | anthropic/claude-3.5-sonnet | 100%      | 4561ms   | Precise but slower             |

### Optimization Tips

1. **FIM Strategy**: Best for code models with native FIM support
2. **Mercury Strategy**: Optimal for Mercury Coder model specifically
3. **Hole-Filler**: Good fallback for general chat models
4. **Legacy-XML**: Use with instruction-following models like Claude

## Environment Variables

```bash
# Required for live LLM mode
KILOCODE_API_KEY=your-api-key-here

# Optional configuration
LLM_PROVIDER=kilocode
LLM_MODEL=mistralai/codestral-latest
```

## Development

### Adding New Test Cases

1. Create test case JSON in `src/test-cases/`
2. Follow existing structure with `inputFiles`, `activeFile`, `cursorPosition`
3. Add validation criteria and expected behavior
4. Test with multiple profiles to ensure compatibility

### Adding New Profiles

1. Update `BenchmarkRunner.ensureBenchmarkProfilesLoaded()`
2. Configure model ID and strategy type
3. Test with representative test cases
4. Document performance characteristics

### Debugging

#### Enable Verbose Output

```bash
npm run benchmark -- --profile fim --tests function-body-completion --verbose
```

#### Check Build Issues

```bash
npm run build
# Review warnings and errors in output
```

#### Validate Test Cases

```bash
npm run benchmark:list
# Ensure all expected test cases are loaded
```

#### Debug Mode

Enable detailed logging by setting environment variables:

```bash
GHOST_QUIET_MODE=false npm run benchmark -- --profile fim --tests function-body-completion
```

## Troubleshooting

### Common Issues

#### Model ID Not Found

```
Error: OpenRouter completion error: 400 <model-id> is not a valid model ID
```

**Solution**: Verify model ID exists on OpenRouter and update profile configuration

#### Build Failures

```
▲ [WARNING] Import "X" will always be undefined
```

**Solution**: Check VSCode mock implementations in `src/mocks/vscode.ts`

#### Test Case Not Found

```
🚀 Starting benchmark run: 0 test cases
```

**Solution**: Verify test case name matches exactly (case-sensitive)

## Contributing

### Code Quality Standards

- Follow Clean Code principles
- Use intention-revealing names
- Keep functions small and focused
- Add comprehensive error handling
- Include unit tests for new features

### Testing New Features

1. Test with all existing profiles
2. Validate across different test case categories
3. Measure performance impact
4. Update documentation

## Integration

This package integrates seamlessly with:

- **Ghost System**: Reuses existing MockWorkspace and strategy infrastructure
- **Mercury Coder**: Full support for Mercury-specific prompting and responses
- **CI/CD**: Fast hardcoded mode for automated testing
- **Development Workflow**: Live mode for validating Ghost improvements

## Migration from Legacy

The system supports both new multi-file format and legacy single-file test cases:

- **Automatic Detection**: Framework detects format and loads appropriately
- **Backward Compatibility**: All existing test cases continue to work
- **Migration Tools**: Automated scripts for converting to new format

## API Reference

### BenchmarkRunner Methods

- `runTestCase(testCase, options)`: Execute single test case
- `runTestCases(testCases, options)`: Execute multiple test cases
- `ensureBenchmarkProfilesLoaded()`: Initialize Ghost profiles

### Profile Configuration

```typescript
interface GhostProfileConfig {
	id: string
	name: string
	description: string
	apiProfileId: string
	promptStrategyType: string
	isDefault: boolean
	customSettings: {
		openRouterModelId: string
	}
}
```

### Test Case Format

```typescript
interface BenchmarkTestCase {
	metadata: {
		name: string
		category: string
		description: string
	}
	inputFiles: Record<string, string>
	activeFile: string
	cursorPosition: { line: number; character: number }
	expectedBehavior: string
}
```

## Future Enhancements

- **HTML Reporting Interface**: Rich web-based results visualization
- **Multi-model Comparison**: Side-by-side evaluation of different LLM providers
- **Performance Regression Detection**: Historical trend analysis
- **Advanced Context Mocking**: Full Ghost context simulation including recent edits and imports

## License

This package is part of the Kilo Code project and follows the same licensing terms.

---

Built with ❤️ for the Kilo Code Ghost autocomplete system.
