# Services - Skills Feature

**Quick Navigation for AI Agents**

---

## Overview

User-defined skills/functions system. Allows users to create custom reusable actions that can be invoked by the AI.

**Source Location**: `src/services/skills/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| SkillsManager | Class | `SkillsManager.ts` | 12KB |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Register skill | `registerSkill()` | `SkillsManager.ts` |
| Get skills | `getSkills()` | `SkillsManager.ts` |
| Execute skill | `executeSkill()` | `SkillsManager.ts` |
| Remove skill | `removeSkill()` | `SkillsManager.ts` |

---

## Skill Definition

Skills are defined in `.kilocode/skills/`:

```yaml
name: deploy-staging
description: Deploy to staging environment
steps:
  - run: npm run build
  - run: npm run deploy:staging
```

---

## How It Works

1. User creates skill definition file
2. SkillsManager discovers and loads skills
3. Skills appear as available actions
4. AI can invoke skills like built-in tools

---

## Related

- [MCP](../mcp/) - External tools (similar concept)
- [Tools](../../../core/features/tools/) - Built-in tools

---

[← Back to Services](../../Feature-Index.md)
