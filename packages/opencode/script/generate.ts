import path from "path"
import { fileURLToPath } from "url"
import { parseModelsSnapshot } from "../src/kilocode/provider/models-snapshot-shape" // kilocode_change

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.KILO_MODELS_URL || "https://models.dev"
// kilocode_change start
const cacheFile = path.resolve(dir, "node_modules/.cache/models-dev-api.json")
const raw = await (async () => {
  if (process.env.MODELS_DEV_API_JSON) {
    return await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  }
  const cached = Bun.file(cacheFile)
  const exists = await cached.exists()
  if (exists) {
    const st = await cached.stat()
    if (st && Date.now() - st.mtimeMs < 6 * 3600 * 1000) {
      return await cached.text()
    }
  }
  try {
    const res = await fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`Failed to fetch models.dev snapshot: HTTP ${res.status}`)
    const text = await res.text()
    await Bun.write(cacheFile, text)
    return text
  } catch (err) {
    if (exists) return await cached.text()
    throw err
  }
})()
export const modelsData = JSON.stringify(parseModelsSnapshot(raw).data)
// kilocode_change end
console.log("Loaded models.dev snapshot")
