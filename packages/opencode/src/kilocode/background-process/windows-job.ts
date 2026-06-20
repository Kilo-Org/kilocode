import { dlopen, ptr } from "bun:ffi"

export namespace WindowsJob {
  const LIMITS = 9
  const MEMBERS = 3
  const KILL_ON_CLOSE = 0x00002000
  const PROCESS_TERMINATE = 0x0001
  const PROCESS_SET_QUOTA = 0x0100
  const MORE_DATA = 234

  function kernel() {
    return dlopen("kernel32.dll", {
      CreateJobObjectW: { args: ["ptr", "ptr"], returns: "u64" },
      SetInformationJobObject: { args: ["u64", "u32", "ptr", "u32"], returns: "i32" },
      OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
      AssignProcessToJobObject: { args: ["u64", "u64"], returns: "i32" },
      QueryInformationJobObject: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
      TerminateJobObject: { args: ["u64", "u32"], returns: "i32" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      GetLastError: { args: [], returns: "u32" },
    })
  }

  export function create() {
    const lib = (() => {
      try {
        return kernel()
      } catch {
        return undefined
      }
    })()
    if (!lib) return
    const handle = lib.symbols.CreateJobObjectW(null, null)
    if (handle === 0n) {
      const code = lib.symbols.GetLastError()
      lib.close()
      throw new Error(`CreateJobObjectW failed with Windows error ${code}`)
    }
    const limits = new Uint8Array(144)
    new DataView(limits.buffer).setUint32(16, KILL_ON_CLOSE, true)
    if (lib.symbols.SetInformationJobObject(handle, LIMITS, ptr(limits), limits.byteLength) === 0) {
      const code = lib.symbols.GetLastError()
      lib.symbols.CloseHandle(handle)
      lib.close()
      throw new Error(`SetInformationJobObject failed with Windows error ${code}`)
    }
    let closed = false
    return {
      assign(pid: number) {
        const proc = lib.symbols.OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, 0, pid)
        if (proc === 0n) throw new Error(`OpenProcess failed with Windows error ${lib.symbols.GetLastError()}`)
        const assigned = lib.symbols.AssignProcessToJobObject(handle, proc)
        const code = assigned === 0 ? lib.symbols.GetLastError() : 0
        lib.symbols.CloseHandle(proc)
        if (assigned === 0) throw new Error(`AssignProcessToJobObject failed with Windows error ${code}`)
      },
      members() {
        let size = 4 * 1024
        while (true) {
          const info = new Uint8Array(size)
          const ok = lib.symbols.QueryInformationJobObject(handle, MEMBERS, ptr(info), info.byteLength, null)
          const code = ok === 0 ? lib.symbols.GetLastError() : 0
          const view = new DataView(info.buffer)
          const assigned = view.getUint32(0, true)
          const count = view.getUint32(4, true)
          if (ok !== 0 && count === assigned) {
            return Array.from({ length: count }, (_, index) => Number(view.getBigUint64(8 + index * 8, true)))
          }
          if (ok === 0 && code !== MORE_DATA) {
            throw new Error(`QueryInformationJobObject failed with Windows error ${code}`)
          }
          size = Math.max(size * 2, 8 + assigned * 8)
        }
      },
      terminate() {
        if (lib.symbols.TerminateJobObject(handle, 1) === 0) {
          throw new Error(`TerminateJobObject failed with Windows error ${lib.symbols.GetLastError()}`)
        }
      },
      close() {
        if (closed) return
        closed = true
        lib.symbols.CloseHandle(handle)
        lib.close()
      },
    }
  }
}
