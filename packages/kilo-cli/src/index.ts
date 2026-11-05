#!/usr/bin/env bun

import "./env"
import "./global-boot"
import "./preload"
import { ensurePluginRuntime } from "@opencode/plugin/runtime"

export { ensurePluginRuntime }

await import("./main")
