#!/usr/bin/env bun

import { $ } from "bun"

const args = process.argv.slice(2)
const target = args.length > 0 ? args : ["."]

await $`bun run prettier --ignore-unknown --write ${target}`
