import { Provider } from "@/provider/provider"

export namespace MemoryConfig {
  export function parse(value: string | undefined) {
    if (!value) return undefined
    const [providerID, ...rest] = value.split("/")
    if (!providerID || !rest.join("/")) return undefined
    return Provider.parseModel(value)
  }
}
