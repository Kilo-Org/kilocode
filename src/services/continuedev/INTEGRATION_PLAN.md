# Continue Dev Integration Plan for Kilocode

## Current State Analysis

### Continue Dev Project Structure

- **Location**: `src/services/continuedev/`
- **Package Manager**: npm (has package-lock.json)
- **Node Version**: 20.19.0 (specified in .nvmrc and package.json engines)
- **Build System**: Independent with own package.json
- **Test Framework**: Vitest
- **TypeScript**: Uses custom `tsgo` compiler (from @typescript/native-preview)
- **Linting**: ESLint 8 with flat config (eslint.config.js)

### Kilocode Project Structure

- **Package Manager**: pnpm 10.8.1 (workspace-based)
- **Node Version**: 20.19.2 (root requirement)
- **Build System**: Turbo monorepo
- **Linting**: ESLint 9 with flat config (.mjs format)

### Current Issues

1. **ESLint Conflicts**: Parent ESLint (v9) tries to lint continuedev, which has ESLint 8 with different config
2. **Node Version Mismatch**: Continue expects >=20.19.0, you're running 22.16.0
3. **29 ESLint Warnings** in continuedev code:
    - Generator functions without yield
    - Empty interfaces
    - Unnecessary try/catch
    - Undefined globals in .js files
    - Unused eslint-disable directives

---

## Integration Goals

### Primary Goals

1. ✅ **Unblock builds**: Prevent parent ESLint from blocking on continuedev warnings
2. ✅ **Preserve functionality**: Keep continuedev's existing tooling intact
3. ✅ **Enable testing**: Integrate continuedev tests into CI/CD pipeline
4. ✅ **Build integration**: Include continuedev in project builds when needed

### Secondary Goals

1. 📋 **Gradual cleanup**: Create path to fix ESLint warnings over time
2. 📋 **Type safety**: Integrate TypeScript checking across projects
3. 📋 **Documentation**: Clear docs for working with continuedev code

---

## Implementation Plan

### Phase 1: Immediate Fix (Unblock Builds)

#### Step 1.1: Exclude continuedev from Parent ESLint

**File**: `src/eslint.config.mjs`

Add to ignores array:

```javascript
{
  ignores: ["webview-ui", "out", "services/continuedev/**"],
}
```

**Why**: Prevents parent ESLint v9 from trying to lint continuedev's ESLint 8 codebase.

#### Step 1.2: Add .eslintignore in continuedev

**File**: `src/services/continuedev/.eslintignore`

Create file to ignore specific problem files:

```
# Test fixtures
**/__fixtures__/**
**/testWorkspaceDir/**

# Legacy JavaScript files with global issues
core/llm/llamaTokenizer.js
eslint.config.js
```

**Why**: Reduces noise from files that can't easily be fixed without major changes.

---

### Phase 2: Turbo Integration

#### Step 2.1: Add continuedev Tasks to turbo.json

**File**: `turbo.json`

Add new tasks:

```json
{
	"tasks": {
		"continuedev:lint": {
			"cache": true,
			"inputs": [
				"src/services/continuedev/**/*.ts",
				"src/services/continuedev/**/*.js",
				"src/services/continuedev/eslint.config.js",
				"src/services/continuedev/tsconfig.json"
			]
		},
		"continuedev:typecheck": {
			"cache": true,
			"inputs": ["src/services/continuedev/**/*.ts", "src/services/continuedev/tsconfig.json"]
		},
		"continuedev:test": {
			"cache": true,
			"dependsOn": ["continuedev:typecheck"],
			"inputs": ["src/services/continuedev/core/**/*.ts", "src/services/continuedev/core/**/*.vitest.ts"]
		},
		"continuedev:format": {
			"cache": false
		}
	}
}
```

**Why**: Enables running continuedev tasks through turbo's caching system.

#### Step 2.2: Create Wrapper Scripts in src/package.json

