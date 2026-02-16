declare module "tar-fs" {
  import { Writable } from "node:stream"

  export interface TarHeader {
    name: string
    linkname?: string
    type?: string
    [key: string]: unknown
  }

  export interface ExtractOptions {
    strip?: number
    map?: (header: TarHeader) => TarHeader
  }

  export function extract(cwd: string, options?: ExtractOptions): Writable
}
