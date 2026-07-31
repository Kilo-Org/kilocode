import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"

describe("kilo run headless tools", () => {
  cliIt.live(
    "omits UI tools and exits when the model still calls suggest",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("suggest", {
          suggest: "Review the result",
          actions: [{ label: "Review", description: "Review the changes", prompt: "/review uncommitted" }],
        })
        yield* llm.text("finished without waiting for input")

        const result = yield* opencode.run("call suggest, then finish", {
          format: "json",
          extraArgs: ["--auto"],
          timeoutMs: 30_000,
        })
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("finished without waiting for input")

        const inputs = yield* llm.inputs
        const names = inputs.flatMap((input) =>
          ((input.tools ?? []) as Array<{ function?: { name?: string } }>).flatMap((item) =>
            item.function?.name ? [item.function.name] : [],
          ),
        )
        expect(names).toContain("glob")
        expect(names).not.toContain("question")
        expect(names).not.toContain("suggest")
      }),
    60_000,
  )
})
