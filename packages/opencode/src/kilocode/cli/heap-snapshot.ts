import path from "path"
import { writeHeapSnapshot } from "node:v8"
import { Global } from "@/global"

export namespace HeapSnapshot {
  export function write() {
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    return writeHeapSnapshot(file)
  }
}