**File**: `src/package.json`

Add scripts section (if not exists) or append:

```json
{
	"scripts": {
		"continuedev:lint": "cd services/continuedev && npm run lint",
		"continuedev:typecheck": "cd services/continuedev && npm run typecheck",
		"continuedev:test": "cd services/continuedev && npm run test",
		"continuedev:format": "cd services/continuedev && npm run format"
	}
}
```

**Why**: Turbo needs package.json scripts to execute tasks.

#### Step 2.3: Add Root Shortcuts to package.json

**File**: Root `package.json`

Add to scripts:

```json
{
	"scripts": {
		"continuedev:lint": "pnpm --filter kilo-code continuedev:lint",
		"continuedev:test": "pnpm --filter kilo-code continuedev:test",
		"continuedev:typecheck": "pnpm --filter kilo-code continuedev:typecheck",
		"continuedev:install": "cd src/services/continuedev && npm install"
	}
}
```

**Why**: Convenient commands to work with continuedev from root.

---

### Phase 3: Dependency Management

#### Step 3.1: Install continuedev Dependencies

**Action**: Run in CI/CD and local setup

```bash
cd src/services/continuedev
npm install
```

**Integration Point**: Add to bootstrap script or CI pipeline.

#### Step 3.2: Update Bootstrap Script (Optional)

**File**: `scripts/bootstrap.mjs`

Add check for continuedev dependencies:

```javascript
// Check if continuedev node_modules exists
const continuedevNodeModules = path.join(process.cwd(), "src/services/continuedev/node_modules")

if (!fs.existsSync(continuedevNodeModules)) {
	console.log("Installing continuedev dependencies...")
	execSync("npm install", {
		cwd: path.join(process.cwd(), "src/services/continuedev"),
		stdio: "inherit",
	})
}
```

**Why**: Ensures continuedev dependencies are installed during project setup.

---

### Phase 4: TypeScript Configuration

#### Step 4.1: Review TypeScript Compatibility

**Analysis Needed**:

- Continue uses `@typescript/native-preview` (tsgo) for faster builds
- Main project uses standard TypeScript 5.4.5
- Both projects should remain independent for TypeScript compilation

**Decision**: Keep separate TypeScript configs, don't use project references.

**Why**: Different TypeScript compilers (tsgo vs tsc) make project references impractical.

#### Step 4.2: Ensure No Import Conflicts

**Action**: Verify that src code doesn't accidentally import from continuedev

```bash
# Search for any imports from continuedev in main src
cd src
grep -r "from.*continuedev" . --exclude-dir=services/continuedev
```

**Expected**: No results (continuedev should be isolated).

---

### Phase 5: Testing Integration

#### Step 5.1: Add to CI Pipeline

**File**: `.github/workflows/*.yml` (if exists)

Add continuedev tests:

```yaml
- name: Install continuedev dependencies
  run: cd src/services/continuedev && npm install

- name: Test continuedev
  run: pnpm continuedev:test

- name: Lint continuedev
  run: pnpm continuedev:lint
```

#### Step 5.2: Local Testing Commands

Document in README:

```bash
# Test continuedev only
pnpm continuedev:test

# Test everything including continuedev
pnpm test && pnpm continuedev:test

# Lint everything
pnpm lint && pnpm continuedev:lint
```

---

### Phase 6: Documentation

#### Step 6.1: Create INTEGRATION.md

**File**: `src/services/continuedev/INTEGRATION.md`

Document:

- How to work with continuedev code
- How to run tests
- How to lint
- Known issues and workarounds
- Future improvement plans

#### Step 6.2: Update Main README

**File**: Root `README.md`

Add section about continuedev:

````markdown
## Continue Dev Integration

The project includes Continue's autocomplete and NextEdit features in `src/services/continuedev/`. This is a separate npm package with its own dependencies.

### Working with Continue Dev

