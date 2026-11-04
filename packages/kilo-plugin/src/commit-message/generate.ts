export * as CommitMessageGenerate from "./generate.js"

import type { KiloCommitMessageRpc } from "@opencode/schema/kilocode/commit-message"
import type { Model } from "@opencode/schema/model"
import { Effect, Schema } from "effect"
import type { GitContext } from "./git-context"

export class NoChangesError extends Schema.TaggedError<NoChangesError>()("CommitMessage.NoChangesError", {
  message: Schema.String,
}) {}

export class FailedError extends Schema.TaggedError<FailedError>()("CommitMessage.FailedError", {
  message: Schema.String,
}) {}

/** The request with the custom prompt of the config, which replaces `SYSTEM_PROMPT`. */
export interface Request extends KiloCommitMessageRpc.Input {
  readonly prompt?: string
}

/** The git, model and generation services, so tests can run `generate` without a repository or a model. */
export interface Runtime {
  readonly context: (path: string, selectedFiles?: readonly string[]) => Effect.Effect<GitContext>
  readonly model: () => Effect.Effect<Model.Ref | undefined>
  readonly text: (input: { prompt: string; model?: Model.Ref }) => Effect.Effect<string, unknown>
}

/** A slow provider or a stalled stream must not keep the source control spinner open. */
export const TIMEOUT_SECONDS = 30

export const SYSTEM_PROMPT = `You are an expert Git commit message generator that creates conventional commit messages based on staged changes. Analyze the provided git diff output and generate an appropriate conventional commit message following the specification.

## Conventional Commits Format
Generate commit messages following this exact structure:
\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Core Types (Required)
- **feat**: New feature or functionality (MINOR version bump)
- **fix**: Bug fix or error correction (PATCH version bump)

### Additional Types (Extended)
- **docs**: Documentation changes only
- **style**: Code style changes (whitespace, formatting, semicolons, etc.)
- **refactor**: Code refactoring without feature changes or bug fixes
- **perf**: Performance improvements
- **test**: Adding or fixing tests
- **build**: Build system or external dependency changes
- **ci**: CI/CD configuration changes
- **chore**: Maintenance tasks, tooling changes
- **revert**: Reverting previous commits

### Scope Guidelines
- Use parentheses: \`feat(api):\`, \`fix(ui):\`
- Common scopes: \`api\`, \`ui\`, \`auth\`, \`db\`, \`config\`, \`deps\`, \`docs\`
- For monorepos: package or module names
- Keep scope concise and lowercase

### Description Rules
- Use imperative mood ("add" not "added" or "adds")
- Start with lowercase letter
- No period at the end
- Maximum 72 characters
- Be concise but descriptive

### Body Guidelines (Optional)
- Start one blank line after description
- Explain the "what" and "why", not the "how"
- Wrap at 72 characters per line
- Use for complex changes requiring explanation

### Footer Guidelines (Optional)
- Start one blank line after body
- **Breaking Changes**: \`BREAKING CHANGE: description\`

## Analysis Instructions
When analyzing staged changes:
1. Determine Primary Type based on the nature of changes
2. Identify Scope from modified directories or modules
3. Craft Description focusing on the most significant change
4. Determine if there are Breaking Changes
5. For complex changes, include a detailed body explaining what and why
6. Add appropriate footers for issue references or breaking changes

For significant changes, include a detailed body explaining the changes.

Return ONLY the commit message in the conventional format, nothing else.`

export const generate = Effect.fn("CommitMessage.generate")(function* (request: Request, runtime: Runtime) {
  const context = yield* runtime.context(request.path, request.selectedFiles)
  if (context.files.length === 0)
    return yield* new NoChangesError({ message: "No changes found to generate a commit message for" })
  const model = yield* runtime.model()
  yield* Effect.logInfo("commit message generating", {
    branch: context.branch,
    files: context.files.length,
    model: model && `${model.providerID}/${model.id}`,
  })
  const text = yield* runtime.text({ prompt: prompt(request, context), model }).pipe(
    Effect.mapError((error) => new FailedError({ message: `Failed to generate commit message: ${errorMessage(error)}` })),
    Effect.timeoutOrElse({
      duration: `${TIMEOUT_SECONDS} seconds`,
      orElse: () =>
        Effect.fail(new FailedError({ message: `Commit message generation timed out after ${TIMEOUT_SECONDS} seconds` })),
    }),
    Effect.tapError((error) => Effect.logWarning("commit message generation failed", { error: error.message })),
  )
  return { message: clean(text) }
})

/**
 * The one prompt for `generate.text`, which has no separate system message: the instructions (the custom prompt or
 * `SYSTEM_PROMPT`, plus the language requirement), then the changes.
 */
export function prompt(request: Request, context: GitContext) {
  const files = context.files.map((file) => `${file.status} ${file.path}`).join("\n")
  const diffs = context.files
    .filter((file) => file.diff)
    .map((file) => `--- ${file.path} ---\n${file.diff}`)
    .join("\n\n")
  const changes = `Generate a commit message for the following changes:

Branch: ${context.branch}
Recent commits:
${context.recentCommits.join("\n")}

Changed files:
${files}

Diffs:
${diffs}`
  const different = request.previousMessage
    ? `IMPORTANT: Generate a COMPLETELY DIFFERENT commit message from the previous one. The previous message was: "${request.previousMessage}". Use a different type, scope, or description approach.\n\n`
    : ""
  return `${request.prompt || SYSTEM_PROMPT}${languageInstruction(request.language)}\n\n${different}${changes}`
}

export function languageInstruction(language?: string) {
  if (!language || language.toLowerCase() === "en") return ""
  return `\n\n## Language Requirement\nCRITICAL: You MUST generate the commit message in the following language: ${language}. The entire commit message including type, scope, description, body, and footer MUST be in this language.`
}

/** Removes a wrapping code fence, then matching surrounding quotes. */
export function clean(text: string) {
  const trimmed = text.trim()
  const opened = trimmed.startsWith("```") && trimmed.includes("\n") ? trimmed.slice(trimmed.indexOf("\n") + 1) : trimmed
  const closed = (opened.endsWith("```") ? opened.slice(0, -3) : opened).trim()
  const quoted = closed.length > 1 && (closed.startsWith('"') || closed.startsWith("'")) && closed.endsWith(closed[0])
  return (quoted ? closed.slice(1, -1) : closed).trim()
}

/** The most specific message of a provider or transport failure, which can be an Error, a tagged value or plain data. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && (error.message || error.name)) return error.message || error.name
  if (isRecord(error) && typeof error.message === "string" && error.message) return error.message
  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string" && error.data.message)
    return error.data.message
  const text = String(error)
  if (text && text !== "[object Object]") return text
  const json = JSON.stringify(error)
  return json && json !== "{}" ? json : "unknown error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
