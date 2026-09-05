import { recovery } from "./bench-recovery"
import { readFileSync } from "node:fs"
import { z } from "zod"
import { createAutoGuardPlugin } from "./plugin"
import { DEFAULT_LEVEL1_CONFIG } from "./level1"

function createAutoGuardBenchPlugin() {
  const mode = process.env.AUTOGUARD_BENCH_LEVEL ?? "level0_level1"
  if (!process.env.AUTOGUARD_AUDIT_PATH)
    throw new Error("AUTOGUARD_AUDIT_PATH must name a host-owned log outside the workspace")
  const file = process.env.AUTOGUARD_SCRIPTED_ANSWERS_FILE
  const scripted =
    process.env.AUTOGUARD_INTERACTION === "scripted" && file
      ? z
          .array(
            z.union([
              z.object({ operation: z.string(), target: z.string(), approved: z.boolean() }).strict(),
              z
                .object({
                  question_pattern: z.string().refine((value) => {
                    try {
                      new RegExp(value, "iu")
                      return true
                    } catch {
                      return false
                    }
                  }),
                  answer: z.string().min(1),
                })
                .strict(),
            ]),
          )
          .parse(JSON.parse(readFileSync(file, "utf8")))
      : undefined
  return createAutoGuardPlugin({
    scripted,
    onEvent: recovery(process.env.AUTOGUARD_ORACLE_CONFIG, process.env.AUTOGUARD_AUDIT_PATH),
    observe: mode === "guard_off",
    audit: process.env.AUTOGUARD_AUDIT_PATH,
    cascade: {
      useLevel1: mode !== "level0" && mode !== "guard_off",
      useLevel2: false,
      level1: { ...DEFAULT_LEVEL1_CONFIG, view: mode === "level0_level1_legacy" ? "intent_action" : "full_context" },
    },
  })
}
const AutoGuardBenchPlugin = createAutoGuardBenchPlugin()
export default AutoGuardBenchPlugin