```bash
# Install dependencies
pnpm continuedev:install

# Run tests
pnpm continuedev:test

# Lint
pnpm continuedev:lint
```
````

See [src/services/continuedev/INTEGRATION.md](src/services/continuedev/INTEGRATION.md) for details.

````

---

## Future Improvements (Post-Integration)

### Priority 1: Fix ESLint Warnings
- [ ] Fix generator functions without yield (use async/await or remove generator)
- [ ] Fix empty interface (use type alias or add members)
- [ ] Add proper globals to eslint config for .js files
- [ ] Remove unnecessary try/catch wrappers

### Priority 2: Modernization
- [ ] Consider migrating from npm to pnpm (would simplify workspace)
- [ ] Upgrade to ESLint 9 (align with parent config)
- [ ] Consider using standard tsc instead of tsgo (simplify tooling)

### Priority 3: Better Integration
- [ ] Create shared TypeScript types package
- [ ] Set up automatic dependency updates (Renovate/Dependabot)
- [ ] Add continuedev to main package.json as workspace package

---

## Testing Strategy

### Test Phases

#### Phase 1: Smoke Tests
```bash
# Verify eslint doesn't block
cd src
pnpm lint  # Should pass without continuedev errors

# Verify continuedev can still lint itself
cd services/continuedev
npm run lint  # Should show 29 warnings but not fail

# Verify continuedev tests work
npm test  # Should pass (778 tests)
````

#### Phase 2: Integration Tests

```bash
# From root
pnpm continuedev:lint  # Should work via turbo
pnpm continuedev:test  # Should work via turbo

# Full build
pnpm lint              # Should exclude continuedev
pnpm test              # Should exclude continuedev
pnpm continuedev:test  # Run continuedev tests separately
```

#### Phase 3: CI/CD Tests

- Verify CI pipeline passes
- Check build times (continuedev tests add ~30s)
- Confirm caching works in turbo

---

## Rollback Plan

If integration causes issues:

1. **Remove turbo tasks**: Delete continuedev tasks from turbo.json
2. **Remove scripts**: Delete continuedev scripts from package.json files
3. **Keep eslint ignore**: Leave continuedev excluded from parent lint
4. **Manual workflow**: Continue working with continuedev independently

The integration is designed to be low-risk and easily reversible.

---

## Success Criteria

- [ ] `pnpm lint` passes without continuedev errors
- [ ] `pnpm continuedev:lint` runs continuedev's own lint
- [ ] `pnpm continuedev:test` runs continuedev's 778 tests
- [ ] CI/CD pipeline includes continuedev tests
- [ ] Documentation explains how to work with continuedev
- [ ] No breaking changes to existing kilocode functionality
- [ ] Turbo caching works for continuedev tasks

---

## Timeline Estimate

- **Phase 1** (Immediate Fix): 15 minutes
- **Phase 2** (Turbo Integration): 30 minutes
- **Phase 3** (Dependencies): 15 minutes
- **Phase 4** (TypeScript): 15 minutes (review only)
- **Phase 5** (Testing): 30 minutes
- **Phase 6** (Documentation): 30 minutes

**Total**: ~2.5 hours for complete integration

---

## Questions to Resolve

1. **Node Version**: Continue requires >=20.19.0, you have 22.16.0. Should we:

    - Change engines to allow 22.x?
    - Document that 22.x works despite warning?
    - Use nvm to switch to 20.19.x?

2. **Build Step**: Does continuedev need a build step, or is it used directly?

    - If build needed: Add `continuedev:build` task
    - If direct use: Current plan is sufficient

3. **VS Code Integration**: How will kilocode use continuedev features?
    - Import as library?
    - Separate process?
    - This affects integration approach

---

## Next Steps

1. Get user confirmation on approach
2. Start with Phase 1 (Immediate Fix)
3. Test and verify at each phase
4. Document as we go
5. Create follow-up tasks for future improvements
