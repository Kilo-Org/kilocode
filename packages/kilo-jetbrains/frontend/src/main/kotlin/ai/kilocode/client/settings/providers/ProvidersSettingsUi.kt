package ai.kilocode.client.settings.providers

import ai.kilocode.client.app.KiloProviderService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsPanel
import ai.kilocode.client.settings.base.SettingsListConfig
import ai.kilocode.client.settings.base.SettingsToolbarAction
import ai.kilocode.client.settings.base.SettingsListView
import ai.kilocode.client.settings.auth.DeviceOAuthInfo
import ai.kilocode.client.settings.auth.DeviceOAuthPanel
import ai.kilocode.client.settings.auth.DeviceOAuthText
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.CustomModelDto
import ai.kilocode.rpc.dto.CustomProviderSaveDto
import ai.kilocode.rpc.dto.ProviderAuthMethodDto
import ai.kilocode.rpc.dto.ProviderAuthOptionDto
import ai.kilocode.rpc.dto.ProviderConnectDto
import ai.kilocode.rpc.dto.ProviderDisconnectDto
import ai.kilocode.rpc.dto.ProviderEnableDto
import ai.kilocode.rpc.dto.ProviderOAuthAuthorizeDto
import ai.kilocode.rpc.dto.ProviderOAuthCallbackDto
import ai.kilocode.rpc.dto.ProviderSettingsDto
import ai.kilocode.rpc.dto.ProviderSettingsProviderDto
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.CommonShortcuts
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.CollectionListModel
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.DefaultListCellRenderer
import javax.swing.JList
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.event.DocumentEvent
import javax.swing.Timer

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

private val OAUTH_CODE_RE = Regex("""code:\s*(\S+)""", RegexOption.IGNORE_CASE)

private fun oauthCode(text: String?): String? = text?.let { OAUTH_CODE_RE.find(it)?.groupValues?.getOrNull(1) }

