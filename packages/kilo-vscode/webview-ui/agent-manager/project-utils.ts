/** Shared path helpers for the project dialogs. */

/** Folder name Git would clone into, used for the destination preview. */
export { repoName } from "../../src/agent-manager/project/clone"

export const separator = (parent: string) => (parent.includes("\\") && !parent.includes("/") ? "\\" : "/")

export const joinPath = (parent: string, name: string) =>
  parent.endsWith("/") || parent.endsWith("\\") ? `${parent}${name}` : `${parent}${separator(parent)}${name}`
