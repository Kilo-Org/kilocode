import { join } from "node:path"
import { spawn } from "../util/process"

type DocumentText = { text: string; detail: string; truncated: boolean }

// Parsing and decompression never run in the extension host. These are IPC limits,
// independent of the smaller excerpts selected by the caller for model context.
const INPUT = 1024 * 1024
const OUTPUT = 650_000
const TIMEOUT = 4500

export async function extractDocument(
  bytes: Uint8Array,
  format: "text" | "html" | "pdf" | "docx",
  fragment: string | undefined,
  signal: AbortSignal,
): Promise<DocumentText> {
  signal.throwIfAborted()
  if (!bytes.length || bytes.length > INPUT) throw new Error("Document must contain 1 byte to 1 MiB.")
  if (fragment && fragment.length > 4096) throw new Error("Document fragment is too long.")
  const permission = ["--permission", "--experimental-permission"].find((flag) =>
    process.allowedNodeEnvironmentFlags.has(flag),
  )
  if (!permission) throw new Error("Document parsing requires a Node runtime with permission support.")

  const worker = join(__dirname, "response-lens-document-worker.mjs")
  // Node permissions are defense in depth, not an OS sandbox or a total-RSS quota.
  const child = spawn(
    process.execPath,
    [
      permission,
      `--allow-fs-read=${worker}`,
      "--max-old-space-size=128",
      "--max-semi-space-size=8",
      "--no-addons",
      "--disallow-code-generation-from-strings",
      worker,
    ],
    {
      cwd: __dirname,
      // Do not inherit NODE_OPTIONS, HOME, proxy settings, VS Code IPC, or provider credentials.
      // libuv fills these keys from the parent on Windows. Only the OS system root
      // is needed (for Node's CSPRNG initialization); no user/provider values pass.
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        HOMEDRIVE: "",
        HOMEPATH: "",
        LOGONSERVER: "",
        PATH: "",
        SYSTEMDRIVE: "",
        SYSTEMROOT: process.platform === "win32" ? (process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "") : "",
        TEMP: "",
        USERDOMAIN: "",
        USERNAME: "",
        USERPROFILE: "",
        WINDIR: "",
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    },
  )
  const pending = Promise.withResolvers<DocumentText>()
  const chunks: Buffer[] = []
  let size = 0
  let stderr = 0
  let failure: Error | undefined
  const kill = () => child.kill("SIGKILL")
  const fail = (error: Error) => {
    failure ??= error
    kill()
  }
  const abort = () => fail(new DOMException("Document parsing cancelled.", "AbortError"))
  const timeout = setTimeout(() => fail(new Error("Document parsing exceeded its time limit.")), TIMEOUT)
  process.once("exit", kill)
  signal.addEventListener("abort", abort, { once: true })
  child.on("error", () => fail(new Error("Document parser could not start.")))
  child.stdin!.on("error", () => fail(new Error("Document parser input failed.")))
  child.stdout!.on("data", (chunk: Buffer) => {
    size += chunk.length
    if (size > OUTPUT) return fail(new Error("Document parser exceeded its output limit."))
    if (!failure) chunks.push(chunk)
  })
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.length
    if (stderr > 16_384) fail(new Error("Document parser exceeded its diagnostic limit."))
  })
  child.once("close", (code) => {
    clearTimeout(timeout)
    signal.removeEventListener("abort", abort)
    process.removeListener("exit", kill)
    if (failure) return pending.reject(failure)
    if (code !== 0) return pending.reject(new Error("Document parser failed or exceeded its resource limit."))
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (typeof result?.error === "string" && result.error.length <= 200) throw new Error(result.error)
      if (
        typeof result?.text !== "string" ||
        !result.text.trim() ||
        result.text.length > 100_000 ||
        typeof result.detail !== "string" ||
        result.detail.length > 512 ||
        typeof result.truncated !== "boolean"
      )
        throw new Error("Document parser returned an invalid result.")
      pending.resolve({ text: result.text, detail: result.detail, truncated: result.truncated })
    } catch (error) {
      pending.reject(error instanceof SyntaxError ? new Error("Document parser returned invalid output.") : error)
    }
  })
  if (signal.aborted) abort()
  if (!failure) child.stdin!.end(JSON.stringify({ data: Buffer.from(bytes).toString("base64"), format, fragment }))
  // Wait for close even on abort/timeout: callers never receive a result with a live parser left behind.
  return pending.promise
}
