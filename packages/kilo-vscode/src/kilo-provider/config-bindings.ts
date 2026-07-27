import { randomUUID } from "crypto"

export type ConfigScope = "global" | "project"

export interface ConfigTarget {
  scope: ConfigScope
  path: string
  revision: string
  exists: boolean
  writable: boolean
  raw: Record<string, unknown>
}

export interface ConfigProject {
  id: string
  root: string
  generation: number
  pinned: boolean
}

export interface ConfigBinding {
  id: string
  connection: number
  scope: ConfigScope
  directory: string
  target: ConfigTarget
  project?: ConfigProject
}

export class ConfigBindings {
  private readonly bindings = new Map<string, ConfigBinding>()

  create(input: Omit<ConfigBinding, "id">): ConfigBinding {
    const binding = { ...input, id: randomUUID() }
    this.bindings.set(binding.id, binding)
    return binding
  }

  get(
    id: string | undefined,
    connection: number,
    valid: (project: ConfigProject) => boolean,
  ): ConfigBinding | undefined {
    if (!id) return undefined
    const binding = this.bindings.get(id)
    if (!binding || binding.connection !== connection) return undefined
    if (binding.project && !valid(binding.project)) return undefined
    return binding
  }

  consume(id: string): void {
    this.bindings.delete(id)
  }

  clear(): void {
    this.bindings.clear()
  }
}
