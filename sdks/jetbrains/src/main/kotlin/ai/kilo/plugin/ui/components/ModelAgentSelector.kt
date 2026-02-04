package ai.kilo.plugin.ui.components

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.KiloAppState
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTypography
import com.intellij.icons.AllIcons
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.*

/**
 * Model and Agent selection panel displayed above the prompt input.
 * Shows current selection as clickable labels: [Agent] [Model] [Provider]
 */
class ModelAgentSelector(
    private val appState: KiloAppState,
    private val onSelectionChanged: (ModelAgentSelector) -> Unit = {}
) : JPanel(FlowLayout(FlowLayout.LEFT, 4, 2)) {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val agentLabel = createClickableLabel("Agent")
    private val modelLabel = createClickableLabel("Model")
    private val providerLabel = JBLabel().apply {
        foreground = KiloTheme.textWeak
        font = font.deriveFont(KiloTypography.fontSizeXSmall)
    }

    // Current selections
    private var selectedAgent: Agent? = null
    private var selectedModel: Model? = null
    private var selectedProvider: Provider? = null

    // Available options
    private var agents: List<Agent> = emptyList()
    private var providers: ProviderListResponse? = null

    init {
        isOpaque = false
        border = JBUI.Borders.empty(KiloSpacing.xxs, KiloSpacing.md)

        add(agentLabel)
        add(JBLabel("·").apply { foreground = KiloTheme.textWeaker })
        add(modelLabel)
        add(providerLabel)

        // Setup click handlers
        agentLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showAgentPopup()
            }
        })

        modelLabel.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                showModelPopup()
            }
        })

        // Subscribe to state
        subscribeToState()
    }

    private fun createClickableLabel(text: String): JBLabel {
        return JBLabel(text).apply {
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            font = font.deriveFont(KiloTypography.fontSizeXSmall)
            foreground = KiloTheme.textInteractive
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    foreground = KiloTheme.iconInteractive // Brighter on hover
                }
                override fun mouseExited(e: MouseEvent) {
                    foreground = KiloTheme.textInteractive
                }
            })
        }
    }

    private fun subscribeToState() {
        scope.launch {
            combine(
                appState.agents,
                appState.providers
            ) { agentList, providerResponse ->
                Pair(agentList, providerResponse)
            }.collectLatest { (agentList, providerResponse) ->
                agents = agentList.filter { it.hidden != true }
                providers = providerResponse

                // Set defaults if not selected
                if (selectedAgent == null && agents.isNotEmpty()) {
                    selectedAgent = agents.firstOrNull { it.name == "code" } ?: agents.first()
                    updateLabels()
                }

                if (selectedModel == null && providerResponse != null) {
                    selectDefaultModel(providerResponse)
                }
            }
        }
    }

    private fun selectDefaultModel(providerResponse: ProviderListResponse) {
        // Try to use default model from provider response
        val defaultProvider = providerResponse.default["provider"]
        val defaultModel = providerResponse.default["model"]

        if (defaultProvider != null && defaultModel != null) {
            val provider = providerResponse.all.find { it.id == defaultProvider }
            val model = provider?.models?.get(defaultModel)
            if (provider != null && model != null) {
                selectedProvider = provider
                selectedModel = model
                updateLabels()
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
            updateLabels()
        }
    }

    private fun updateLabels() {
        agentLabel.text = selectedAgent?.name?.replaceFirstChar { it.uppercase() } ?: "Agent"
        modelLabel.text = selectedModel?.name ?: selectedModel?.id ?: "Model"
        providerLabel.text = selectedProvider?.name ?: ""
    }

    private fun showAgentPopup() {
        if (agents.isEmpty()) return

        // Create searchable popup similar to model popup
        val panel = JPanel(BorderLayout()).apply {
            background = KiloTheme.backgroundStronger
        }
        val searchField = JBTextField().apply {
            emptyText.text = "Search agents..."
            border = JBUI.Borders.empty(KiloSpacing.xs)
            background = KiloTheme.surfaceInsetBase
        }

        val listModel = DefaultListModel<Agent>()
        agents.forEach { listModel.addElement(it) }

        val list = JBList(listModel)
        list.cellRenderer = AgentCellRenderer(selectedAgent)
        list.selectionMode = ListSelectionModel.SINGLE_SELECTION

        // Pre-select current agent
        selectedAgent?.let { current ->
            val index = agents.indexOfFirst { it.name == current.name }
            if (index >= 0) list.selectedIndex = index
        }

        // Filter on search
        searchField.addKeyListener(object : KeyAdapter() {
            override fun keyReleased(e: KeyEvent) {
                val query = searchField.text.lowercase()
                listModel.clear()
                agents
                    .filter { agent ->
                        query.isEmpty() ||
                        agent.name.lowercase().contains(query) ||
                        agent.description?.lowercase()?.contains(query) == true
                    }
                    .forEach { listModel.addElement(it) }
            }
        })

        panel.add(searchField, BorderLayout.NORTH)
        panel.add(JScrollPane(list), BorderLayout.CENTER)
        panel.preferredSize = JBUI.size(250, 300)

        var popup: JBPopup? = null
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 1) {
                    val agent = list.selectedValue
                    if (agent != null) {
                        selectedAgent = agent
                        updateLabels()
                        onSelectionChanged(this@ModelAgentSelector)
                        popup?.cancel()
                    }
                }
            }
        })

        // Handle enter key
        list.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER) {
                    val agent = list.selectedValue
                    if (agent != null) {
                        selectedAgent = agent
                        updateLabels()
                        onSelectionChanged(this@ModelAgentSelector)
                        popup?.cancel()
                    }
                }
            }
        })

        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, searchField)
            .setTitle("Select Agent")
            .setFocusable(true)
            .setRequestFocus(true)
            .setResizable(true)
            .setMovable(true)
            .createPopup()

        popup.showUnderneathOf(agentLabel)
    }

    private fun showModelPopup() {
        val providerResponse = providers ?: return
        val connectedProviders = providerResponse.all.filter { it.id in providerResponse.connected }
        if (connectedProviders.isEmpty()) return

        // Build flat list of models with provider info
        val modelItems = mutableListOf<ModelItem>()
        for (provider in connectedProviders) {
            for ((_, model) in provider.models) {
                modelItems.add(ModelItem(model, provider))
            }
        }

        if (modelItems.isEmpty()) return

        // Create searchable popup
        val panel = JPanel(BorderLayout()).apply {
            background = KiloTheme.backgroundStronger
        }
        val searchField = JBTextField().apply {
            emptyText.text = "Search models..."
            border = JBUI.Borders.empty(KiloSpacing.xs)
            background = KiloTheme.surfaceInsetBase
        }

        val listModel = DefaultListModel<ModelItem>()
        modelItems.forEach { listModel.addElement(it) }

        val list = JBList(listModel)
        list.cellRenderer = ModelCellRenderer(selectedModel)
        list.selectionMode = ListSelectionModel.SINGLE_SELECTION

        // Pre-select current model
        selectedModel?.let { current ->
            val index = modelItems.indexOfFirst { it.model.id == current.id }
            if (index >= 0) list.selectedIndex = index
        }

        // Filter on search
        searchField.addKeyListener(object : KeyAdapter() {
            override fun keyReleased(e: KeyEvent) {
                val query = searchField.text.lowercase()
                listModel.clear()
                modelItems
                    .filter { item ->
                        query.isEmpty() ||
                        item.model.id.lowercase().contains(query) ||
                        item.model.name?.lowercase()?.contains(query) == true ||
                        item.provider.name.lowercase().contains(query)
                    }
                    .forEach { listModel.addElement(it) }
            }
        })

        panel.add(searchField, BorderLayout.NORTH)
        panel.add(JScrollPane(list), BorderLayout.CENTER)
        panel.preferredSize = JBUI.size(300, 400)

        var popup: JBPopup? = null
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 1) {
                    val item = list.selectedValue
                    if (item != null) {
                        selectedModel = item.model
                        selectedProvider = item.provider
                        updateLabels()
                        onSelectionChanged(this@ModelAgentSelector)
                        popup?.cancel()
                    }
                }
            }
        })

        // Handle enter key
        list.addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode == KeyEvent.VK_ENTER) {
                    val item = list.selectedValue
                    if (item != null) {
                        selectedModel = item.model
                        selectedProvider = item.provider
                        updateLabels()
                        onSelectionChanged(this@ModelAgentSelector)
                        popup?.cancel()
                    }
                }
            }
        })

        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, searchField)
            .setTitle("Select Model")
            .setFocusable(true)
            .setRequestFocus(true)
            .setResizable(true)
            .setMovable(true)
            .createPopup()

        popup.showUnderneathOf(modelLabel)
    }

    /**
     * Get the currently selected model reference for API calls.
     */
    fun getSelectedModelRef(): ModelRef? {
        val provider = selectedProvider ?: return null
        val model = selectedModel ?: return null
        return ModelRef(providerID = provider.id, modelID = model.id)
    }

    /**
     * Get the currently selected agent name for API calls.
     */
    fun getSelectedAgentName(): String? {
        return selectedAgent?.name
    }

    fun dispose() {
        scope.cancel()
    }

    /**
     * Data class to hold model with its provider info.
     */
    private data class ModelItem(
        val model: Model,
        val provider: Provider
    )

    /**
     * Cell renderer for agent list.
     */
    private class AgentCellRenderer(
        private val selected: Agent?
    ) : ColoredListCellRenderer<Agent>() {
        override fun customizeCellRenderer(
            list: JList<out Agent>,
            value: Agent,
            index: Int,
            isSelected: Boolean,
            hasFocus: Boolean
        ) {
            val isCurrentlySelected = selected?.name == value.name
            icon = if (isCurrentlySelected) AllIcons.Actions.Checked else AllIcons.General.User

            append(value.name.replaceFirstChar { it.uppercase() })
            value.description?.let { desc ->
                append(" - $desc", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
        }
    }

    /**
     * Cell renderer for model list.
     */
    private class ModelCellRenderer(
        private val selected: Model?
    ) : ColoredListCellRenderer<ModelItem>() {
        override fun customizeCellRenderer(
            list: JList<out ModelItem>,
            value: ModelItem,
            index: Int,
            isSelected: Boolean,
            hasFocus: Boolean
        ) {
            val isCurrentlySelected = selected?.id == value.model.id
            icon = if (isCurrentlySelected) AllIcons.Actions.Checked else AllIcons.Nodes.Plugin

            append(value.model.name ?: value.model.id)
            append(" ", SimpleTextAttributes.REGULAR_ATTRIBUTES)
            append(value.provider.name, SimpleTextAttributes.GRAYED_ATTRIBUTES)

            // Show capabilities
            val capabilities = mutableListOf<String>()
            if (value.model.capabilities?.reasoning == true) capabilities.add("reasoning")
            if (value.model.capabilities?.attachment == true) capabilities.add("files")
            if (capabilities.isNotEmpty()) {
                append(" [${capabilities.joinToString(", ")}]", SimpleTextAttributes.GRAYED_SMALL_ATTRIBUTES)
            }
        }
    }
}
