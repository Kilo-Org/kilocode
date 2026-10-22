package ai.kilocode.client.ui.diagram

/**
 * Text measurement capability used by in-process engines.
 *
 * Implementations must be deterministic for a given [FontSpec]. Tests use a fake implementation
 * so geometry snapshots do not depend on system fonts or CI image contents.
 */
internal interface Measure {
    fun width(text: String, font: FontSpec): Double
    fun height(font: FontSpec): Double
    fun ascent(font: FontSpec): Double
}
