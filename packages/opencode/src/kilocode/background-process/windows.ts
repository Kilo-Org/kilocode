import { lazy } from "@/util/lazy"

// Native Windows calls for persistent background processes. The runner needs to know which
// processes belong to the command it started, and serve needs to know whether a pid is still the
// runner. A job object answers the first and a direct process query the second, so neither side
// has to start PowerShell and read the whole process table through WMI.
export namespace BackgroundProcessWindows {
  const LIST = 3 // JobObjectBasicProcessIdList
  const TERMINATE = 0x0001 // PROCESS_TERMINATE
  const QUERY = 0x1000 // PROCESS_QUERY_LIMITED_INFORMATION
  const SYNCHRONIZE = 0x100000
  const MISSING = 87 // ERROR_INVALID_PARAMETER: no process has this pid
  const DENIED = 5 // ERROR_ACCESS_DENIED
  const MORE = 234 // ERROR_MORE_DATA
  const COMMAND = 60 // ProcessCommandLineInformation, Windows 8.1 and later
  const LIMIT = 1024 * 1024

  async function open() {
    const ffi = await import("bun:ffi")
    const kernel = ffi.dlopen("kernel32.dll", {
      CreateJobObjectW: { args: ["ptr", "ptr"], returns: "u64" },
      AssignProcessToJobObject: { args: ["u64", "u64"], returns: "i32" },
      QueryInformationJobObject: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
      IsProcessInJob: { args: ["u64", "u64", "ptr"], returns: "i32" },
      GetCurrentProcess: { args: [], returns: "u64" },
      OpenProcess: { args: ["u32", "i32", "u32"], returns: "u64" },
      TerminateProcess: { args: ["u64", "u32"], returns: "i32" },
      WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
      CloseHandle: { args: ["u64"], returns: "i32" },
      GetLastError: { args: [], returns: "u32" },
    })
    const nt = ffi.dlopen("ntdll.dll", {
      NtQueryInformationProcess: { args: ["u64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
    })
    return { ptr: ffi.ptr, kernel: kernel.symbols, nt: nt.symbols }
  }

  // Loads once. A failure is kept instead of thrown so callers can fall back to PowerShell.
  export const native = lazy(() =>
    process.platform === "win32"
      ? open().then(
          (lib) => ({ lib, err: undefined }),
          (err: unknown) => ({ lib: undefined, err }),
        )
      : Promise.resolve({ lib: undefined, err: undefined }),
  )

  export type Job = {
    // Live members other than the current process: the command and everything it started.
    members(): number[]
    // Terminates every member except the current process. Each pid is opened and checked
    // against the job first, so a pid that was reused by an unrelated process is never touched.
    kill(): void
  }

  // Creates a job and moves the current process into it, so the command started next and every
  // process it creates are members from the moment they exist. Windows records the membership
  // when a process is created, so a descendant cannot slip out between two checks the way it can
  // with a process-table walk, and a reused parent pid cannot pull an unrelated process in.
  // The job sets no limits. With a breakaway limit, Git Bash and other Cygwin programs move every
  // process they start out of the job (they ask for CREATE_BREAKAWAY_FROM_JOB whenever their job
  // allows it), and the runner would lose the command's children. Without the limit, a breakaway
  // from an inner job stops here, and a process that insists on leaving fails to start.
  // Returns a reason instead of a job when jobs are unavailable.
  export async function job(): Promise<{ job: Job; reason?: undefined } | { job?: undefined; reason: string }> {
    const state = await native()
    const lib = state.lib
    if (!lib) return { reason: `bun:ffi unavailable: ${String(state.err)}` }
    const kernel = lib.kernel
    const handle = kernel.CreateJobObjectW(null, null)
    if (handle === 0n) return { reason: `CreateJobObjectW failed with Windows error ${kernel.GetLastError()}` }
    if (kernel.AssignProcessToJobObject(handle, kernel.GetCurrentProcess()) === 0) {
      const code = kernel.GetLastError()
      kernel.CloseHandle(handle)
      return { reason: `AssignProcessToJobObject failed with Windows error ${code}` }
    }
    const list = (size = 4096): number[] => {
      const info = new Uint8Array(size)
      const view = new DataView(info.buffer)
      if (kernel.QueryInformationJobObject(handle, LIST, info, size, null) !== 0) {
        return Array.from({ length: view.getUint32(4, true) }, (_, index) =>
          Number(view.getBigUint64(8 + index * 8, true)),
        )
      }
      const code = kernel.GetLastError()
      if (code !== MORE || size >= LIMIT) throw new Error(`QueryInformationJobObject failed with Windows error ${code}`)
      return list(Math.min(LIMIT, Math.max(size * 2, 8 + view.getUint32(0, true) * 8)))
    }
    return {
      job: {
        members: () => list().filter((pid) => pid !== process.pid),
        kill() {
          for (const pid of list()) {
            if (pid === process.pid) continue
            const proc = kernel.OpenProcess(TERMINATE | QUERY, 0, pid)
            if (proc === 0n) continue
            const result = new Int32Array(1)
            if (kernel.IsProcessInJob(proc, handle, result) !== 0 && result.at(0) !== 0)
              kernel.TerminateProcess(proc, 1)
            kernel.CloseHandle(proc)
          }
        },
      },
    }
  }

  export type Command = { live: false } | { live: true; line: string }

  // The command line of a process, read directly instead of through WMI. A pid that no process
  // holds, or a process that already exited, is { live: false }. A process this user may not
  // query cannot be one of ours, so it reports an empty command line. Returns a reason instead
  // when the answer is not certain, and the caller asks WMI.
  export async function command(pid: number): Promise<Command | { live?: undefined; reason: string }> {
    const state = await native()
    const lib = state.lib
    if (!lib) return { reason: `bun:ffi unavailable: ${String(state.err)}` }
    const kernel = lib.kernel
    const proc = kernel.OpenProcess(QUERY | SYNCHRONIZE, 0, pid)
    if (proc === 0n) {
      const code = kernel.GetLastError()
      if (code === MISSING) return { live: false }
      if (code === DENIED) return { live: true, line: "" }
      return { reason: `OpenProcess(${pid}) failed with Windows error ${code}` }
    }
    const read = (size: number): Command | { live?: undefined; reason: string } => {
      const info = new Uint8Array(size)
      const base = lib.ptr(info)
      const needed = new Uint32Array(1)
      const status = lib.nt.NtQueryInformationProcess(proc, COMMAND, base, size, needed)
      const want = needed.at(0) ?? 0
      if (status < 0 && want > size && want <= LIMIT) return read(want)
      if (status < 0) return { reason: `NtQueryInformationProcess(${pid}) failed with status ${status >>> 0}` }
      const view = new DataView(info.buffer)
      const length = view.getUint16(0, true)
      const start = Number(view.getBigUint64(8, true)) - base
      if (start < 16 || start + length > size)
        return { reason: `NtQueryInformationProcess(${pid}) returned an unexpected layout` }
      return { live: true, line: Buffer.from(info.buffer, start, length).toString("utf16le") }
    }
    const result = kernel.WaitForSingleObject(proc, 0) === 0 ? { live: false as const } : read(1024)
    kernel.CloseHandle(proc)
    return result
  }
}
