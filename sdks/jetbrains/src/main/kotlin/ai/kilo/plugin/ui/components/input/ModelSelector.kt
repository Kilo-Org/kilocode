package ai.kilo.plugin.ui.components.input

import ai.kilo.plugin.model.Model
import ai.kilo.plugin.model.ModelRef
import ai.kilo.plugin.model.Provider
import ai.kilo.plugin.model.ProviderListResponse
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.ui.KiloTheme
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.awt.Cursor
import java.awt.Font
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JLabel
import javax.swing.JMenuItem
import javax.swing.JPopupMenu

/**
 * Model selection component that displays the current model and allows changing it via popup menu.
 */
class ModelSelector(
    private val scope: CoroutineScope,
    private val appState: KiloAppState
) {

    private var selectedModel: Model? = null
    private var selectedProvider: Provider? = null
    private var providers: ProviderListResponse? = null

    val label = JBLabel("Model ▾").apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(13f)
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    init {
        label.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val popup = createModelPopup()
                popup.show(label, 0, -popup.preferredSize.height)
            }
            override fun mouseEntered(e: MouseEvent) {
                label.foreground = KiloTheme.textInteractive
            }
            override fun mouseExited(e: MouseEvent) {
                label.foreground = KiloTheme.textWeak
            }
        })

        subscribeToProviders()
    }

    private fun subscribeToProviders() {
        scope.launch {
            appState.providers.collectLatest { providerResponse ->
                providers = providerResponse
                if (selectedModel == null && providerResponse != null) {
                    selectDefaultModel(providerResponse)
                }
            }
        }
    }

    private fun selectDefaultModel(providerResponse: ProviderListResponse) {
        // Try to use default model from provider response
        val defaultProviderId = providerResponse.default["provider"]
        val defaultModelId = providerResponse.default["model"]

        if (defaultProviderId != null && defaultModelId != null) {
            val provider = providerResponse.all.find { it.id == defaultProviderId }
            val model = provider?.models?.get(defaultModelId)
            if (provider != null && model != null) {
                selectedProvider = provider
                selectedModel = model
                updateModelLabel()
                return
            }
        }

        // Fallback: use first connected provider's first model
        val connectedProvider = providerResponse.all
            .filter { it.id in providerResponse.connected }
            .firstOrNull { it.models.isNotEmpty() }

        if (connectedProvider != null) {
            selectedProvider = connectedProvider
            selectedModel = connectedProvider.models.values.firstOrNull()
            updateModelLabel()
        }
    }

    private fun updateModelLabel() {
        val modelName = selectedModel?.name ?: selectedModel?.id ?: "Model"
        label.text = "$modelName ▾"

        // Update appState with selection
        selectedProvider?.let { provider ->
            selectedModel?.let { model ->
                appState.setSelectedModel(ModelRef(providerID = provider.id, modelID = model.id))
            }
        }
    }

    private fun createModelPopup(): JPopupMenu {
        val providerResponse = providers
        val connectedProviders = providerResponse?.all?.filter { it.id in (providerResponse.connected) } ?: emptyList()

        return JPopupMenu().apply {
            add(JLabel("  Model").apply {
                font = font.deriveFont(Font.BOLD)
                border = JBUI.Borders.empty(8, 8, 4, 8)
            })
            addSeparator()

            if (connectedProviders.isEmpty()) {
                add(JLabel("  No providers connected").apply {
                    foreground = KiloTheme.textWeaker
                    border = JBUI.Borders.empty(4, 8)
                })
            } else {
                // Group models by provider
                for (provider in connectedProviders) {
                    if (provider.models.isEmpty()) continue

                    // Add provider header
                    add(JLabel("  ${provider.name}").apply {
                        font = font.deriveFont(Font.BOLD, 11f)
                        foreground = KiloTheme.textInteractive
                        border = JBUI.Borders.empty(4, 8, 2, 8)
                    })

                    // Add models for this provider
                    for ((_, model) in provider.models) {
                        val isSelected = selectedModel?.id == model.id && selectedProvider?.id == provider.id
                        add(createModelMenuItem(model, provider, isSelected))
                    }
                    addSeparator()
                }
            }
        }
    }

    private fun createModelMenuItem(model: Model, provider: Provider, isSelected: Boolean): JMenuItem {
        val displayName = model.name ?: model.id
        return JMenuItem(displayName).apply {
            if (isSelected) {
                icon = AllIcons.Actions.Checked
            }
            addActionListener {
                selectedModel = model
                selectedProvider = provider
                updateModelLabel()
            }
        }
    }
}
