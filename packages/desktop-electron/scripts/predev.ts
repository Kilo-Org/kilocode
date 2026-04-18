import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.KILO_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
