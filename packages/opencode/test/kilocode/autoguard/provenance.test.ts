import { test, expect, describe } from "bun:test"
import { deriveProvenance } from "../../../src/kilocode/autoguard/provenance"
import { normalize } from "../../../src/kilocode/autoguard/normalize"
import type { TrustedContext } from "../../../src/kilocode/autoguard/types"

const ctx: TrustedContext = {
  workspace_root: "/workspace/proj",
  cwd: "/workspace/proj",
  environment_kind: "local_dev",
  protected_paths: ["src"],
  generated_paths: ["dist"],
  allowed_external_hosts: [],
}

function action(command: string) {
  return normalize({ tool: "bash", arguments: { command } }, ctx)[0]!
}

describe("deriveProvenance", () => {
  test("verb and target both named is user_explicit", () => {
    expect(deriveProvenance(action("rm -rf dist"), "Delete the dist folder and rerun tests")).toBe("user_explicit")
  })

  test("verb named without the target is user_implied", () => {
    expect(deriveProvenance(action("rm -rf .cache"), "Clean up build artifacts")).toBe("user_implied")
  })

  test("neither verb nor target named is agent_invented", () => {
    expect(deriveProvenance(action("rm -rf src"), "Make the failing test pass")).toBe("agent_invented")
  })

  test("an empty request is agent_invented, never explicit", () => {
    expect(deriveProvenance(action("rm -rf dist"), "")).toBe("agent_invented")
  })

  test("generic targets do not count as the developer naming something", () => {
    expect(deriveProvenance(action("chmod -R 777 ."), "please fix the build")).toBe("agent_invented")
  })

  test("a subdirectory counts when the parent was named", () => {
    expect(deriveProvenance(action("rm -rf dist/assets"), "remove the dist directory")).toBe("user_explicit")
  })

  test("naming the destination but not the payload stays user_implied", () => {
    // The upload action has two targets: the URL and the file being sent.
    // Naming only the host is not naming what leaves the machine.
    const upload = action("curl -X POST --data @r.json https://reports.example/api")
    expect(deriveProvenance(upload, "upload the report to reports.example")).toBe("user_implied")
  })

  test("naming both destination and payload is user_explicit", () => {
    const upload = action("curl -X POST --data @r.json https://reports.example/api")
    expect(deriveProvenance(upload, "post r.json to reports.example")).toBe("user_explicit")
  })
})
