package ai.kilocode.client.ui

import com.intellij.ui.icons.CachedImageIcon
import com.intellij.ui.svg.SvgAttributePatcher
import com.intellij.util.SVGLoader
import java.awt.Color
import javax.swing.Icon

private const val OPAQUE_ALPHA = 255

internal fun Icon.colorizeIfPossible(
    fillColor: Color,
    borderColor: Color = fillColor,
    fillId: String? = null,
    strokeId: String? = null,
): Icon = (this as? CachedImageIcon)?.createWithPatcher(
    colorPatcher = object : SVGLoader.SvgElementColorPatcherProvider, SvgAttributePatcher {
        private val digest = longArrayOf(0L, 440413911775177385)

        override fun digest(): LongArray {
            digest[0] = toLong(fillColor.rgb, borderColor.rgb)
            return digest
        }

        override fun patchColors(attributes: MutableMap<String, String>) {
            val id = attributes["id"]
            if (fillId == null || id == fillId) setAttribute(attributes, "fill", fillColor)
            if (strokeId == null || id == strokeId) setAttribute(attributes, "stroke", borderColor)
        }

        override fun attributeForPath(path: String) = this

        private fun setAttribute(attributes: MutableMap<String, String>, key: String, color: Color) {
            if (!attributes.containsKey(key) || attributes[key] == "none") return
            attributes[key] = "rgb(${color.red},${color.green},${color.blue})"
            val alpha = color.alpha
            if (alpha != OPAQUE_ALPHA) {
                attributes["$key-opacity"] = "${alpha / OPAQUE_ALPHA.toFloat()}"
            }
        }

        private fun toLong(high: Int, low: Int): Long {
            return (high.toLong() shl 32) or (low.toLong() and 0xFFFFFFFFL)
        }
    },
) ?: this
