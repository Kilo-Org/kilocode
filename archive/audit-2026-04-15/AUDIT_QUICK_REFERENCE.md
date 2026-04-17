# DevilCode Audit Quick Reference

**One-page summary of critical issues requiring immediate attention**

---

## Critical Issues (Fix Immediately)

| # | Issue | File | Effort |
|---|-------|------|--------|
| 1 | **Hardcoded PostHog API Key** | `devil-telemetry/src/client.ts:5` | 30 min |
| 2 | **CSP Disabled (Tauri)** | `desktop/tauri.conf.json:22` | 1 hour |
| 3 | **Sandbox Disabled (Electron)** | `desktop-electron/src/main/windows.ts:61` | 2 hours |
| 4 | **Remote Script Without Verification** | `desktop/src-tauri/src/cli.rs:406` | 2 hours |
| 5 | **OAuth Migration Creates Invalid Sessions** | `devil-gateway/src/auth/legacy-migration.ts:84` | 2 hours |
| 6 | **Overly Permissive HTTP** | `desktop/capabilities/default.json:46` | 30 min |
| 7 | **Empty JetBrains Plugin** | `packages/devil-jetbrains/` | Remove or implement |
| 8 | **Type Safety Lost** | `opencode/src/provider/sdk/copilot/...:374` | 2 hours |
| 9 | **Unhandled Promise Rejections** | `devil-vscode/src/KiloProvider.ts:633` | 3 hours |
| 10 | **Unsafe Type Casting** | `devil-vscode/webview-ui/.../AssistantMessage.tsx` | 1 hour |

---

## Issue Count by Package

| Package | Critical | High | Medium | Status |
|---------|----------|------|--------|--------|
| opencode | 4 | 22 | 48 | Needs fixes |
| devil-vscode | 3 | 10 | 15 | Needs fixes |
| devil-jetbrains | 5 | 0 | 10 | **Not ready** |
| devil-ui | 2 | 18 | 35 | Needs fixes |
| ui | 2 | 15 | 30 | Needs fixes |
| desktop | 5 | 12 | 20 | **Security priority** |
| desktop-electron | 5 | 10 | 15 | **Security priority** |
| devil-gateway | 4 | 5 | 8 | **Security priority** |
| devil-telemetry | 1 | 2 | 3 | **Security priority** |
| app | 0 | 5 | 25 | Generally good |
| plugin | 0 | 2 | 8 | Good |
| script | 0 | 1 | 5 | Good |
| sdk/js | 0 | 2 | 10 | Good |

---

## Top 10 Most Common Issue Types

| Issue Type | Count | Priority |
|------------|-------|----------|
| Empty catch blocks | 50+ | High |
| `any` type usage | 70+ | High |
| Hardcoded values | 25+ | Medium |
| Missing error boundaries | 15+ | Medium |
| Console logging in prod | 20+ | Low |
| Missing documentation | 30+ | Low |
| Circular dependencies | 8 | Medium |
| Duplicate code | 12 | Medium |
| Stub implementations | 15 | Medium |
| Dead code | 20+ | Low |

---

## Commands to Run

```bash
# Type check everything
bun run typecheck

# Find all TODOs
grep -r "TODO\|FIXME" packages/*/src --include="*.ts" | wc -l

# Count 'any' types
grep -r ": any" packages/*/src --include="*.ts" | wc -l

# Find empty catch blocks
grep -r "catch {" packages/*/src --include="*.ts" -A 1 | grep "^\s*}$" | wc -l

# Check security issues
grep -r "sandbox: false" packages/desktop*/**/*.ts
grep -r "csp.*null" packages/desktop/**/*.json
grep -r "http://\*" packages/desktop/**/*.json
```

---

## Recommended Fix Order

### Week 1: Security
1. PostHog API key → env var
2. Enable CSP
3. Enable sandbox
4. Add script verification
5. Fix OAuth migration

### Week 2: Stability
6. Fix type safety issues
7. Fix unhandled rejections
8. Fix race conditions

### Weeks 3-4: Error Handling
9. Add logging to catch blocks
10. Replace `any` types
11. Add error boundaries

### Weeks 5-6: Architecture
12. Fix circular deps
13. Remove stubs/dead code
14. Deduplicate SDK

---

## Success Metrics

- [ ] Zero critical security issues
- [ ] Type check passes with zero errors
- [ ] All tests passing
- [ ] No new console errors
- [ ] VSCode extension stable
- [ ] Desktop apps secure
- [ ] JetBrains plugin removed or complete

---

*For full details see CODE_AUDIT_REPORT.md and FIX_PASS_GUIDE.md*
