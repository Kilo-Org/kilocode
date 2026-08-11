import path from "path"
import { Global } from "../global"

export const target = path.join(Global.Path.bin, process.platform === "win32" ? "rg.exe" : "rg")
