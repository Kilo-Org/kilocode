export namespace MemoryConfig {
  export type Model = { providerID: string; modelID: string }

  /** Parse a `providerID/modelID` memory-model override. Returns undefined when blank or malformed
   * so callers can fall back to the session model. */
  export function parse(value: string | undefined): Model | undefined {
    if (!value) return undefined
    const [providerID, ...rest] = value.split("/")
    const modelID = rest.join("/")
    if (!providerID || !modelID) return undefined
    return { providerID, modelID }
  }
}
