import path from "path"

process.env.KILO_DB = ":memory:"
process.env.KILO_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.KILO_DISABLE_MODELS_FETCH = "true"
