package ai.kilocode.client.settings.providers

import ai.kilocode.rpc.dto.ProviderAuthMethodDto
import ai.kilocode.rpc.dto.ProviderSettingsDto
import ai.kilocode.rpc.dto.ProviderSettingsProviderDto
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Graphics
import java.awt.Graphics2D
import java.util.concurrent.ConcurrentHashMap
import javax.swing.Icon
import kotlin.math.min
import kotlin.math.roundToInt

internal const val KILO_PROVIDER_ID = "kilo"
internal const val CUSTOM_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible"

private val popularIds = listOf(
    KILO_PROVIDER_ID,
    "anthropic",
    "deepseek",
    "openai",
    "google",
    "openrouter",
    "vercel",
)
private val popularIndex = popularIds.withIndex().associate { it.value to it.index }

internal fun isPopularProvider(provider: ProviderSettingsProviderDto) =
    provider.metadata?.priority != null || provider.id in popularIndex

internal fun popularProviderIndex(provider: ProviderSettingsProviderDto): Int =
    provider.metadata?.priority ?: popularIndex[provider.id] ?: Int.MAX_VALUE

internal fun providerDescription(provider: ProviderSettingsProviderDto): String {
    provider.description?.takeIf { it.isNotBlank() }?.let { return it }
    provider.metadata?.noteKey?.let { key -> KiloBundle.optional(key)?.let { return it } }
    return ""
}

internal fun providerIcon(provider: ProviderSettingsProviderDto): Icon {
    val id = provider.metadata?.icon ?: provider.id
    return ProviderIcons.icon(id)
}

private object ProviderIcons {
    private val cache = ConcurrentHashMap<String, Icon>()

    fun icon(id: String): Icon = cache.computeIfAbsent(id) { key ->
        val icon = IconLoader.findIcon("/icons/providers/$key.svg", ProviderIcons::class.java)
        FixedProviderIcon(icon ?: IconLoader.findIcon("/icons/providers/synthetic.svg", ProviderIcons::class.java) ?: AllIcons.Nodes.Plugin)
    }
}

private class FixedProviderIcon(private val icon: Icon) : Icon {
    override fun getIconWidth() = JBUI.scale(20)

    override fun getIconHeight() = JBUI.scale(20)

    override fun paintIcon(c: Component?, g: Graphics, x: Int, y: Int) {
        val width = icon.iconWidth.coerceAtLeast(1)
        val height = icon.iconHeight.coerceAtLeast(1)
        val size = min(iconWidth.toDouble() / width, iconHeight.toDouble() / height)
        val w = (width * size).roundToInt().coerceAtLeast(1)
        val h = (height * size).roundToInt().coerceAtLeast(1)
        val copy = g.create() as Graphics2D
        try {
            copy.translate(x + (iconWidth - w) / 2, y + (iconHeight - h) / 2)
            copy.scale(size, size)
            icon.paintIcon(c, copy, 0, 0)
        } finally {
            copy.dispose()
        }
    }
}

internal fun providerMethods(provider: ProviderSettingsProviderDto, state: ProviderSettingsDto): List<ProviderAuthMethodDto> {
    val methods = state.auth[provider.id]
    if (!methods.isNullOrEmpty()) return methods
    return listOf(ProviderAuthMethodDto("api", "API key"))
}

internal fun providerOAuthMethodIndex(methods: List<ProviderAuthMethodDto>): String? {
    val indexed = methods.withIndex().filter { it.value.type == "oauth" }
    if (indexed.isEmpty()) return null
    val remote = indexed.firstOrNull { entry ->
        val label = entry.value.label.lowercase()
        listOf("headless", "remote", "device", "vps").any { label.contains(it) }
    }
    return (remote ?: indexed.first()).index.toString()
}

internal fun hiddenProvider(provider: ProviderSettingsProviderDto) = provider.id == "openai-compatible"

internal fun configured(provider: ProviderSettingsProviderDto, state: ProviderSettingsDto, ids: Set<String>) =
    provider.id in ids || provider.key != null || provider.source == "config" || provider.id in state.config

internal fun customEditable(provider: ProviderSettingsProviderDto, state: ProviderSettingsDto) =
    state.config[provider.id]?.npm == CUSTOM_PROVIDER_PACKAGE