internal class ProvidersSettingsUi(
    private val cs: CoroutineScope,
    private val directory: String,
) : SettingsPanel(), Disposable {
    companion object {
        val LOG = KiloLog.create(ProvidersSettingsUi::class.java)
    }

    private val add = SettingsToolbarAction(
        KiloBundle.message("settings.providers.addCustom"),
        KiloBundle.message("settings.providers.addCustom.description"),
        AllIcons.General.Add,
        { !busy },
    ) { custom() }
    private val refresh = SettingsToolbarAction(
        KiloBundle.message("settings.providers.refresh"),
        KiloBundle.message("settings.providers.refresh.description"),
        AllIcons.Actions.Refresh,
        { !busy },
    ) { reload() }
    private val view = ProvidersContent(::connect, ::oauth, ::disconnect, ::enable)
    private val search = SearchTextField(false).apply {
        textEditor.emptyText.text = KiloBundle.message("settings.providers.search")
    }
    private var state = ProviderSettingsDto()
    private var job: Job? = null
    private var request = 0
    private var disposed = false
    private var busy = false
    private var timer: Timer? = null
    private var oauth: DeviceOAuthPanel? = null

    init {
        content.add(header(), BorderLayout.NORTH)
        setContent(view)
        reload()
    }

    @RequiresEdt
    fun reload() {
        checkEdt()
        LOG.info("provider settings ui reload: start dir=$directory")
        if (!launch("reload") { id ->
            val next = service<KiloProviderService>().state(directory)
            LOG.info("provider settings ui reload: state providers=${next.providers.size} errors=${next.errors.size}")
            apply(id, next, null)
        }) return
        syncLoading()
    }

    @RequiresEdt
    private fun syncLoading() {
        checkEdt()
        showProgress(KiloBundle.message("settings.providers.loading"))
    }

    @RequiresEdt
    private fun connect(provider: ProviderSettingsProviderDto) {
        checkEdt()
        val methods = state.auth[provider.id].orEmpty().filter { it.type == "api" }
        val dialog = ApiKeyDialog(provider.name, methods.firstOrNull())
        if (!dialog.showAndGet()) return
        val key = dialog.key()
        val metadata = dialog.metadata()
        if (!launch("connect provider=${provider.id}") { id ->
            val result = service<KiloProviderService>().connect(ProviderConnectDto(directory, provider.id, key, metadata))
            apply(id, result.state, result.error)
        }) return
        syncLoading()
    }

    @RequiresEdt
    private fun oauth(provider: ProviderSettingsProviderDto) {
        checkEdt()
        val method = providerOAuthMethodIndex(state.auth[provider.id].orEmpty()) ?: return
        if (!launch("authorize provider=${provider.id}") { id ->
            val ready = service<KiloProviderService>().authorize(ProviderOAuthAuthorizeDto(directory, provider.id, method))
            val code = withContext(edt) {
                if (!active(id)) return@withContext null
                ready.url?.let(BrowserUtil::browse)
                if (ready.method == "code") {
                    val input = Messages.showInputDialog(this@ProvidersSettingsUi, ready.instructions ?: "Enter OAuth code", provider.name, null)
                    if (input.isNullOrBlank()) {
                        cancelOAuth(id)
                        return@withContext null
                    }
                    input
                } else {
                    val url = ready.url
                    if (ready.method == "auto" && url != null) {
                        showOAuthDevice(
                            id,
                            provider,
                            DeviceOAuthInfo(
                                url = url,
                                code = oauthCode(ready.instructions),
                                expiresIn = (KiloProviderService.OAUTH_RPC_TIMEOUT_MS / 1000).toInt(),
                                started = System.currentTimeMillis(),
                            ),
                        )
                    }
                    null
                }
            }
            val current = withContext(edt) { active(id) }
            if (!current) return@launch
            withContext(edt) {
                if (oauth == null) syncOAuthWaiting(id)
            }
            val result = service<KiloProviderService>().callback(ProviderOAuthCallbackDto(directory, provider.id, method, code))
            apply(id, result.state, result.error)
        }) return
        showProgress(
            KiloBundle.message("settings.providers.oauth.starting", provider.name),
            KiloBundle.message("settings.providers.oauth.cancel"),
        ) { cancelOAuth(request) }
    }

    @RequiresEdt
    private fun disconnect(provider: ProviderSettingsProviderDto) {
        checkEdt()
        if (!launch("disconnect provider=${provider.id}") { id ->
            val result = service<KiloProviderService>().disconnect(ProviderDisconnectDto(directory, provider.id))
            apply(id, result.state, result.error)
        }) return
        syncLoading()
    }

    @RequiresEdt
    private fun enable(provider: ProviderSettingsProviderDto) {
        checkEdt()
        if (!launch("enable provider=${provider.id}") { id ->
            val result = service<KiloProviderService>().enable(ProviderEnableDto(directory, provider.id))
            apply(id, result.state, result.error)
        }) return
        syncLoading()
    }

    @RequiresEdt
    private fun custom() {
        checkEdt()
        val dialog = CustomProviderDialog()
        if (!dialog.showAndGet()) return
        val input = dialog.input(directory)
        if (!launch("save custom provider") { id ->
            val result = service<KiloProviderService>().saveCustom(input)
            apply(id, result.state, result.error)
        }) return
        syncLoading()
    }

    private fun toolbar(): JComponent {
        add.registerCustomShortcutSet(CommonShortcuts.getNewForDialogs(), this)
        ActionManager.getInstance().getAction("Refresh")?.shortcutSet?.let { refresh.registerCustomShortcutSet(it, this) }
        val toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, DefaultActionGroup(add, refresh), true)
        toolbar.targetComponent = this
        return toolbar.component
    }

    private fun header(): JComponent {
        search.textEditor.registerKeyboardAction(
            { view.primary() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { view.move(-1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { view.move(1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                view.filter(search.text)
            }
        })
        return Stack.vertical(UiStyle.Gap.sm())
            .next(toolbar())
            .next(search)
    }

    @RequiresEdt
    private fun launch(name: String, block: suspend (Int) -> Unit): Boolean {
        checkEdt()
        if (busy || disposed) return false
        val id = ++request
        setBusy(true)
        job = cs.launch {
            val start = System.currentTimeMillis()
            LOG.info("provider settings ui $name: coroutine start dir=$directory")
            try {
                block(id)
                LOG.info("provider settings ui $name: coroutine completed durationMs=${System.currentTimeMillis() - start}")
            } catch (e: TimeoutCancellationException) {
                LOG.warn("provider settings ui $name: coroutine timed out durationMs=${System.currentTimeMillis() - start}", e)
                withContext(edt) {
                    if (!active(id)) return@withContext
                    setBusy(false)
                    clearOAuthDevice()
                    clearProgress()
                }
            } catch (e: CancellationException) {
                LOG.info("provider settings ui $name: coroutine cancelled durationMs=${System.currentTimeMillis() - start}")
                throw e
            } catch (e: Exception) {
                LOG.warn("provider settings ui $name: coroutine failed durationMs=${System.currentTimeMillis() - start}", e)
                withContext(edt) {
                    if (!active(id)) return@withContext
                    setBusy(false)
                    clearOAuthDevice()
                    showError("${e::class.simpleName}: ${e.message}")
                }
            }
        }
        return true
    }

    private suspend fun apply(id: Int, next: ProviderSettingsDto, error: String?) {
        withContext(edt) {
            if (!active(id)) return@withContext
            LOG.info("provider settings ui apply: start providers=${next.providers.size} errors=${next.errors.size} message=${error != null}")
            state = next
            setBusy(false)
            clearOAuthDevice()
            view.update(next)
            val text = error ?: next.errors.joinToString("; ") { it.detail ?: it.resource }.takeIf { it.isNotBlank() }
            if (text != null) showError(text) else clearProgress()
            LOG.info("provider settings ui apply: completed providers=${next.providers.size}")
        }
    }

    @RequiresEdt
    private fun syncOAuthWaiting(id: Int) {
        checkEdt()
        if (!active(id)) return
        val expiry = System.currentTimeMillis() + KiloProviderService.OAUTH_RPC_TIMEOUT_MS
        fun text(): String {
            val ms = (expiry - System.currentTimeMillis()).coerceAtLeast(0)
            val remain = ((ms + 999) / 1000).toInt()
            val min = remain / 60
            val sec = remain % 60
            return KiloBundle.message("settings.providers.oauth.waitingTimed", "$min:${sec.toString().padStart(2, '0')}")
        }
        stopTimer()
        showProgress(text(), KiloBundle.message("settings.providers.oauth.cancel")) { cancelOAuth(id) }
        timer = Timer(1000) {
            if (!active(id)) {
                stopTimer()
                return@Timer
            }
            updateProgress(text())
        }.also { it.start() }
    }

    @RequiresEdt
    private fun cancelOAuth(id: Int) {
        checkEdt()
        if (!active(id)) return
        request++
        job?.cancel()
        job = null
        stopTimer()
        clearOAuthDevice()
        setBusy(false)
        clearProgress()
    }

    @RequiresEdt
    private fun showOAuthDevice(id: Int, provider: ProviderSettingsProviderDto, info: DeviceOAuthInfo) {
        checkEdt()
        if (!active(id)) return
        clearProgress()
        val panel = DeviceOAuthPanel(
            DeviceOAuthText(
                title = KiloBundle.message("settings.providers.oauth.starting", provider.name),
                qrDescription = KiloBundle.message("profile.login.qr.description"),
            ),
            cancel = { cancelOAuth(id) },
            browse = { BrowserUtil.browse(it) },
            prefix = "kilo.provider.oauth",
        )
        oauth?.dispose()
        oauth = panel
        panel.update(info)
        setModalContent(panel)
    }

    @RequiresEdt
    private fun clearOAuthDevice() {
        checkEdt()
        oauth?.dispose()
        oauth = null
        setModalContent(null)
    }

    @RequiresEdt
    private fun stopTimer() {
        checkEdt()
        timer?.stop()
        timer = null
    }

    @RequiresEdt
    private fun setBusy(next: Boolean) {
        checkEdt()
        if (busy == next) return
        busy = next
        if (!next) stopTimer()
        search.isEnabled = !next
        search.textEditor.isEnabled = !next
        view.setBusy(next)
    }

    @RequiresEdt
    override fun dispose() {
        checkEdt()
        disposed = true
        request++
        stopTimer()
        job?.cancel()
        job = null
        setBusy(false)
    }

    @RequiresEdt
    private fun active(id: Int): Boolean {
        checkEdt()
        return !disposed && id == request
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Provider settings UI updates must run on EDT" }
    }
}

internal class ProvidersContent(
    private val connect: (ProviderSettingsProviderDto) -> Unit,
    private val oauth: (ProviderSettingsProviderDto) -> Unit,
    private val disconnect: (ProviderSettingsProviderDto) -> Unit,
    private val enable: (ProviderSettingsProviderDto) -> Unit,
) : BaseContentPanel() {
    private val view = SettingsListView(KiloBundle.message("settings.providers.noMatches"), SettingsListConfig.Preferred) { key, id ->
        activate(key, id)
    }
    private var state = ProviderSettingsDto()
    private var busy = false

    init {
        next(view)
    }

    @RequiresEdt
    fun update(state: ProviderSettingsDto) {
        checkEdt()
        val notes = state.providers.count { providerDescription(it).isNotBlank() }
        ProvidersSettingsUi.LOG.info("provider settings content update: start providers=${state.providers.size} connected=${state.connected.size} disabled=${state.disabled.size} descriptions=$notes")
        this.state = state
        val rows = providerListRows(state, "", disabledRows = busy)
        view.update(rows)
        ProvidersSettingsUi.LOG.info("provider settings content update: completed rows=${rows.size}")
    }

    @RequiresEdt
    fun setBusy(next: Boolean) {
        checkEdt()
        if (busy == next) return
        busy = next
        view.setBusy(next)
        view.update(providerListRows(state, "", disabledRows = busy))
    }

    @RequiresEdt
    fun filter(text: String) {
        checkEdt()
        view.filter(text)
    }

    @RequiresEdt
    fun move(step: Int) {
        checkEdt()
        view.move(step)
    }

    @RequiresEdt
    fun primary() {
        checkEdt()
        view.primary()
    }

    @RequiresEdt
    private fun activate(key: String, id: String) {
        checkEdt()
        val row = providerListRows(state, "", disabledRows = busy).firstOrNull { it.key == key } ?: return
        val action = ProviderListAction.entries.firstOrNull { it.name == id } ?: return
        if (!row.enabled(action)) return
        when (action) {
            ProviderListAction.CONNECT -> connect(row.provider)
            ProviderListAction.OAUTH -> oauth(row.provider)
            ProviderListAction.DISCONNECT -> disconnect(row.provider)
            ProviderListAction.ENABLE -> enable(row.provider)
        }
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Provider settings content updates must run on EDT" }
    }
}

private class ApiKeyDialog(title: String, method: ProviderAuthMethodDto?) : DialogWrapper(true) {
    private val key = JBPasswordField().apply { columns = 50 }
    private val fields = method?.prompts.orEmpty().associateWith { prompt ->
        if (prompt.options.isNotEmpty()) optionBox(prompt.options) as JComponent else JBTextField()
    }

    init {
        this.title = title
        init()
        initValidation()
    }

    @RequiresEdt
    fun key(): String = String(key.password)

    @RequiresEdt
    fun metadata(): Map<String, String> = fields.mapValues { (_, field) ->
        when (field) {
            is ComboBox<*> -> (field.selectedItem as? ProviderAuthOptionDto)?.value ?: field.selectedItem?.toString().orEmpty()
            is JBTextField -> field.text
            else -> ""
        }
    }.mapKeys { it.key.key }.filterValues { it.isNotBlank() }

    override fun createCenterPanel(): JComponent {
        val panel = Stack.vertical(UiStyle.Gap.sm())
        panel.next(JBLabel(KiloBundle.message("settings.providers.apiKey")))
        panel.next(key)
        fields.forEach { (prompt, field) ->
            panel.next(JBLabel(prompt.label))
            panel.next(field)
        }
        return panel
    }

    override fun doValidate(): ValidationInfo? {
        if (key().isBlank()) return ValidationInfo(KiloBundle.message("settings.providers.apiKeyRequired"), key)
        return null
    }

    private fun optionBox(options: List<ProviderAuthOptionDto>): ComboBox<ProviderAuthOptionDto> {
        val box = ComboBox(options.toTypedArray())
        box.renderer = object : DefaultListCellRenderer() {
            override fun getListCellRendererComponent(list: JList<*>?, value: Any?, index: Int, selected: Boolean, focus: Boolean): java.awt.Component {
                val item = value as? ProviderAuthOptionDto
                return super.getListCellRendererComponent(list, item?.label.orEmpty(), index, selected, focus)
            }
        }
        return box
    }
}

private class CustomProviderDialog : DialogWrapper(true) {
    private val id = JBTextField()
    private val name = JBTextField()
    private val url = JBTextField()
    private val key = JBPasswordField().apply { columns = 50 }
    private val env = JBTextField()
    private val models = JBTextField()

    init {
        title = KiloBundle.message("settings.providers.customTitle")
        init()
        initValidation()
    }

    @RequiresEdt
    fun input(directory: String) = CustomProviderSaveDto(
        directory = directory,
        id = id.text.trim(),
        name = name.text.trim(),
        baseUrl = url.text.trim(),
        apiKey = String(key.password).takeIf { it.isNotBlank() },
        envVar = env.text.trim().takeIf { it.isNotBlank() },
        models = models.text.split(',').mapNotNull { raw ->
            raw.trim().takeIf { it.isNotBlank() }?.let { CustomModelDto(it, it) }
        },
    )

    override fun createCenterPanel(): JComponent {
        val panel = Stack.vertical(UiStyle.Gap.sm())
        listOf(
            KiloBundle.message("settings.providers.customId") to id,
            KiloBundle.message("settings.providers.customName") to name,
            KiloBundle.message("settings.providers.customUrl") to url,
            KiloBundle.message("settings.providers.apiKey") to key,
            KiloBundle.message("settings.providers.customEnv") to env,
            KiloBundle.message("settings.providers.customModels") to models,
        ).forEach { (label, field) ->
            panel.next(JBLabel(label))
            panel.next(field)
        }
        return panel
    }

    override fun doValidate(): ValidationInfo? {
        if (id.text.isBlank()) return ValidationInfo(KiloBundle.message("settings.providers.customIdRequired"), id)
        if (url.text.isBlank()) return ValidationInfo(KiloBundle.message("settings.providers.customUrlRequired"), url)
        return null
    }
}
