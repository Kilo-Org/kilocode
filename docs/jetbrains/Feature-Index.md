# JetBrains Module Features

**Quick Navigation for AI Agents**

---

## Overview

JetBrains IDE plugin for Kilocode. Supports IntelliJ, PyCharm, WebStorm, and other JetBrains IDEs. Uses a hybrid architecture with Kotlin plugin and Node.js host.

**Source Location**: `jetbrains/`

---

## Architecture

```
jetbrains/
├── plugin/              → Kotlin plugin code
│   └── src/             → Plugin implementation
└── host/                → Node.js host process
    └── src/             → Host implementation
```

---

## Components

| Component | Language | Purpose |
|-----------|----------|---------|
| Plugin | Kotlin | JetBrains IDE integration |
| Host | TypeScript/Node.js | Kilocode core functionality |

---

## How It Works

1. **Kotlin Plugin**: Integrates with JetBrains IDE
2. **Node.js Host**: Runs Kilocode core logic
3. **IPC**: Plugin communicates with host via IPC

---

## Key Differences from VS Code

| Aspect | VS Code | JetBrains |
|--------|---------|-----------|
| Language | TypeScript | Kotlin + TypeScript |
| UI Framework | React webview | Kotlin Swing |
| Integration | VS Code API | IntelliJ Platform SDK |

---

[← Back to Index](../Index.md)
