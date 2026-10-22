package ai.kilocode.client.ui.diagram

/**
 * Deterministic text measurement for engine tests.
 *
 * Geometry snapshots must not depend on which fonts a machine or CI image happens to have, so tests
 * measure with fixed per-character widths instead of AWT metrics. [onCall] receives the running call
 * count and is used by the cancellation test to cancel mid-layout.
 */
internal class FakeMeasure(private val onCall: (Int) -> Unit = {}) : Measure {
    private var calls = 0

    override fun width(text: String, font: FontSpec): Double {
        calls++
        onCall(calls)
        val bold = if (font.bold) BOLD else 1.0
        return text.length * UNIT * bold
    }

    override fun height(font: FontSpec) = font.size * LINE

    override fun ascent(font: FontSpec) = font.size.toDouble()

    private companion object {
        const val UNIT = 7.0
        const val BOLD = 1.1
        const val LINE = 1.4
    }
}

internal fun spec(size: Int = 10) = Spec(FontSpec("Test", size))
