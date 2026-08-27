package ai.kilocode.client.ui.diagram

import java.awt.Color
import java.awt.Font

internal data class Palette(
    val surface: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val note: Color,
    val cluster: Color,
    val line: Color,
    val font: Font,
    val bold: Font,
) {
    fun color(role: Role): Color = when (role) {
        Role.Surface -> surface
        Role.Border -> border
        Role.Text -> text
        Role.Muted -> muted
        Role.Accent -> accent
        Role.Note -> note
        Role.Cluster -> cluster
        Role.Line -> line
    }
}
