---
title: "Model/Provider Blocklist"
description: "Proposal to replace the model/provider allowlist with a blocklist approach for enterprise team management"
---

# Model/Provider Blocklist

## Overview

Enterprise organization administrators currently manage which models and providers their team members can use through an **allowlist** system in the Providers & Models settings page. This system stores two lists in organization settings: one for allowed models and one for allowed providers. It has proven confusing for customers and adds unnecessary friction.

- By default, an empty allowlist means "allow everything." Once an admin customizes any setting, new models added by providers are **not** automatically available -- the admin must manually approve each one.
- An "Allow all current and future models" checkbox was added per-provider to address this. It works by adding a provider wildcard entry to the model allow list, which allows any model offered by that provider (including future ones). However, it has a critical flaw: if an admin disables one specific model that was allowed via the wildcard, the wildcard itself is removed. The admin is then forced back into manual per-model curation. Additionally, you have to set this manually for each provider.
- The net result is that admins must either allow everything wholesale or commit to ongoing manual curation of hundreds of model/provider combinations.

This proposal replaces the allowlist with a **blocklist** approach. The default behavior becomes "everything is allowed unless explicitly blocked," which eliminates the ongoing maintenance burden while still giving admins precise control.

## Requirements

- This feature remains restricted to **enterprise plans only**, consistent with the current allowlist system. Teams-plan organizations get unrestricted model/provider access.
- All models and providers are **allowed by default**, including newly added ones.
- Admins can block an entire provider (all current and future models from that provider).
- Admins can block a specific model/provider combination without affecting other providers offering the same model.
- The UI must make it easy to find and block specific models across a large catalog (300+ models, 65+ providers).
- Migration from the existing allowlist data must be handled without disrupting current customer configurations.

### Non-requirements

- Blocking a model across _all_ current and future providers (e.g., "block model X regardless of who offers it"). This can be added later if there is demand, but adds complexity and is not needed for the initial implementation.
- Per-user or per-team blocklists. This proposal covers organization-level controls only.
- Cost controls or spending limits per model. This is a separate concern.

## System Design

### Core Semantics

The system shifts from "deny by default, explicitly allow" to **"allow by default, explicitly deny"**:

| Scenario                              | Behavior                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No blocklist entries                  | All models and providers are available (default)                                                                                                       |
| Provider blocked                      | All current and future models from that provider are unavailable. The same model may still be available from other providers.                          |
| Specific model/provider combo blocked | Only that specific combination is unavailable. The model remains available from other providers, and other models from that provider remain available. |

### Plan Gating

Blocklist enforcement only applies to enterprise-plan organizations. For non-enterprise organizations (including teams plans), the blocklist fields are ignored and all models/providers are available. This mirrors the current allowlist behavior.

The mutation to update blocklists must remain gated behind organization owner permissions and an enterprise plan check, consistent with the existing allowlist mutation.

### Implementation design

TBD

### UI Design

Replace the current dual-tab (Models / Providers) layout with a **single unified view** organized by provider:

**Main view: Provider list with expandable models**

- A flat list of all providers, each expandable to show its offered models.
- Each provider row has a block/unblock toggle. Blocking a provider visually marks all its models as blocked.
- Each model row (within an expanded provider) has a block/unblock toggle for that specific model/provider combination.
- A **free-text search/filter box** at the top filters both providers and models. For example, typing "K2.5" filters the provider list to only those offering a matching model, and within each provider only shows the matching models. This makes it easy to block a specific model across select providers. Providers are auto-expanded to show the matching models.
- Blocked items are visually distinct (e.g., a red/muted treatment) so the current block state is immediately clear.
- A summary indicator shows total blocked count (e.g., "3 providers blocked, 7 model combinations blocked").

**Interaction examples:**

| Action                                   | Result                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Block provider "Chutes"                  | All Chutes models become unavailable. Future models from Chutes are also blocked.                                                                     |
| Search "K2.5", block it under Fireworks  | Only K2.5 via Fireworks is blocked. K2.5 via other providers is unaffected.                                                                           |

## Features for the Future

- **Cross-provider model blocking**: Block a model ID across all current and future providers (e.g., "block anthropic/claude-opus-4.6 regardless of which provider serves it"). Deferred unless there is significant demand.
- **Per-team / per-project blocklists**: Allow different teams within an organization to have different blocklist policies.
- **Cost-based controls**: Automatically block models above a certain price threshold.
- **Temporary blocks**: Time-limited blocks for models under evaluation or during incident response.
