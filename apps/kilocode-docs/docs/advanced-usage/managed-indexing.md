---
title: Managed Indexing
sidebar_label: Managed Indexing
---

Kilo's **Managed Indexing** feature provides semantic search across your repositories using cloud-hosted embeddings. When enabled, Kilo indexes your codebase to deliver more relevant, context-aware responses during development.

---

## What Managed Indexing Enables

- Semantic search across your entire codebase
- More accurate and context-aware AI responses
- Git-aware indexing that tracks your base branch and feature branch changes
- Shared indexes for teams and enterprise accounts
- Cost-effective cloud storage with automatic cleanup of stale indexes

---

## Prerequisites

Before enabling Managed Indexing:

- **Your workspace must be a Git repository**  
  Indexing requires a Git repository root directory. Non-Git folders will not be indexed.

- **Available credit balance**  
  If your balance reaches zero, managed indexing will be disabled and the extension will revert to local indexing (if configured).

---

## Cost

- **Currently free during beta**
- **Pricing coming soon** — A daily usage fee for index storage will be deducted from your AI credit balance. You will be charged per GB per day.
- **Embedding model** — Uses `mistralai/codestral-embed-2505` which currently charges $0.15/M input tokens.

---

## How to Enable

Codebase Indexing is rolling out across our users. It will automatically engage unless your repository root is configured to opt out.

1. Create a `.kilocode/config.json` file in the root of your repository (if it doesn't already exist).
2. Add the following configuration:

```json
{
	"project": {
		"managedIndexingEnabled": false
	}
}
```

### Configuration Options

| Field                            | Type    | Required | Description                                                                                 |
| -------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------- |
| `project.id`                     | string  | No       | Custom name for your project. Defaults to the name from your Git origin remote.             |
| `project.baseBranch`             | string  | No       | Specifies your base branch if it isn't `main`, `master`, `dev`, or `develop`.               |
| `project.managedIndexingEnabled` | boolean | No       | Set to `false` to disable indexing for individual project repositories. Defaults to `true`. |

Organization-wide indexing is enabled for any organization that has a credit balance. If you want to disable indexing for a specific repository, set `managedIndexingEnabled` to `false` in the config file.

---

## How Managed Indexing Works

- **Base branch** — Indexed in its entirety
- **Feature branches** — Only changes from the base branch are indexed
- **Detached HEAD states** — Not indexed
- **Storage** — Embeddings are stored in Kilo Cloud. Your actual code is never stored, only the vector embeddings.
- **Team sharing** — For teams and enterprise accounts, indexes are shared among all team members.

### Index Retention

Indexes are stored for **7 days**. If a branch or repository index hasn't been updated within that window, it will be garbage collected. The next time you open the project in VS Code with Kilo running, it will be re-indexed automatically.

This retention policy keeps costs minimal by only maintaining indexes for actively used code.

---

## Managing Your Indexes

A minimal UI is available at [app.kilo.ai](https://app.kilo.ai) to:

- View the size and status of your indexed projects
- Delete old branches & projects.

---

## Migration from Local Indexing

Enabling managed indexing will **replace local self-hosted indexing entirely**. If you have already configured local indexing for a workspace it will take precedence until you disable it.

### Automatic Reversion

If your credit balance reaches zero, the extension will automatically revert to local indexing (if previously configured).

---

## Perfect For

Managed Indexing is ideal for:

- **Developers wanting smarter, context-aware AI assistance**
- **Teams needing shared semantic search across repositories**
- **Large codebases where finding relevant code is difficult**
- **Organizations wanting centralized index management**

---

## Limitations and Guidance

- **Git repository required** — Only Git repository root directories can be indexed. We plan to extend this in the future.
- **Detached HEAD not supported** — Commits in detached HEAD state will not be indexed.
- **7-day retention** — Unused indexes are automatically removed after 7 days.
- **Beta capacity** — During beta, indexing capacity may be limited for very large repositories.
- **Organization indexing** — Shared organization indexes currently require contacting support.
