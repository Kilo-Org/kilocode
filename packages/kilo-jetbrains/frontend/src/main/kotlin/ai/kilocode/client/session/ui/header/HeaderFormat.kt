package ai.kilocode.client.session.ui.header

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.ContextUsage
import com.intellij.ui.components.JBLabel

internal fun set(label: JBLabel, value: String?) {
    val text = value.orEmpty()
    if (label.text != text) label.text = text
    val show = text.isNotEmpty()
    if (label.isVisible != show) label.isVisible = show
}

internal fun money(value: Double?): String? {
    val cost = value ?: return null
    if (cost < 0.01) return "\$%.4f".format(cost)
    if (cost < 1.0) return "\$%.2f".format(cost)
    return "\$%.2f".format(cost)
}

internal fun contextText(value: ContextUsage?): String? {
    val ctx = value ?: return null
    val pct = ctx.percentage
    if (pct != null) return "$pct%"
    if (ctx.tokens > 0) return num(ctx.tokens)
    return null
}

internal fun contextTip(value: ContextUsage?): String? {
    val ctx = value ?: return null
    val pct = ctx.percentage
    if (pct != null) return KiloBundle.message("session.header.context.tooltip.percent", num(ctx.tokens), pct)
    if (ctx.tokens > 0) return KiloBundle.message("session.header.context.tooltip.tokens", num(ctx.tokens))
    return null
}

internal fun todo(done: Int, total: Int): String? {
    if (total <= 0) return null
    if (done >= total) return KiloBundle.message("session.header.todos.done", total)
    return KiloBundle.message("session.header.todos.progress", done, total)
}

internal fun num(value: Long): String {
    val abs = kotlin.math.abs(value)
    if (abs < 1_000) return value.toString()
    if (abs < 1_000_000) return "%.1fK".format(value / 1_000.0)
    return "%.1fM".format(value / 1_000_000.0)
}
