---
sidebar_position: 7
title: "Agentic Security Reviews"
---

# Agentic Security Reviews

## Overview

This spec proposes an **Agentic security reviewer based on cloud agents**, available as part of the **Teams or Enterprise plan**. The system is not just a dependency reviewer, it combines traditional security tooling (Dependabot, npm audit, etc.) with LLM-powered analysis to provide intelligent, context-aware security reviews of both code and dependencies.

**Problem Statement:**

- Current security tools like Dependabot generate alerts without context about whether vulnerabilities are actually exploitable in our codebase
- Manual security reviews don't scale and are inconsistent
- Dependency vulnerability alerts create noise without actionable intelligence
- We don't want just a dependency reviewer, we need comprehensive security code review

**Proposed Solution:**
A two-stage agent system that:

1. **Agent/tools for finding and reporting security issues** - Aggregates findings from existing security tools (Dependabot, npm audit, brakeman, etc.) and performs code-level vulnerability detection
2. **Agent for checking and validating issues** - Uses LLM-powered analysis to validate, prioritize, and contextualize security issues (optionally testing in sandbox)

This approach takes input from tools like Dependabot or `npm audit` but goes beyond dependency review to include:

- Security code review using sink-to-source taint analysis
- Dependency review that scores risk levels based on how dependencies are actually used
- Validation of whether reported issues are actually exploitable in context

**Key Value Proposition:**
For issues like we see today from Dependabot, we can automatically test the issue in a sandbox and verify that the issue is actually exploitable. As a first step, checking if the issue is even relevant for our codebase.

Transform noisy security alerts into actionable, prioritized findings by automatically determining:

- Whether a reported vulnerability is relevant to our codebase
- Whether the vulnerability is actually exploitable given our usage patterns
- What the actual risk level is in context

## Relationship to Existing Code Review Agent

We already have a **Code Review Agent** that performs PR-based code reviews with security as one of its focus areas. The Security Review Agent is **complementary**, not duplicative:

**What the Code Review Agent does well:**

- Spot obvious security anti-patterns in PR diffs (e.g., `innerHTML` usage, hardcoded secrets)
- General code quality feedback that includes basic security awareness
- Works on the PR diff context

**What the Security Review Agent adds (that the Code Review Agent cannot do):**

- **Dependency vulnerability contextualization** - When Dependabot says "lodash has a prototype pollution vulnerability", determine if our codebase actually uses the vulnerable function. This requires analyzing the entire codebase, not just a PR diff.
- **Integration with security tooling** - Aggregate and contextualize findings from Dependabot, npm audit, and other scanners
- **Historical tracking** - Maintain a database of security issues, their status, and remediation history for compliance
- **Sandbox validation** - Actually test if a vulnerability is exploitable, not just flag potential issues

**Why this matters:** Teams are drowning in Dependabot alerts. Most CVEs reported in dependencies are not actually exploitable because the vulnerable code path isn't used. The Security Review Agent's primary value is turning noisy alerts into actionable intelligence by answering: "Is this vulnerability actually a problem for us?"

The code-level taint analysis (SQL injection, XSS, etc.) has more overlap with the Code Review Agent and is lower priority. Phase 1 focuses on dependency contextualization where the value is clearest.

## Requirements

### Core Requirements

- **Cloud agents** - Runs as cloud agents, not locally in the extension
- **Teams/Enterprise plan feature** - Gated to paid tiers
- **Integration with existing tools** - Consume output from:
    - Dependabot alerts (via GitHub API)
    - `npm audit` / `yarn audit`
    - Language-specific scanners (brakeman for Ruby, etc.)
    - SBOM (Software Bill of Materials) data
- **PR-triggered analysis** - Run security analysis on pull requests
- **Manual full-repo scans** - Support on-demand scanning of entire repositories
- **Structured output** - Provide severity, CWE classification, reproduction steps, and suggested fixes
- **Historical tracking** - Maintain database records of:
    - Security issues found
    - Security issues fixed
    - Security issues ignored (with justification)

