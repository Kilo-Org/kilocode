# Entroly Integration: Context Compression for Kilo Code

Reduce LLM API costs by 70–95% when using Kilo Code on large codebases.

## Overview

[Entroly](https://github.com/juyterman1000/entroly) is a local context compression engine that ranks repo files by query relevance, compresses noisy context, aligns cache prefixes for provider discounts, and verifies answers with a built-in hallucination guard.

It works as a transparent proxy between Kilo Code and any LLM provider — no extension changes needed.

## Setup

### 1. Install

```bash
pip install entroly
```

### 2. Start proxy

```bash
entroly proxy --port 9377
```

### 3. Configure Kilo Code

In Kilo Code settings, set your API base URL to:

```
http://localhost:9377/v1
```

All requests are now automatically compressed before reaching the LLM provider.

### 4. MCP Server (Alternative)

Entroly also runs as an MCP server:

```bash
entroly serve
```

Add it as an MCP server in Kilo Code's MCP marketplace settings.

## How It Works

- **BM25 + entropy + dependency graph** ranks every file by relevance
- **Knapsack optimization** selects optimal files under token budget
- **CCR handles** ensure exact recovery of compressed content
- **Cache alignment** stabilizes prefixes for provider discounts (Anthropic 90%, OpenAI 50%)
- **WITNESS** checks answers against supplied evidence ($0, ~3ms)

## Results

| Metric | Result |
|---|---|
| Token reduction (large repos) | 70–95% |
| Accuracy retained | 100% (NeedleInAHaystack, BFCL) |
| Hallucination detection | 0.844 AUROC (HaluEval-QA) |

Verify locally: `entroly verify-claims` (no API key required)

## Links

- **GitHub**: [github.com/juyterman1000/entroly](https://github.com/juyterman1000/entroly)
- **License**: Apache-2.0
- Local-first, no outbound analytics by default
