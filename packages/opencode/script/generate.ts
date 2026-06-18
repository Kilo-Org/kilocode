import path from "path"
import { fileURLToPath } from "url"
import { parseModelsSnapshot } from "../src/kilocode/provider/models-snapshot-shape" // kilocode_change

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const modelsUrl = process.env.KILO_MODELS_URL || "https://models.dev"
// kilocode_change start
const raw = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
export const modelsData = JSON.stringify(parseModelsSnapshot(raw).data)
// kilocode_change end
console.log("Loaded models.dev snapshot")
