import { X_KILOCODE_VERSION } from "../../shared/kilocode/headers"
import { Package } from "../../shared/package"
import { getKilocodeUrl } from "../../shared/kilocode/token"

export const DEFAULT_HEADERS = {
	"HTTP-Referer": getKilocodeUrl(),
	"X-Title": "Kilo Code",
	[X_KILOCODE_VERSION]: Package.version,
	"User-Agent": `Kilo-Code/${Package.version}`,
}
