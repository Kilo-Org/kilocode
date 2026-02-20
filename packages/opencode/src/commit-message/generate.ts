import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Agent } from "@/agent/agent"
import { Log } from "@/util/log"
import type { CommitMessageRequest, CommitMessageResponse, GitContext } from "./types"
import { getGitContext } from "./git-context"

const log = Log.create({ service: "commit-message" })

const SYSTEM_PROMPT = `You are an expert Git commit message generator that creates conventional commit messages based on staged changes. Analyze the provided git diff output and generate an appropriate conventional commit message following the specification.

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

function buildUserMessage(ctx: GitContext): string {
  const fileList = ctx.files.map((f) => `${f.status} ${f.path}`).join("\n")
  const diffs = ctx.files
    .filter((f) => f.diff)
    .map((f) => `--- ${f.path} ---\n${f.diff}`)
    .join("\n\n")

  return `Generate a commit message for the following changes:

Branch: ${ctx.branch}
Recent commits:
${ctx.recentCommits.join("\n")}

Changed files:
${fileList}

Diffs:
${diffs}`
}

function clean(text: string): string {
  let result = text.trim()
  // Strip code block markers
  if (result.startsWith("```")) {
    const first = result.indexOf("\n")
    if (first !== -1) {
      result = result.slice(first + 1)
    }
  }
  if (result.endsWith("```")) {
    result = result.slice(0, -3)
  }
  result = result.trim()
  // Strip surrounding quotes
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
    result = result.slice(1, -1)
  }
  return result.trim()
}

export async function generateCommitMessage(request: CommitMessageRequest): Promise<CommitMessageResponse> {
  const ctx = await getGitContext(request.path, request.selectedFiles)
  if (ctx.files.length === 0) {
    throw new Error("No changes found to generate a commit message for")
  }

  log.info("generating", {
    branch: ctx.branch,
    files: ctx.files.length,
  })

  const defaultModel = await Provider.defaultModel()
  const model =
    (await Provider.getSmallModel(defaultModel.providerID)) ??
    (await Provider.getModel(defaultModel.providerID, defaultModel.modelID))

  const agent: Agent.Info = {
    name: "commit-message",
    mode: "primary",
    hidden: true,
    options: {},
    permission: [],
    prompt: SYSTEM_PROMPT,
    temperature: 0.3,
  }

  let userMessage = buildUserMessage(ctx)
  if (request.previousMessage) {
    userMessage = `IMPORTANT: Generate a COMPLETELY DIFFERENT commit message from the previous one. The previous message was: "${request.previousMessage}". Use a different type, scope, or description approach.\n\n${userMessage}`
  }

  const stream = await LLM.stream({
    agent,
    user: {
      id: "commit-message",
      sessionID: "commit-message",
      role: "user",
      model: {
        providerID: model.providerID,
        modelID: model.id,
      },
      time: {
        created: Date.now(),
        completed: Date.now(),
      },
    } as any,
    tools: {},
    model,
    small: true,
    messages: [
      {
        role: "user" as const,
        content: userMessage,
      },
    ],
    abort: new AbortController().signal,
    sessionID: "commit-message",
    system: [],
    retries: 3,
  })

  const result = await stream.text
  log.info("generated", { message: result })

  return { message: clean(result) }
}
