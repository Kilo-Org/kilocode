---
title: "How to Write Good Specs — A Field Guide"
description: "Practical guidance for software specs, their purpose, common failure modes, and how to write them for humans and AI agents"
---

# How to Write Good Specs — A Field Guide

A good spec reduces expensive ambiguity before it turns into code, rework, or conflicting assumptions. Joel Spolsky's classic functional-spec guidance makes the same point bluntly: writing the spec forces the product to be designed in prose first. Amazon's PR/FAQ process applies a similar discipline earlier in the workflow by using concise writing to expose weak product ideas before teams spend heavily to build them.

A spec is useful when it helps people make decisions, align on expected behavior, and verify that the result matches the intent. It is not valuable because it is long, formal, or complete in every possible dimension.

## What a software spec is

A **software spec** defines the behavior, boundaries, and acceptance conditions of a proposed change clearly enough that engineers, reviewers, testers, and delegates can act from the same understanding.

A spec is not the same as every neighboring document:

| Artifact | Primary question |
|---|---|
| PRD | Why build this, for whom, and what outcome matters? |
| Software spec | What exactly must happen? |
| Design doc | How should the system be designed, and why this approach? |
| Implementation plan | In what order will we build, verify, and ship it? |

These artifacts can be separate or lightweight sections of one document. The distinction matters more than the packaging. If the team is still debating customer value, write the product case first. If the user-visible or contract-level behavior is ambiguous, write the spec. If the implementation has meaningful trade-offs, write the design doc. If delivery sequencing is the main risk, write the plan.

A spec should also be a **living reference** while decisions are still changing. A stale spec is worse than a short one because it teaches readers not to trust it.

## Three common spec types

### 1. Behavioral or feature specs

Use these when a product, workflow, or feature needs precise expected behavior. They describe actors, entry conditions, normal flow, alternate flow, edge cases, errors, and success criteria.

Examples:
- Password reset
- Billing retries
- Multi-step onboarding
- Import and export flows

The primary reader should be able to answer, "What happens in this situation?" without guessing.

### 2. Interface or contract specs

Use these when two systems, teams, or versions must agree on a stable boundary. They define APIs, events, file formats, validation rules, compatibility behavior, state transitions, and failure semantics.

Examples:
- Public API request and response shapes
- Webhook event contracts
- Migration compatibility rules
- Shared data formats

A contract spec is not a broad architecture essay. It is narrow, precise, and testable at the boundary where interoperability matters.

### 3. Agent or execution specs

Use these when work will be delegated to an AI agent or a constrained automated workflow. The spec must define the goal, inputs, files or systems in scope, allowed and prohibited actions, expected output, verification steps, and stop or escalation conditions.

Examples:
- Research tasks with a required output format
- Code changes limited to a subsystem
- Migration tasks that must run specific checks
- Review tasks with explicit severity criteria

Humans often infer hidden context. Agents should not have to. The clearer the operational contract, the less likely the agent is to improvise past the author's intent.

## What makes a spec good

Use these criteria to evaluate a draft:

1. **It states the problem and decision clearly.** Readers know what uncertainty the document resolves.
2. **It separates goals from implementation choices.** Required outcomes do not get mixed up with one optional technique.
3. **It defines scope and non-goals.** Readers know what is intentionally excluded, not merely omitted.
4. **It uses concrete scenarios.** Typical flows and important edge cases reveal real behavior better than abstract promises.
5. **It is testable.** Requirements can be checked through acceptance criteria, examples, invariants, or measurable outcomes.
6. **It names failure behavior.** Invalid input, retries, timeouts, partial success, and rollback behavior are explicit where relevant.
7. **It separates decisions from open questions.** A settled requirement and an unresolved issue do not look alike.
8. **It uses precision proportional to risk.** High-risk contracts need sharper language than low-risk internal preferences.
9. **It is short enough to be read and maintained.** Brevity is not superficial; Amazon's PR/FAQ discipline treats it as a forcing function for better thinking.

A useful extra test: if two competent readers would build materially different things from the same spec, the draft is not finished.

## Use requirement words deliberately

RFC 2119 gives widely reused meanings to `MUST`, `SHOULD`, and `MAY`; RFC 8174 clarifies that those special meanings apply only when the words are written in uppercase.

- `MUST` and `MUST NOT` mark absolute requirements or prohibitions.
- `SHOULD` and `SHOULD NOT` describe the default path while allowing carefully weighed exceptions.
- `MAY` marks something genuinely optional.

