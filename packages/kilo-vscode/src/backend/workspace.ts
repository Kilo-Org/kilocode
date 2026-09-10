import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { result, type AdapterOptions } from "./result"

export function createWorkspaceMethods(client: OpenCodeClient, defaultDirectory: string) {
  return {
    find: {
      files: <Throw extends boolean = false>(
        input: { directory?: string; query: string; type?: "file" | "directory"; limit?: number },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const response = await client.file.find(
            {
              location: { directory: input.directory ?? defaultDirectory },
              query: input.query,
              type: input.type,
              limit: input.limit,
            },
            options,
          )
          return response.data.map((entry) => entry.path)
        }, options),
    },
    project: {
      current: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
        result(async () => {
          const location = await client.location.get(
            { location: { directory: input.directory ?? defaultDirectory } },
            options,
          )
          const projects = await client.project.list(options)
          const project = projects.find((project) => project.id === location.project.id)
          if (!project) throw new Error("Current project is not available")
          return { ...project, worktree: location.project.directory }
        }, options),
    },
  }
}
