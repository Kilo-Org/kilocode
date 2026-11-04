#!/usr/bin/env bun

import "./env"
import "./preload"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

await import("./main")
