export function flowPermissionPresentation(source: { action: string; resources: ReadonlyArray<unknown> }) {
  if (source.action !== "flow") return
  const resources = source.resources.filter((item): item is string => typeof item === "string")
  return {
    icon: "⚙",
    title: "Call tool flow",
    lines: resources.length > 0 ? resources.map((resource) => `- ${resource}`) : ["Tool: flow"],
  }
}