### Security Analysis Capabilities

- **Dependency vulnerability analysis** - Contextualize dependency alerts against actual usage
- **Code-level vulnerability detection** - Sink-to-source taint analysis for:
    - SQL Injection
    - Cross-Site Scripting (XSS)
    - Command Injection
    - Authentication/Authorization bypasses
- **Validation agent** - For each finding, determine:
    - Is the issue relevant to this codebase?
    - Is the issue exploitable? (argue for and against)
    - Has the issue been fixed?

### Non-requirements

- No Local/offline execution: this is a cloud service
- No Real-time IDE integration: focus on PR and scheduled scans
- No Support for all languages in MVP: start with TypeScript/JavaScript

## System Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Input Sources                               │
├─────────────────┬─────────────────┬─────────────────┬───────────────┤
│   Dependabot    │   npm audit     │  SBOM Scanner   │  PR Changes   │
└────────┬────────┴────────┬────────┴────────┬────────┴───────┬───────┘
         │                 │                 │                │
         ▼                 ▼                 ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Finding Aggregation Layer                        │
│              (Normalize and deduplicate findings)                   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
         ┌────────────────────┼─────────────────────┐
         ▼                    ▼                     ▼
┌─────────────────┐  ┌───────────────────┐  ┌─────────────────┐
│  Dependency     │  │  Code Analysis    │  │  Validation     │
│  Analysis Agent │  │  Agents           │  │  Agent          │
│                 │  │  (Taint Analysis) │  │                 │
└────────┬────────┘  └────────┬──────────┘  └────────┬────────┘
         │                    │                      │
         ▼                    ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    LLM Evaluation Layer                             │
│         "Is this exploitable in this specific codebase?"            │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Optional: Sandbox Validation                        │
│            (Test exploitability with generated PoC)                 │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Structured Output + PR Integration                     │
│     (Severity, CWE, reproduction steps, suggested fix)              │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Finding Aggregation Layer

Normalizes input from various security tools into a common format:

```typescript
type SecurityFinding = {
	source: "dependabot" | "npm-audit" | "sbom" | "code-analysis"
	type: "dependency" | "code"
	severity: "critical" | "high" | "medium" | "low"
	cwe?: string
	package?: string
	version?: string
	location?: {
		file: string
		line: number
	}
	description: string
	rawData: unknown
}
```

#### 2. Dependency Analysis Agent

For dependency vulnerabilities (from Dependabot, npm audit, etc.):

- Analyzes how the vulnerable package is actually used in the codebase
- Determines if the vulnerable code path is reachable
- Assesses whether the vulnerability conditions apply to our usage

#### 3. Code Analysis Agents (Sink-to-Source Taint Analysis)

Specialized agents for each vulnerability class. Each agent follows the same pattern but targets different sinks:

- **SQL Injection Agent** - Finds raw SQL concatenation, `.raw()`, `.execute()` with interpolation, ORM bypass patterns
- **Command Injection Agent** - Finds `exec()`, `spawn()` with interpolation, `shell: true` options
- **XSS Agent** - Finds `innerHTML`, `dangerouslySetInnerHTML`, `document.write()`, unescaped template rendering

**Step 1: Sink Discovery**

- Use AST parsing (ts-morph, tree-sitter) to find dangerous operations
- Pattern matching for known vulnerability sinks

**Step 2: Call Chain Extraction**

- Build call graph using ts-morph or LSP-based analysis
- Walk backwards from sinks to find entry points (sources)
- Extract minimal code paths ("slices") from source to sink

**Step 3: LLM Evaluation**

- Feed only the relevant slice to the LLM (50-200 lines typically)
- Ask specific questions about exploitability:

```
Here is a code path from HTTP request handler to SQL query:

[extracted call chain]

Can an attacker control the input at the source in a way that
would allow SQL injection at the sink? Consider:
- Input validation present?
- Sanitization applied?
- Parameterization used?

If exploitable, provide a proof-of-concept input.
```

#### 4. Validation Agent

Reviews findings and provides structured assessment:

