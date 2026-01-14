# Feature Specifications: Features Missing in KiloCode

This directory contains feature specifications for 4 features that exist in AugmentCode but are missing or not fully implemented in KiloCode.

## Feature List

| ID  | Feature                        | Short Name           | Priority | Status |
| --- | ------------------------------ | -------------------- | -------- | ------ |
| 1   | Next Edit                      | `next-edit`          | High     | Draft  |
| 2   | GitHub Code Review Integration | `github-code-review` | High     | Draft  |
| 3   | Context Engine SDK             | `context-engine-sdk` | Medium   | Draft  |
| 4   | Review Guidelines              | `review-guidelines`  | Medium   | Draft  |

## Quick Summary

### 1. Next Edit

Implement sequential edit suggestions for refactoring, library upgrades, and schema changes across the codebase.

**Key Benefits:**

- 40% faster refactoring
- 95% accuracy on suggestions
- 30% user adoption target

### 2. GitHub Code Review Integration

Native GitHub integration for automated PR reviews with AI-powered analysis.

**Key Benefits:**

- 80% PR coverage
- 30% time savings on reviews
- 50% comment resolution rate

### 3. Context Engine SDK

Official SDK (TypeScript + Python) for integrating KiloCode's context engine into custom applications.

**Key Benefits:**

- 1000+ installations target
- 30-minute integration time
- 99% uptime

### 4. Review Guidelines

Comprehensive documentation for understanding and using AI code review effectively.

**Key Benefits:**

- 90% understanding rate
- 25% fewer repeated issues
- 4+ user satisfaction rating

## Recommended Implementation Order

1. **Next Edit** - High impact, medium complexity
2. **GitHub Code Review** - High demand, high complexity
3. **Context Engine SDK** - Ecosystem expansion, medium complexity
4. **Review Guidelines** - Supporting content, low complexity

## Files Structure

```
.specify/specs/
├── README.md                    # This file
├── features-to-add.md           # Combined overview
├── 1-next-edit/
│   └── spec.md
├── 2-github-code-review/
│   └── spec.md
├── 3-context-engine-sdk/
│   └── spec.md
└── 4-review-guidelines/
    └── spec.md
```

## Next Steps

1. Review and approve specifications
2. Run `/speckit.clarify` to resolve open questions
3. Run `/speckit.plan` for each feature to create technical plans
4. Prioritize based on user feedback and strategic value
5. Begin implementation

## Open Questions by Feature

### Next Edit

- Should undo work at file level or edit level?
- Should edits be auto-staged to git?

### GitHub Code Review

- Should review use AI-only or hybrid approach?
- Should comments be posted as bot or tagged to users?

### Context Engine SDK

- Should SDK be open source or proprietary?
- What is the pricing model for SDK usage?

### Review Guidelines

- Should guidelines be integrated or separate?
- Should content be interactive or static?

---

**Created:** 2026-01-13  
**Total Features:** 4  
**Status:** Ready for Planning
