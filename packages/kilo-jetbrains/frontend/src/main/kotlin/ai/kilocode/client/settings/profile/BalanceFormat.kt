package ai.kilocode.client.settings.profile

import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

private val SYMBOLS = DecimalFormatSymbols(Locale.US)
private val FMT = DecimalFormat("\$#,##0.00", SYMBOLS)
private val SHORT = DecimalFormat("\$#,##0", SYMBOLS).apply { roundingMode = RoundingMode.HALF_UP }
private val DATE = DateTimeFormatter.ofPattern("MMM d", Locale.US).withZone(ZoneOffset.UTC)

/** Format a USD balance value for display (e.g. `$1,234.56`). */
internal fun formatBalance(value: Double): String = FMT.format(value)

internal fun formatShortBalance(value: Double): String = SHORT.format(value)

internal fun formatResetDate(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching { DATE.format(Instant.parse(iso)) }.getOrNull()
}