- Relevance check: Is this finding applicable to our codebase?
- Exploitability analysis: Arguments for and against exploitability
- Fix verification: Has this been addressed?

#### 5. Sandbox Validation (Optional)

For high-confidence findings:

- Generate test cases based on LLM analysis
- Execute in isolated sandbox environment (using existing cloud-agent infrastructure)
- Confirm exploitability to reduce false positives

### Data Model

```typescript
type SecurityIssue = {
	id: string
	repositoryId: string
	status: "open" | "fixed" | "ignored" | "false-positive"
	finding: SecurityFinding
	analysis: {
		isRelevant: boolean
		relevanceReasoning: string
		isExploitable: boolean | "unknown"
		exploitabilityReasoning: string
		suggestedFix?: string
		proofOfConcept?: string
	}
	validation?: {
		sandboxTested: boolean
		exploitConfirmed: boolean
		testOutput?: string
	}
	metadata: {
		createdAt: Date
		updatedAt: Date
		prNumber?: number
		ignoredReason?: string
		fixedInCommit?: string
		dependabotAlertId?: number // Link to GitHub Dependabot alert
	}
}
```

### Trigger Modes

1. **PR Analysis** - Triggered on pull request creation/update

    - Analyze changed files for new vulnerabilities
    - Check if PR introduces new dependency vulnerabilities
    - Comment findings directly on PR

2. **Scheduled Full Scan** - Periodic repository-wide analysis

    - Complete dependency audit
    - Full codebase taint analysis
    - Update historical tracking

3. **Manual Trigger** - On-demand scanning

    - User-initiated full or partial scans
    - Re-analysis of specific findings

4. **Dependabot Alert Trigger** - When new Dependabot alerts appear

    - Automatically analyze new vulnerability alerts
    - Provide contextualized risk assessment

5. **Security Issue Trigger** - GitHub issues or email reports classified as security issues
    - Triggered when issues are labeled with P0-P3 severity
    - Automatically analyze reported security concerns
    - Validate whether the reported issue is exploitable
    - Provide contextualized assessment and suggested remediation

## Scope/Implementation

### Phase 1: Dependency Vulnerability Contextualization

Focus on the core value proposition: making dependency alerts actionable.

- Dependabot webhook integration (subscribe to `dependabot_alert` events)
- `npm audit` integration (alternative input source)
- Dependency Analysis Agent: analyze if vulnerable code paths are actually used
- LLM evaluation: "Is this vulnerability exploitable in this codebase?"
- Security findings dashboard in app (view issues, status, reasoning)
- PR comment integration for findings

### Phase 2: Automatic Fixes & Additional Input Sources

- Automatic fix generation and PR creation for validated issues
- Additional dependency scanners (e.g., Snyk, OSV, GitHub Advisory Database API)
- SQL Injection Agent with AST-based sink discovery
- Call graph extraction for TypeScript

### Phase 3: Expanded Code Analysis & Validation

- XSS and Command Injection agents
- Sandbox validation for high-confidence findings
- Authentication bypass detection
- SBOM generation and analysis
- Multi-language support (Ruby/brakeman, Python/bandit, Go)
- Historical tracking and trends

## Compliance Considerations

- All security findings must be stored securely with appropriate access controls
- Audit logging for all security scan activities
- Data retention policies for security findings
- Sandbox environments must be fully isolated

## Technical Risks

- **Call graph complexity** - Building accurate call graphs for JavaScript/TypeScript is difficult due to dynamic typing, callbacks, and async patterns. This is the hardest technical challenge in Phase 1.
- **False positive rate** - Even with LLM evaluation, security tools tend toward high false positive rates. We need strong feedback loops and the ability to mark false positives.
- **Sandbox security** - Running untrusted exploit code in sandboxes is risky. This is why sandbox validation is Phase 2+ and requires careful isolation.

## Features for the Future

- **Security score trending** - Track security posture over time
- **Custom rule definitions** - Allow teams to define custom vulnerability patterns
- **Integration with SIEM** - Export findings to security information systems
