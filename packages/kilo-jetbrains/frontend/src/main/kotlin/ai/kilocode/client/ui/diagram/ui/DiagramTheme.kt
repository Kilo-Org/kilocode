package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.md.MdCommon
import ai.kilocode.client.ui.md.MdStyle
import java.awt.Color

internal fun diagramPalette(style: SessionEditorStyle, opts: MdStyle = MdCommon.defaults(style)) = Palette(
    surface = UiStyle.Colors.contrast(opts.preBg, 8),
    border = opts.codeBorder,
    text = opts.foreground,
    muted = opts.quoteFg,
    accent = opts.linkColor,
    note = opts.quoteBg,
    cluster = opts.codeBorder,
    line = opts.quoteFg,
    font = style.editorFont,
    bold = style.boldEditorFont,
    tones = diagramTones(opts.linkColor),
)

/**
 * Categorical chart colors derived from the theme accent by rotating hue at a golden-angle-ish step,
 * so every theme gets a distinct but related series without hardcoding raw colors. Saturation and
 * brightness are clamped into a band that stays readable on both light and dark surfaces.
 */
internal fun diagramTones(accent: Color): List<Color> {
    val hsb = Color.RGBtoHSB(accent.red, accent.green, accent.blue, null)
    val sat = hsb[1].coerceIn(0.45f, 0.7f)
    val bri = hsb[2].coerceIn(0.55f, 0.85f)
    return List(8) { idx -> Color.getHSBColor(hsb[0] + idx * 0.118f, sat, bri) }
}

internal fun diagramSpec(style: SessionEditorStyle) = Spec(FontSpec(style.editorFamily, style.editorSize))
