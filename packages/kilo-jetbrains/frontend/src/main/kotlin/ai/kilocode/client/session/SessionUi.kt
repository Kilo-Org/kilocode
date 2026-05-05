package ai.kilocode.client.session

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.SessionModelEvent
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.ConnectionPanel
import ai.kilocode.client.session.ui.EmptySessionPanel
import ai.kilocode.client.session.ui.ReasoningPicker
import ai.kilocode.client.session.ui.mode.ModePicker
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.session.ui.PermissionPanel
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.QuestionPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.SessionMessageListPanel
import ai.kilocode.client.session.ui.SessionStyle
import ai.kilocode.client.session.ui.SessionStyleTarget
import ai.kilocode.client.session.update.EVENT_FLUSH_MS
import ai.kilocode.client.session.update.SessionController
import ai.kilocode.client.session.update.SessionControllerEvent
import ai.kilocode.rpc.dto.SessionDto
import ai.kilocode.log.ChatLogSummary
import ai.kilocode.log.KiloLog
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.colors.EditorColorsListener
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.registry.Registry
import com.intellij.ui.icons.CachedImageIcon
import com.intellij.ui.svg.SvgAttributePatcher
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.SVGLoader
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Rectangle
import javax.swing.BoxLayout
import javax.swing.BoxLayout.Y_AXIS
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Top-level session UI composition root.
 *
 * It builds the session panels, wires controller/model listeners, and swaps the
 * center body between the empty state and the message list.
 */
