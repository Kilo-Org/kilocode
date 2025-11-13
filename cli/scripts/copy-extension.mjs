import { cpSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const cliDir = join(__dirname, "..")

const source = join(cliDir, "..", "bin-unpacked", "extension")
const dest = join(cliDir, "dist", "kilocode")

console.log(`Copying from: ${source}`)
console.log(`Copying to: ${dest}`)

try {
	cpSync(source, dest, { recursive: true })
	console.log("✓ Extension files copied successfully")
} catch (error) {
	console.error("Error copying extension files:", error)
	process.exit(1)
}