Use those words sparingly. RFC 2119 warns that imperatives should be reserved for cases such as interoperability, harm prevention, or real contractual constraints. "The banner MUST be blue" is usually noise. "The client MUST reject an invalid signature" may be essential.

## Common pitfalls and better versions

### Vague language

Weak: `Search should be fast.`

Better: `For the baseline workload, p95 search latency should remain below 300 ms.`

The better version can be tested, debated, or revised honestly.

### Prescribing an implementation instead of a behavior

Weak: `Use Redis for throttling.`

Better: `The service must reject more than 100 password-reset requests per account per hour.`

Only name the technology when the technology is the decision being specified.

### Hiding unresolved decisions

Weak: `Authentication TBD.`

Better: `Open issue: choose between signed session cookies and OAuth tokens before implementation starts because the choice changes logout behavior, storage, and mobile support.`

An open issue is acceptable. A hidden blocker is not.

### Forgetting non-goals

Weak: `Support import.`

Better: `This release supports CSV import only. XLSX files and scheduled imports are out of scope.`

Non-goals prevent silent scope growth and make prioritization visible.

### Writing only the happy path

Weak: `The user uploads a file and receives confirmation.`

Better: define invalid type, duplicate upload, expired session, partial parse failure, retry behavior, and what the user sees in each case.

Most costly disagreement appears outside the happy path.

### Overusing normative language

Weak: `The page MUST use a success toast after save.`

Better: `After save, the page shows confirmation. The implementation may use the standard success toast if no design exception is approved.`

Do not make preferences look like protocol rules.

## Human specs and AI-agent specs are not identical

The same intent often needs a different shape depending on the reader.

| Dimension | Human readers | AI-agent readers |
|---|---|---|
| Ambiguity tolerance | Moderate | Low |
| Rationale | Important for judgment and buy-in | Useful, but secondary to instructions |
| Constraints | Sometimes inferred from context | Must be explicit |
| Examples | Helpful | Often essential |
| Completion criteria | Can be partly conversational | Must be testable |
| Permissions | Socially understood | Must be stated mechanically |
| Stop conditions | Often implicit | Should be explicit |

Human-facing guidance can say:

> Prefer the smaller architecture change unless it materially increases operational risk.

Agent-facing guidance should say:

> Do not introduce a new service. Modify only the existing worker and API layer unless requirement `R3` cannot be satisfied within those bounds. If blocked, stop and report why.

For AI agents, a good spec often adds:
- Exact inputs and required output format
- Allowed tools, files, or systems
- Forbidden actions or approval gates
- Required checks before completion
- Examples of acceptable and unacceptable results
- A clear escalation rule when instructions conflict or information is missing

That is not bureaucracy. It is how delegated execution stays bounded and verifiable.

## A universal spec structure

Most teams can use this default structure and trim it for smaller work:

1. **Title, status, owner** — What is this document, who owns it, and is it draft, approved, or obsolete?
2. **Context and problem** — What changed, what hurts, or what opportunity exists?
3. **Goals and success criteria** — What outcome matters, and how will success be recognized?
4. **Scope and non-goals** — What is included, excluded, or deferred?
5. **Actors, scenarios, and workflows** — Who interacts with the system, and what cases matter most?
6. **Requirements and constraints** — Functional requirements, non-functional requirements, policy limits, compatibility needs.
7. **Proposed behavior or operating contract** — The core specification itself, matched to the spec type.
8. **Verification** — Acceptance criteria, examples, tests, review gates, or rollout checks.
9. **Risks, dependencies, and open questions** — What could derail the work, and which decisions remain unresolved?

For smaller efforts, reduce it to:

1. Problem
2. Goal
3. Scope and non-goals
4. Requirements
5. Proposed behavior
6. Verification
7. Risks and open questions

## Where specs fit in the workflow

Write the spec early enough to change decisions, not after implementation has already chosen them. Review it with the people who will build, test, support, or depend on the result. Update it when decisions change. Use it to drive implementation, verification, and delegation rather than treating it as ceremonial pre-work.

The strongest specs do three things at once: they make the intended behavior legible, expose unresolved thinking, and create a shared standard for judging whether the work is done.

## Sources worth borrowing from

- Joel Spolsky, [Painless Functional Specifications](https://www.joelonsoftware.com/2000/10/02/painless-functional-specifications-part-1-why-bother/)
- IETF [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)
- Amazon, [An insider look at Amazon's culture and processes](https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes)
- Anthropic, [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
- OpenAI, [Agent definitions](https://developers.openai.com/api/docs/guides/agents/define-agents)
