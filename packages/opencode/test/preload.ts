// IMPORTANT: Set env vars BEFORE any imports from src/ directory
// xdg-basedir reads env vars at import time, so we must set these first
import os from "os"
import path from "path"
import fs from "fs/promises"
import { afterAll } from "bun:test"
import { remove as cleanup } from "./kilocode/cleanup" // kilocode_change

// Set XDG env vars FIRST, before any src/ imports
// kilocode_change start - reusable test processes need a unique root for each isolated file global
const run = process.env.KILO_TEST_ROOT
const parent = run ?? os.tmpdir()
if (run) await fs.mkdir(run, { recursive: true })
const dir = await fs.mkdtemp(path.join(parent, "opencode-test-data-"))
// kilocode_change end
// kilocode_change start
afterAll(async () => {
  // Parent-launched units release process-global state when the child exits, and
  // the parent then removes the run root. Disposing between isolated file globals
  // invalidates resources that Bun may still be draining. Direct `bun test` runs
  // retain graceful shutdown because they do not set KILO_TEST_ROOT.
  if (run) return
  // kilocode_change end
  const { SessionExport } = await import("../src/kilocode/session-export") // kilocode_change
  const { Database } = await import("../src/storage/db")
  await SessionExport.shutdown() // kilocode_change
  Database.close()
  await cleanup(dir) // kilocode_change
})

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")
process.env["KILO_MODELS_PATH"] = path.join(import.meta.dir, "tool", "fixtures", "models-api.json")
process.env["KILO_EXPERIMENTAL_EVENT_SYSTEM"] = "true"
process.env["KILO_EXPERIMENTAL_WORKSPACES"] = "true"

// Set test home directory to isolate tests from user's actual home directory
// This prevents tests from picking up real user configs/skills from ~/.claude/skills
const testHome = path.join(dir, "home")
await fs.mkdir(testHome, { recursive: true })
process.env["KILO_TEST_HOME"] = testHome

// Set test managed config directory to isolate tests from system managed settings
const testManagedConfigDir = path.join(dir, "managed")
process.env["KILO_TEST_MANAGED_CONFIG_DIR"] = testManagedConfigDir

// Write the cache version file to prevent global/index.ts from clearing the cache
const cacheDir = path.join(dir, "cache", "kilo")
await fs.mkdir(cacheDir, { recursive: true })
await fs.writeFile(path.join(cacheDir, "version"), "21")

// Clear provider and server auth env vars to ensure clean test state
delete process.env["ANTHROPIC_API_KEY"]
delete process.env["OPENAI_API_KEY"]
delete process.env["GOOGLE_API_KEY"]
delete process.env["GOOGLE_GENERATIVE_AI_API_KEY"]
delete process.env["AZURE_OPENAI_API_KEY"]
delete process.env["AWS_ACCESS_KEY_ID"]
delete process.env["AWS_PROFILE"]
delete process.env["AWS_REGION"]
delete process.env["AWS_BEARER_TOKEN_BEDROCK"]
delete process.env["OPENROUTER_API_KEY"]
delete process.env["LLM_GATEWAY_API_KEY"]
delete process.env["GROQ_API_KEY"]
delete process.env["MISTRAL_API_KEY"]
delete process.env["PERPLEXITY_API_KEY"]
delete process.env["TOGETHER_API_KEY"]
delete process.env["XAI_API_KEY"]
delete process.env["DEEPSEEK_API_KEY"]
delete process.env["FIREWORKS_API_KEY"]
delete process.env["CEREBRAS_API_KEY"]
delete process.env["SAMBANOVA_API_KEY"]
delete process.env["KILO_SERVER_PASSWORD"]
delete process.env["KILO_SERVER_USERNAME"]

// Use in-memory sqlite
process.env["KILO_DB"] = ":memory:"

// Now safe to import from src/
const { Log } = await import("@opencode-ai/core/util/log")
const { initProjectors } = await import("../src/server/projectors")
// kilocode_change: bind the package memory effect layer to opencode for tests (paths/instance/log/events)
const { installMemoryRuntime } = await import("../src/kilocode/memory/runtime") // kilocode_change

void Log.init({
  print: false,
  dev: true,
  level: "DEBUG",
})

initProjectors()
installMemoryRuntime() // kilocode_change
