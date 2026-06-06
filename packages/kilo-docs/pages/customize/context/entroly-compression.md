---
title: "Entroly Context Compression"
description: "Reduce LLM input tokens by 70–95% on large repos using a local context compression proxy"
---

# Entroly Context Compression

## Overview

When working on large codebases (500+ files), AI coding agents often send far more context than the model needs for any given task. [Entroly](https://github.com/juyterman1000/entroly) is a local context compression proxy that sits between Kilo Code and your LLM provider, selecting only the most relevant files and compressing noisy content before it reaches the model.

This complements Kilo Code's built-in [Context Condensing](/docs/customize/context/context-condensing) by operating at the **pre-request** stage — reducing what gets sent in the first place, rather than summarizing conversation history after the fact.

## How It Works

Entroly runs locally and applies four stages to every LLM request:

1. **Rank** — scores every repo file by relevance to the current query using BM25, entropy analysis, and dependency graph traversal
2. **Select** — uses knapsack optimization to pack the most valuable files under a configurable token budget
3. **Compress** — reduces noisy context (boilerplate, repetitive patterns) while keeping originals recoverable via CCR handles
4. **Cache-align** — stabilizes byte prefixes so provider cache discounts activate consistently

Additionally, a built-in **WITNESS** hallucination guard checks model responses against supplied evidence at ~3ms latency with no additional API cost.

## Setup

### 1. Install

```bash
pip install entroly
```

### 2. Start the proxy

```bash
entroly proxy --port 9377
```

### 3. Configure Kilo Code

In your Kilo Code API settings, set the base URL to point at the local proxy:

```
http://localhost:9377/v1
```

All LLM requests from Kilo Code will now pass through Entroly for compression before reaching your provider.

### Alternative: MCP Server

Entroly can also run as an MCP server:

```bash
entroly serve
```

Add it through Kilo Code's MCP server configuration.

### 4. Verify

```bash
entroly verify-claims
```

This runs a bounded local smoke test — package import, indexing, context optimization, exact recovery, native-engine availability. Writes `.entroly_verification.json`. No API key required.

## Benchmark Results

Results from [Entroly's published benchmarks](https://github.com/juyterman1000/entroly/blob/main/BENCHMARKS.md):

| Metric | Result | Source |
|---|---|---|
| Token reduction (repos with 500+ files) | 70–95% | [BENCHMARKS.md § Token Savings](https://github.com/juyterman1000/entroly/blob/main/BENCHMARKS.md) |
| Accuracy (NeedleInAHaystack) | No degradation observed | [BENCHMARKS.md § Accuracy](https://github.com/juyterman1000/entroly/blob/main/BENCHMARKS.md) |
| Accuracy (BFCL) | No degradation observed | [BENCHMARKS.md § Accuracy](https://github.com/juyterman1000/entroly/blob/main/BENCHMARKS.md) |
| WITNESS hallucination detection (HaluEval-QA) | 0.844 AUROC | [BENCHMARKS.md § WITNESS](https://github.com/juyterman1000/entroly/blob/main/BENCHMARKS.md) |

Small prompts and tiny repos may show little or no savings. Run `entroly verify-claims` on your own repo to measure actual impact.

## When to Use

- **Large monorepos** where agents re-read thousands of files per request
- **Cost-sensitive workflows** where reducing input tokens matters
- **Long coding sessions** where cumulative token spend adds up

Entroly is most effective when combined with Kilo Code's built-in [context condensing](/docs/customize/context/context-condensing) and [codebase indexing](/docs/customize/context/codebase-indexing).

## Related Features

- [Context Condensing](/docs/customize/context/context-condensing) — Summarize conversation history to free context window space
- [Codebase Indexing](/docs/customize/context/codebase-indexing) — Efficient code search and retrieval
- [Large Projects](/docs/customize/context/large-projects) — Managing context for large codebases

## Links

- **GitHub**: [github.com/juyterman1000/entroly](https://github.com/juyterman1000/entroly)
- **License**: Apache-2.0
