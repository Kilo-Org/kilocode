#!/usr/bin/env bun

import "./env"
import "./branding/preload"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

await import("./main")