class SessionUi private constructor(
    project: Project,
    workspace: Workspace,
    sessions: KiloSessionService,
    app: KiloAppService,
    cs: CoroutineScope,
    id: String?,
    displayMs: Long,
    open: (SessionDto) -> Unit,
    private val loading: Boolean,
) : JPanel(BorderLayout()), Disposable, SessionStyleTarget {

    constructor(
        project: Project,
        workspace: Workspace,
        sessions: KiloSessionService,
        app: KiloAppService,
        cs: CoroutineScope,
        id: String? = null,
        displayMs: Long = SessionController.DISPLAY_DELAY_MS,
        open: (SessionDto) -> Unit = {},
    ) : this(project, workspace, sessions, app, cs, id, displayMs, open, id == null)

    internal constructor(
        project: Project,
        workspace: Workspace,
        sessions: KiloSessionService,
        app: KiloAppService,
        cs: CoroutineScope,
        id: String? = null,
        displayMs: Long = SessionController.DISPLAY_DELAY_MS,
        loading: Boolean,
        open: (SessionDto) -> Unit = {},
    ) : this(project, workspace, sessions, app, cs, id, displayMs, open, loading)

    companion object {
        private val LOG = KiloLog.create(SessionUi::class.java)
        private val SCROLL_ICON = IconLoader.getIcon("/icons/scroll-bottom.svg", SessionUi::class.java)
    }

    private val project = project
    private val app = app
    private val flushMs =
        Registry.intValue("kilo.session.flushMs", EVENT_FLUSH_MS.toInt())
            .takeIf { it > 0 }
            ?.toLong()
            ?: EVENT_FLUSH_MS

    private val controller = SessionController(
        this, id, sessions, workspace, app, cs, this,
        flushMs = flushMs,
        condense = Registry.`is`("kilo.session.condense", true),
        displayMs = displayMs,
        open = open,
        beforeUpdate = ::atBottom,
        afterUpdate = ::followBottom,
    )


    private lateinit var root: SessionRootPanel

    private lateinit var sessionContent: JPanel

    private lateinit var blankBody: JPanel

    private lateinit var progressBody: JPanel

    private lateinit var messageBody: SessionMessageListPanel

    private lateinit var scroll: JBScrollPane

    private lateinit var jump: JButton

    private lateinit var question: QuestionPanel
    private lateinit var permission: PermissionPanel
    private lateinit var connection: ConnectionPanel

    private lateinit var prompt: PromptPanel
    private lateinit var loadingLabel: JBLabel
    private var style = SessionStyle.current()

    init {
        buildUi()
        bindUi()
        bindStyle()
        applyStyle(style)
        showBody(if (loading) progressBody else blankBody)
    }

    internal val blank: Boolean get() = controller.blank

    internal val id: String? get() = controller.id

    internal fun currentStyle() = style

    val defaultFocusedComponent: JComponent get() = prompt.defaultFocusedComponent

    private fun buildUi() {
        root = SessionRootPanel()

        sessionContent = JPanel(BorderLayout())

        blankBody = JPanel(BorderLayout()).apply {
            isOpaque = false
        }

        progressBody = JPanel(BorderLayout()).apply {
            isOpaque = false
            loadingLabel = JBLabel(KiloBundle.message("session.empty.loading"))
            add(Centerizer(
                loadingLabel,
                Centerizer.TYPE.BOTH,
            ), BorderLayout.CENTER)
        }
        messageBody = SessionMessageListPanel(controller.model, this)

        scroll = JBScrollPane(blankBody).apply {
            border = JBUI.Borders.empty()
            verticalScrollBarPolicy = JBScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
            horizontalScrollBarPolicy = JBScrollPane.HORIZONTAL_SCROLLBAR_NEVER
        }
        jump = JButton(patchedIcon(SCROLL_ICON)).apply {
            border = JBUI.Borders.empty()
            isContentAreaFilled = false
            isBorderPainted = false
            isFocusPainted = false
            isFocusable = false
            isOpaque = false
            toolTipText = KiloBundle.message("session.scroll.bottom")
            isVisible = false
            addActionListener { jumpBottom() }
        }
        question = QuestionPanel(controller)
        permission = PermissionPanel(controller)
        connection = ConnectionPanel(this, controller)

        prompt = PromptPanel(
            project = project,
            onSend = { text -> sendPrompt(text) },
            onAbort = { controller.abort() },
        )

        sessionContent.add(scroll, BorderLayout.CENTER)
        root.content.add(sessionContent, BorderLayout.CENTER)
        // Dock panels stay in normal flow so each visible state takes layout space
        // above the prompt.
        root.content.add(JPanel().apply {
            this.layout = BoxLayout(this, Y_AXIS)
            add(question)
            add(permission)
            add(connection)
            add(prompt)
        }, BorderLayout.SOUTH)
        root.addOverlay(jump) { _, child ->
            val size = child.preferredSize
            val gap = JBUI.scale(12)
            Rectangle(
                sessionContent.x + sessionContent.width - size.width - gap,
                sessionContent.y + sessionContent.height - size.height - gap,
                size.width,
                size.height,
            )
        }

        add(root, BorderLayout.CENTER)
    }

    private fun bindUi() {
        prompt.mode.onSelect = { item -> controller.selectAgent(item.id) }
        prompt.model.onSelect = { item -> controller.selectModel(item.provider, item.id) }
        prompt.reasoning.onSelect = { item -> controller.selectVariant(item.id) }
        prompt.onReset = { controller.clearModelOverride() }
        prompt.model.favorites = { app.favorites.value }
        prompt.model.onFavoriteToggle = { item -> app.toggleModelFavorite(item.provider, item.id) }
        scroll.verticalScrollBar.addAdjustmentListener { updateJump() }

        controller.addListener(this) { event ->
            when (event) {
                is SessionControllerEvent.WorkspaceReady -> {
                    val m = controller.model
                    prompt.mode.setItems(m.agents.map {
                        ModePicker.Item(
                            it.name,
                            it.display,
                            it.description,
                            it.deprecated,
                        )
                    }, m.agent)
                    val items = m.models.map {
                        ModelPicker.Item(
                            it.id,
                            it.display,
                            it.provider,
                            it.providerName,
                            it.recommendedIndex,
                            it.free,
                            it.variants,
                        )
                    }
                    val selected =
                        m.model?.let { full -> items.firstOrNull { it.key == full }?.key }
                    prompt.model.setItems(items, selected)
                    prompt.reasoning.setItems(m.variants.map { ReasoningPicker.Item(it, variantTitle(it)) }, m.variant)
                    prompt.setResetVisible(m.modelOverride)
                    prompt.setReady(m.isReady())
                }

                is SessionControllerEvent.ViewChanged.ShowProgress -> {
                    showBody(progressBody)
                }

                is SessionControllerEvent.ViewChanged.ShowRecents -> {
                    val panel = EmptySessionPanel(this, controller, event.recents)
                    showBody(panel)
                }

                is SessionControllerEvent.ViewChanged.ShowSession -> {
                    showBody(messageBody)
                }

                is SessionControllerEvent.AppChanged,
                is SessionControllerEvent.WorkspaceChanged -> {
                    prompt.setReady(controller.model.isReady())
                }

                is SessionControllerEvent.ConnectionChanged -> Unit
            }
        }

        controller.model.addListener(this) { event ->
            when (event) {
                is SessionModelEvent.StateChanged -> onStateChanged(event.state)

                is SessionModelEvent.TurnAdded,
                is SessionModelEvent.TurnUpdated,
                is SessionModelEvent.ContentAdded,
                is SessionModelEvent.ContentDelta,
                is SessionModelEvent.HistoryLoaded,
                is SessionModelEvent.TurnRemoved,
                is SessionModelEvent.MessageAdded,
                is SessionModelEvent.MessageUpdated,
                is SessionModelEvent.MessageRemoved,
                is SessionModelEvent.ContentUpdated,
                is SessionModelEvent.ContentRemoved,
                is SessionModelEvent.DiffUpdated,
                is SessionModelEvent.TodosUpdated,
                is SessionModelEvent.Compacted,
                is SessionModelEvent.Cleared -> Unit
            }
        }
    }

    private fun bindStyle() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(EditorColorsManager.TOPIC, EditorColorsListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionStyle.current())
            }
        })
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                applyStyle(SessionStyle.current())
            }
        })
    }

    private fun sendPrompt(text: String) {
        if (text.isBlank()) return
        LOG.debug {
            "${ChatLogSummary.prompt(text)} agent=${controller.model.agent ?: "none"} model=${controller.model.model ?: "none"} ready=${controller.ready}"
        }
        controller.prompt(text)
        prompt.clear()
    }

    private fun onStateChanged(state: SessionState) {
        prompt.setBusy(state.isBusy())
        when (state) {
            is SessionState.AwaitingQuestion -> {
                permission.hidePanel()
                question.show(state.question)
            }

            is SessionState.AwaitingPermission -> {
                question.hidePanel()
                permission.show(state.permission)
            }

            else -> {
                question.hidePanel()
                permission.hidePanel()
            }
        }
        refresh()
    }

    internal fun atBottom(): Boolean {
        val bar = scroll.verticalScrollBar
        if (bar.maximum <= bar.visibleAmount) return true
        return bar.value + bar.visibleAmount >= bar.maximum - JBUI.scale(32)
    }

    internal fun followBottom(follow: Boolean) {
        if (!follow) return
        showBody(messageBody)
        scrollToBottom()
        updateJump()
        ApplicationManager.getApplication().invokeLater {
            scroll.viewport.view?.revalidate()
            scroll.viewport.view?.doLayout()
            scroll.revalidate()
            scroll.doLayout()
            scrollToBottom()
            updateJump()
        }
    }

    private fun jumpBottom() {
        showBody(messageBody)
        scrollToBottom()
        updateJump()
        ApplicationManager.getApplication().invokeLater {
            scroll.viewport.view?.revalidate()
            scroll.viewport.view?.doLayout()
            scroll.revalidate()
            scroll.doLayout()
            scrollToBottom()
            updateJump()
        }
    }

    private fun scrollToBottom() {
        val bar = scroll.verticalScrollBar
        bar.value = bar.maximum
    }

    private fun updateJump() {
        val visible = scroll.viewport.view === messageBody && !atBottom()
        if (jump.isVisible == visible) return
        jump.isVisible = visible
        root.overlay.revalidate()
        root.overlay.repaint()
    }

    private fun refresh() {
        updateJump()
        root.revalidate()
        root.repaint()
    }

    private fun showBody(panel: JPanel) {
        if (scroll.viewport.view === panel) return
        (panel as? SessionStyleTarget)?.applyStyle(style)
        scroll.viewport.setView(panel)
        scroll.revalidate()
        scroll.repaint()
        updateJump()
    }

    override fun applyStyle(style: SessionStyle) {
        this.style = style
        jump.icon = patchedIcon(SCROLL_ICON)
        loadingLabel.font = style.uiFont
        messageBody.applyStyle(style)
        prompt.applyStyle(style)
        (scroll.viewport.view as? SessionStyleTarget)?.applyStyle(style)
        refresh()
    }

    override fun dispose() {}
}

