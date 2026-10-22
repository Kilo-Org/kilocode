package ai.kilocode.client.session.history

import ai.kilocode.client.plugin.KiloBundle
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.abs

private const val SECOND_MS_LIMIT = 10_000_000_000L
private const val MINUTE = 60_000L
private const val HOUR = 60 * MINUTE
private const val DAY = 24 * HOUR

enum class HistorySection {
    TODAY,
    YESTERDAY,
    WEEK,
    MONTH,
    OLDER,
}

internal object HistoryTime {
    fun millis(item: HistoryItem): Long? {
        val raw = item.updatedAt.toDoubleOrNull()?.toLong() ?: return parse(item.updatedAt)
        if (abs(raw) < SECOND_MS_LIMIT) return raw * 1000
        return raw
    }

    fun section(item: HistoryItem, now: Long = System.currentTimeMillis()): HistorySection {
        val ms = millis(item) ?: return HistorySection.OLDER
        val zone = ZoneId.systemDefault()
        val date = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        if (date == today) return HistorySection.TODAY
        if (date == today.minusDays(1)) return HistorySection.YESTERDAY
        if (!date.isBefore(today.minusDays(7)) && date.isBefore(today)) return HistorySection.WEEK
        if (!date.isBefore(today.minusDays(30)) && date.isBefore(today)) return HistorySection.MONTH
        return HistorySection.OLDER
    }

    fun title(section: HistorySection): String = when (section) {
        HistorySection.TODAY -> KiloBundle.message("history.group.today")
        HistorySection.YESTERDAY -> KiloBundle.message("history.group.yesterday")
        HistorySection.WEEK -> KiloBundle.message("history.group.week")
        HistorySection.MONTH -> KiloBundle.message("history.group.month")
        HistorySection.OLDER -> KiloBundle.message("history.group.older")
    }

    fun relative(item: HistoryItem, now: Long = System.currentTimeMillis()): String {
        val ms = millis(item) ?: return item.updatedAt
        val diff = (now - ms).coerceAtLeast(0)
        if (diff < MINUTE) return KiloBundle.message("history.time.moments")
        if (diff < HOUR) return KiloBundle.message("history.time.minutes", (diff / MINUTE).coerceAtLeast(1))
        if (diff < DAY) return KiloBundle.message("history.time.hours", (diff / HOUR).coerceAtLeast(1))
        if (diff < 7 * DAY) return KiloBundle.message("history.time.days", (diff / DAY).coerceAtLeast(1))
        val date = LocalDate.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault())
        val today = LocalDate.ofInstant(Instant.ofEpochMilli(now), ZoneId.systemDefault())
        val months = ChronoUnit.MONTHS.between(date.withDayOfMonth(1), today.withDayOfMonth(1))
        if (months < 1) return KiloBundle.message("history.time.days", (diff / DAY).coerceAtLeast(1))
        if (months < 12) return KiloBundle.message("history.time.months", months)
        return KiloBundle.message("history.time.years", months / 12)
    }

    fun <T : HistoryItem> sorted(items: List<T>): List<T> = items.sortedWith(
        compareByDescending<T> { millis(it) ?: Long.MIN_VALUE }
            .thenBy { it.title.lowercase() }
            .thenBy { it.id },
    )

    private fun parse(value: String): Long? {
        val text = value.trim().replace(' ', 'T')
        val zoned = when {
            text.matches(Regex(".*[+-]\\d{2}$")) -> "$text:00"
            text.matches(Regex(".*[+-]\\d{4}$")) -> text.dropLast(2) + ":" + text.takeLast(2)
            else -> text
        }
        return runCatching { Instant.parse(zoned).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(zoned).toInstant().toEpochMilli() }.getOrNull()
    }
}
