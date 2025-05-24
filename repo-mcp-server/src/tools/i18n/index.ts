/**
 * i18n tools index file
 * Export all i18n tool handlers from this module
 */

import translateKeyTool from "./translateKey.js"
import moveKeyTool from "./moveKey.js"
import listLocalesTool from "./listLocales.js"
import removeKeysTool from "./removeKeys.js"

// Export all tools as an array
export const i18nTools = [translateKeyTool, moveKeyTool, listLocalesTool, removeKeysTool]

// Export individual tools for direct access
export { translateKeyTool, moveKeyTool, listLocalesTool, removeKeysTool }
