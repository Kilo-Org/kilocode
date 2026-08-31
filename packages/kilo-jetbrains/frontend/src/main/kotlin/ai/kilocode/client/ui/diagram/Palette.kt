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
    /** Categorical series colors for charts; falls back to [accent] when empty. */
    val tones: List<Color> = emptyList(),
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

    fun tone(idx: Int): Color {
        if (tones.isEmpty()) return accent
        return tones[Math.floorMod(idx, tones.size)]
    }
}
