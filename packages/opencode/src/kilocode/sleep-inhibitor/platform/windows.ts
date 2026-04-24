import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi"
import { Log } from "@/util/log"
import { REASON, type Inhibitor } from "./types"

/**
 * Windows power-request inhibitor.
 *
 * Faithful port of codex's `codex-rs/utils/sleep-inhibitor/src/windows_inhibitor.rs`.
 * Uses `PowerCreateRequest` + `PowerSetRequest(PowerRequestSystemRequired)` to
 * prevent idle system sleep, matching codex byte-for-byte at
 * `windows_inhibitor.rs:60-95`.
 *
 * This mirrors `caffeinate -i` behavior on macOS: prevents the system from
 * falling asleep but does not force the display on (codex comment
 * `windows_inhibitor.rs:78-79`).
 *
 * The reason string surfaces in `powercfg /requests` with the value `REASON`
 * from `./types.ts`, so sysadmins can see why the machine is kept awake.
 *
 * FFI signatures are hand-written equivalents of codex's `windows-sys` usage.
 */

const log = Log.create({ service: "sleep-inhibitor:windows" })

// REASON_CONTEXT.Version — codex `windows_inhibitor.rs:64`.
const CONTEXT_VERSION = 0
// REASON_CONTEXT.Flags = POWER_REQUEST_CONTEXT_SIMPLE_STRING — codex `windows_inhibitor.rs:65`.
const CONTEXT_SIMPLE_STRING = 0x1
// PowerRequestSystemRequired — codex `windows_inhibitor.rs:80`.
// Enum value is 1 per `windows-sys` crate and `winnt.h`:
//   PowerRequestDisplayRequired    = 0
//   PowerRequestSystemRequired     = 1  ← this one
//   PowerRequestAwayModeRequired   = 2
//   PowerRequestExecutionRequired  = 3
const REQUEST_SYSTEM_REQUIRED = 1

/**
 * REASON_CONTEXT struct size on x64 Windows.
 *
 *   Version:        u32 @ offset 0  (4 bytes)
 *   Flags:          u32 @ offset 4  (4 bytes)
 *   Reason (union): @ offset 8     (24 bytes — sized by largest member Detailed)
 *
 * Total = 32 bytes. Codex's `REASON_CONTEXT` via `windows-sys` has the same
 * layout because it is `#[repr(C)]`.
 *
 * For the SIMPLE_STRING variant we only write bytes 0..16; the remaining 16
 * are zeroed by `Buffer.alloc` and left untouched. Windows reads only the
 * SimpleReasonString pointer from the union when the flag is set.
 */
const CONTEXT_SIZE = 32

/**
 * Lazy loaders — keep `dlopen` out of module top-level so the native libraries
 * are only probed on Windows (when `platform/select.ts` actually calls
 * `windows()`). On macOS/Linux these symbols are never loaded.
 */
function loadPowrProf() {
  try {
    return dlopen("PowrProf.dll", {
      PowerCreateRequest: {
        // (REASON_CONTEXT* ctx) -> HANDLE
        args: [FFIType.ptr],
        returns: FFIType.ptr,
      },
      PowerSetRequest: {
        // (HANDLE req, POWER_REQUEST_TYPE type) -> BOOL
        args: [FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      PowerClearRequest: {
        // (HANDLE req, POWER_REQUEST_TYPE type) -> BOOL
        args: [FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
    })
  } catch (err) {
    log.warn("failed to load PowrProf.dll", { error: String(err) })
    return undefined
  }
}

function loadKernel() {
  try {
    return dlopen("Kernel32.dll", {
      CloseHandle: {
        // (HANDLE h) -> BOOL
        args: [FFIType.ptr],
        returns: FFIType.i32,
      },
    })
  } catch (err) {
    log.warn("failed to load Kernel32.dll", { error: String(err) })
    return undefined
  }
}

/**
 * Build a REASON_CONTEXT pointing at a UTF-16LE reason string.
 *
 * Port of codex's struct literal at `windows_inhibitor.rs:62-69`. The wide
 * string buffer must remain referenced until `PowerCreateRequest` returns,
 * so we return it alongside the context buffer and hold both on the stack
 * inside `acquire()`. Windows copies the string before returning per MSDN
 * (confirmed by codex comment at `windows_inhibitor.rs:70-71`).
 *
 * Pointer addresses are converted to `BigInt` before writing into the u64
 * field. This is safe on all current 64-bit OSes where virtual addresses
 * stay within the 53-bit safe-integer range (typically 47-48 bits used).
 */
function context() {
  const wide = Buffer.from(REASON + "\0", "utf16le")
  const ctx = Buffer.alloc(CONTEXT_SIZE)
  ctx.writeUInt32LE(CONTEXT_VERSION, 0)
  ctx.writeUInt32LE(CONTEXT_SIMPLE_STRING, 4)
  ctx.writeBigUInt64LE(BigInt(ptr(wide)), 8)
  return { ctx, wide }
}

export function windows(): Inhibitor {
  const powrprof = loadPowrProf()
  const kernel = loadKernel()
  if (!powrprof || !kernel) return { acquire() {}, release() {} }

  let handle: Pointer | null = null

  return {
    acquire() {
      if (handle !== null) return // idempotent (codex `windows_inhibitor.rs:32-34`)

      // Keep `ctx` and `wide` alive for the duration of this scope; the wide
      // string must outlive the PowerCreateRequest call.
      const built = context()
      const live = powrprof.symbols.PowerCreateRequest(ptr(built.ctx))
      if (!live) {
        log.warn("PowerCreateRequest failed")
        return
      }

      const ok = powrprof.symbols.PowerSetRequest(live, REQUEST_SYSTEM_REQUIRED)
      if (ok === 0) {
        log.warn("PowerSetRequest failed")
        // Match codex's error path: close the handle if set fails
        // (`windows_inhibitor.rs:83-89`).
        kernel.symbols.CloseHandle(live)
        return
      }

      handle = live
      // Explicitly reference `built` to ensure the buffers stay alive until
      // after the FFI calls above — Windows copies the reason internally.
      void built
    },

    release() {
      if (handle === null) return
      const live = handle
      handle = null

      // Port of codex's Drop impl at `windows_inhibitor.rs:98-118`: clear the
      // request then close the handle, warning on failure but never throwing.
      if (powrprof.symbols.PowerClearRequest(live, REQUEST_SYSTEM_REQUIRED) === 0) {
        log.warn("PowerClearRequest failed")
      }
      if (kernel.symbols.CloseHandle(live) === 0) {
        log.warn("CloseHandle failed")
      }
    },
  }
}
