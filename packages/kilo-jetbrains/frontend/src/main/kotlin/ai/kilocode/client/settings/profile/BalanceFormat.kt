package ai.kilocode.client.settings.profile

import java.text.DecimalFormat

private val FMT = DecimalFormat("\$#,##0.00")

/** Format a USD balance value for display (e.g. `$1,234.56`). */
internal fun formatBalance(value: Double): String = FMT.format(value)
