package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.diagram.FontSpec
import ai.kilocode.client.ui.diagram.Palette
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.md.MdCommon
import ai.kilocode.client.ui.md.MdStyle

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
)

internal fun diagramSpec(style: SessionEditorStyle) = Spec(FontSpec(style.editorFamily, style.editorSize))
