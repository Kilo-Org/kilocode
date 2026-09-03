package ai.kilocode.client.ui.diagram.mermaid

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/** Nice-number axis ticks shared by the chart engines. */
internal object Axis {
    /** Tick positions covering `[min, max]` at a 1/2/5 step; always at least two ticks. */
    fun ticks(min: Double, max: Double, want: Int = 5): List<Double> {
        if (max <= min) return listOf(min, min + 1)
        val raw = (max - min) / want.coerceAtLeast(1)
        val mag = 10.0.pow(floor(log10(raw)))
        val norm = raw / mag
        val step = mag * when {
            norm <= 1.0 -> 1.0
            norm <= 2.0 -> 2.0
            norm <= 5.0 -> 5.0
            else -> 10.0
        }
        val out = mutableListOf<Double>()
        var tick = floor(min / step) * step
        val last = ceil(max / step) * step
        while (tick <= last + step / 2) {
            out.add(tick)
            tick += step
        }
        return out
    }

    /** Formats a tick without a trailing `.0` and without float noise. */
    fun label(value: Double): String {
        val whole = Math.round(value)
        if (abs(value - whole) < 1e-9) return whole.toString()
        return "%.2f".format(value).trimEnd('0').trimEnd('.')
    }
}
