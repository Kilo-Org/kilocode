import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi"
import { Log } from "@/util/log"
import { REASON, type Inhibitor } from "./types"

/**
 * macOS IOKit power assertion inhibitor.
 *
 * Faithful port of codex's `codex-rs/utils/sleep-inhibitor/src/macos.rs`.
 * Uses `IOPMAssertionCreateWithName` to register a kernel power assertion
 * of type `PreventUserIdleSystemSleep`, matching codex byte-for-byte at
 * `macos.rs:23-26, 66-90`.
 *
 * The assertion is identical to what `/usr/bin/caffeinate -i` holds, but we
 * own the lifecycle explicitly so it acquires on turn start and releases
 * on turn end. The kernel auto-releases on process death.
 *
 * FFI signatures are hand-written equivalents of codex's bindgen output
 * (`codex-rs/utils/sleep-inhibitor/src/iokit_bindings.rs`).
 */

const log = Log.create({ service: "sleep-inhibitor:macos" })

// kCFStringEncodingUTF8 — Apple's Core Foundation encoding constant.
const UTF8 = 0x08000100
// kIOPMAssertionLevelOn — see codex `macos.rs:80` and IOKit `IOPMLib.h`.
const LEVEL_ON = 255
// kIOReturnSuccess — codex `macos.rs:85`.
const OK = 0
// Apple exposes this assertion type as `CFSTR("PreventUserIdleSystemSleep")`.
// Codex re-creates the string at runtime (`macos.rs:26, 68`).
const ASSERTION_TYPE = "PreventUserIdleSystemSleep"

/**
 * Lazy loaders — keep `dlopen` out of module top-level so the native
 * frameworks are only probed on macOS (when `platform/select.ts` actually
 * calls `macos()`). On Linux/Windows these symbols are never loaded.
 */
function loadIOKit() {
  try {
    return dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", {
      IOPMAssertionCreateWithName: {
        // (CFStringRef type, IOPMAssertionLevel level, CFStringRef name, IOPMAssertionID* out)
        args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
      IOPMAssertionRelease: {
        // (IOPMAssertionID id)
        args: [FFIType.u32],
        returns: FFIType.i32,
      },
    })
  } catch (err) {
    log.warn("failed to load IOKit", { error: String(err) })
    return undefined
  }
}

function loadCoreFoundation() {
  try {
    return dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
      CFStringCreateWithCString: {
        // (CFAllocatorRef alloc, const char* str, CFStringEncoding enc)
        args: [FFIType.ptr, FFIType.cstring, FFIType.u32],
        returns: FFIType.ptr,
      },
      CFRelease: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      },
    })
  } catch (err) {
    log.warn("failed to load CoreFoundation", { error: String(err) })
    return undefined
  }
}

export function macos(): Inhibitor {
  const iokit = loadIOKit()
  const cf = loadCoreFoundation()
  if (!iokit || !cf) return { acquire() {}, release() {} }

  /**
   * Create a CFString from a UTF-8 JS string, passed as a null-terminated
   * buffer so bun:ffi's `cstring` argument type can consume it directly.
   * Returns a non-owning Pointer; caller must `CFRelease` it.
   *
   * Equivalent to codex's `CFString::new(...)` at `macos.rs:68-69`, which
   * wraps `CFStringCreateWithCString` in the `core-foundation` crate.
   */
  function cfstring(str: string): Pointer | null {
    const buf = Buffer.from(str + "\0", "utf8")
    const ref = cf!.symbols.CFStringCreateWithCString(null, buf, UTF8)
    if (!ref) {
      log.warn("CFStringCreateWithCString returned null", { str })
      return null
    }
    return ref
  }

  function cfrelease(handle: Pointer) {
    cf!.symbols.CFRelease(handle)
  }

  // AssertionID is a u32 out-param — codex `macos.rs:70-71, 82`.
  let id: number | null = null

  return {
    acquire() {
      if (id !== null) return // idempotent (codex `macos.rs:39-41`)

      const type = cfstring(ASSERTION_TYPE)
      if (type === null) return
      const name = cfstring(REASON)
      if (name === null) {
        cfrelease(type)
        return
      }

      const out = new Uint32Array(1)
      const result = iokit.symbols.IOPMAssertionCreateWithName(type, LEVEL_ON, name, ptr(out))

      // CFStrings are retained by IOKit for the duration of the assertion, so
      // we release our references immediately — matches `core-foundation`
      // Drop behavior in codex (`macos.rs:67-69` CFStrings go out of scope).
      cfrelease(type)
      cfrelease(name)

      if (result !== OK) {
        log.warn("IOPMAssertionCreateWithName failed", { code: result })
        return
      }
      id = out[0]!
    },

    release() {
      if (id === null) return
      const code = iokit.symbols.IOPMAssertionRelease(id)
      if (code !== OK) {
        log.warn("IOPMAssertionRelease failed", { code })
      }
      id = null
    },
  }
}
