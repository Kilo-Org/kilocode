import { Record, Schema } from "effect"
import { PositiveInt } from "../schema"
import { EVENTS } from "./hooks-events"

const Handler = Schema.Struct({
  type: Schema.Literal("command"),
  command: Schema.String.annotate({
    description:
      "Command to run. Without args it runs in bash (Git Bash on Windows) or the platform shell; with args it is the program to spawn directly. It receives the hook input as JSON on stdin.",
  }),
  args: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Arguments for exec form: the command is spawned directly, without a shell.",
  }),
  shell: Schema.optional(Schema.Literals(["bash", "powershell"])).annotate({
    description: "Shell for the command when args is not set. Default: bash.",
  }),
  if: Schema.optional(Schema.String).annotate({
    description:
      'Tool events only: a permission-rule condition such as "Bash(rm *)" or "Edit(*.env)". The hook runs only when the call matches, or when Kilo cannot tell.',
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description:
      "Timeout in seconds. Default: 600; 30 for UserPromptSubmit and the model-switch events; 10 for BranchName; see the docs for the rest. A hook that times out does not block, except PreModelSwitch.",
  }),
  onFailure: Schema.optional(Schema.Literals(["continue", "block"])).annotate({
    description:
      'What happens when the hook fails (cannot start, times out, exits with a code other than 0 or 2, prints invalid JSON): "continue" (default) lets the action proceed, "block" blocks it on events that can block.',
  }),
  async: Schema.optional(Schema.Boolean).annotate({
    description: "Run in the background without waiting. Output, exit code and onFailure are ignored.",
  }),
}).annotate({ identifier: "HookHandlerConfig" })

const Group = Schema.Struct({
  matcher: Schema.optional(
    Schema.String.annotate({
      description:
        'What it matches depends on the event (tool name, source, trigger, ...): "*" or omitted matches everything, "a|b" matches exact names, anything else is a regular expression. Ignored on events without a matcher.',
    }),
  ),
  hooks: Schema.mutable(Schema.Array(Handler)),
}).annotate({ identifier: "HookGroupConfig" })

const Groups = Schema.optional(Schema.mutable(Schema.Array(Group)))

export const Info = Schema.optional(
  Schema.Struct(Record.map(EVENTS, (meta) => Groups.annotate({ description: meta.description }))),
).annotate({
  description:
    "Shell command hooks run on agent events. Uses the Claude Code hooks format; behavior matches Claude Code 2.1.301 except where the docs list a difference. Only read from global, managed, or organization config; project config hooks are ignored.",
})

export * as KiloHooksSchema from "./hooks-schema"
