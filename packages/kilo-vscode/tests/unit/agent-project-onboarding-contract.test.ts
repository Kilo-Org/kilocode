import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import { Project } from "ts-morph"

const project = new Project({ skipAddingFilesFromTsConfig: true })
const root = resolve(import.meta.dir, "../..")

const unions = [
  ["src/agent-manager/types.ts", "AgentManagerInMessage", "In"],
  ["webview-ui/src/types/messages/webview-messages.ts", "WebviewMessage", "Message"],
] as const

describe("project onboarding contracts", () => {
  for (const [path, union, suffix] of unions) {
    const source = project.addSourceFileAtPath(resolve(root, path))
    const includes = (name: string) =>
      expect(source.getTypeAliasOrThrow(union).getTypeNodeOrThrow().getText()).toMatch(new RegExp(`\\b${name}\\b`))

    it(`${union} includes a payloadless add request`, () => {
      const name = `AddProject${suffix}`
      const contract = source.getInterfaceOrThrow(name)
      expect(contract.getProperties().map((property) => property.getName())).toEqual(["type"])
      expect(contract.getPropertyOrThrow("type").getTypeNodeOrThrow().getText()).toBe(`"agentManager.addProject"`)
      includes(name)
    })

    it(`${union} carries the URL and parent for cloneProject`, () => {
      const name = `CloneProject${suffix}`
      const contract = source.getInterfaceOrThrow(name)
      expect(contract.getProperties().map((property) => property.getName())).toEqual(["type", "url", "parent"])
      includes(name)
    })

    it(`${union} carries the parent and name for createProject`, () => {
      const name = `CreateProject${suffix}`
      const contract = source.getInterfaceOrThrow(name)
      expect(contract.getProperties().map((property) => property.getName())).toEqual(["type", "parent", "name"])
      includes(name)
    })

    it(`${union} includes the parent request and picker`, () => {
      for (const action of ["Request", "Pick"]) {
        const name = `${action}ProjectParent${suffix}`
        const contract = source.getInterfaceOrThrow(name)
        const expected = action === "Pick" ? ["type", "defaultPath"] : ["type"]
        expect(contract.getProperties().map((property) => property.getName())).toEqual(expected)
        includes(name)
      }
    })
  }
})
