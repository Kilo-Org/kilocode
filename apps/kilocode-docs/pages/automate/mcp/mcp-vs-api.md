---
title: "MCP vs API"
description: "Comparing MCP to traditional APIs"
---

# MCP vs REST APIs: A Fundamental Distinction

Comparing REST APIs to the Model Context Protocol (MCP) is a category error. They operate at different layers of abstraction and serve fundamentally different purposes in AI systems.

## Architectural Differences

| Feature              | MCP                                                  | REST APIs                                         |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| State Management     | **Stateful** - maintains context across interactions | **Stateless** - each request is independent       |
| Connection Type      | Persistent, bidirectional connections                | One-way request/response                          |
| Communication Style  | JSON-RPC based with ongoing sessions                 | HTTP-based with discrete requests                 |
| Context Handling     | Context is intrinsic to the protocol                 | Context must be manually managed                  |
| Tool Discovery       | Runtime discovery of available tools                 | Design-time integration requiring prior knowledge |
| Integration Approach | Runtime integration with dynamic capabilities        | Design-time integration requiring code changes    |

## Different Layers, Different Purposes

REST APIs and MCP serve different tiers in the technology stack:

1. **REST**: Low-level web communication pattern that exposes operations on resources
2. **MCP**: High-level AI protocol that orchestrates tool usage and maintains context

MCP often uses REST APIs internally, but abstracts them away for the AI. Think of MCP as middleware that turns discrete web services into a cohesive environment the AI can operate within.

## Context Preservation: Critical for AI Workflows

MCP's stateful design solves a key limitation of REST in AI applications:

- **REST Approach**: Each call is isolated, requiring manual context passing between steps
- **MCP Approach**: One conversation context persists across multiple tool uses

For example, an AI debugging a codebase can open a file, run tests, and identify errors without losing context between steps. The MCP session maintains awareness of previous actions and results.

## Dynamic Tool Discovery

MCP enables an AI to discover and use tools at runtime:

```json
// AI discovers available tools
{
	"tools": [
		{
			"name": "readFile",
			"description": "Reads content from a file",
			"parameters": {
				"path": { "type": "string", "description": "File path" }
			}
		},
		{
			"name": "createTicket",
			"description": "Creates a ticket in issue tracker",
			"parameters": {
				"title": { "type": "string" },
				"description": { "type": "string" }
			}
		}
	]
}
```

This "plug-and-play" capability allows new tools to be added without redeploying or modifying the AI itself.

## Real-World Example: Multi-Tool Workflow

Consider a task requiring multiple services: "Check recent commits, create a JIRA ticket for the bug fix, and post to Slack."

**REST-based approach**:

- Requires separate integrations for Git, JIRA, and Slack APIs
- Needs custom code to manage context between calls
- Breaks if any service changes its API

**MCP-based approach**:

- One unified protocol for all tools
- Maintains context across the entire workflow
- New tools can be swapped in without code changes

## Why Kilo Code Uses MCP

Kilo Code leverages MCP to provide:

1. **Extensibility**: Add unlimited custom tools without waiting for official integration
2. **Contextual awareness**: Tools can access conversation history and project context
3. **Simplified integration**: One standard protocol rather than numerous API patterns
4. **Runtime flexibility**: Discover and use new capabilities on-the-fly

MCP creates a universal connector between Kilo Code and external services, with REST APIs often powering those services behind the scenes.

## Conclusion: Complementary, Not Competing Technologies

MCP doesn't replace REST APIs - it builds upon them. REST excels at providing discrete services, while MCP excels at orchestrating those services for AI agents.

The critical distinction is that MCP is AI-native: it treats the model as a first-class user, providing the contextual, stateful interaction layer that AI agents need to function effectively in complex environments.