private fun patchedIcon(icon: Icon): Icon {
    val cached = icon as? CachedImageIcon ?: return icon
    return cached.createWithPatcher(object : SVGLoader.SvgElementColorPatcherProvider, SvgAttributePatcher {
        override fun digest(): LongArray {
            val bg = JBUI.CurrentTheme.Button.defaultButtonColorStart().rgb.toLong()
            val fg = JBUI.CurrentTheme.Button.defaultButtonForeground().rgb.toLong()
            return longArrayOf(bg, fg, 0x5c011b0bb17L)
        }

        override fun attributeForPath(path: String) = this

        override fun patchColors(attributes: MutableMap<String, String>) {
            when (attributes["id"]) {
                "ScrollButton.Background" -> set(attributes, "fill", JBUI.CurrentTheme.Button.defaultButtonColorStart())
                "ScrollButton.Foreground" -> set(attributes, "stroke", JBUI.CurrentTheme.Button.defaultButtonForeground())
            }
        }

        private fun set(attributes: MutableMap<String, String>, key: String, color: Color) {
            if (!attributes.containsKey(key) || attributes[key] == "none") return
            attributes[key] = "rgb(${color.red},${color.green},${color.blue})"
            if (color.alpha != 255) attributes["$key-opacity"] = "${color.alpha / 255f}"
        }
    })
}

private fun variantTitle(value: String): String = value.replaceFirstChar { it.titlecase() }
