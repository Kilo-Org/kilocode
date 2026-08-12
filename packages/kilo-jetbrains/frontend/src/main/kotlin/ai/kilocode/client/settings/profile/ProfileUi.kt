package ai.kilocode.client.settings.profile

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.CardLayout
import javax.swing.JComponent
import javax.swing.JPanel

internal const val DASHBOARD_URL = "https://app.kilo.ai/profile"
internal const val TOP_UP_URL = "https://app.kilo.ai/credits"
internal const val PASS_URL = "https://kilo.ai/pricing/kilo-pass"

internal val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

private enum class Card { LOGGED_OUT, LOGGED_IN }

/**
 * Retained top-level profile UI component.
 *
 * Builds [LoggedOutProfileUi] and [LoggedInProfileUi] once and switches between them
 * using a [CardLayout] — no [removeAll] or panel rebuilds on state changes.
 */
internal class ProfileUi(
    profile: ProfileDto?,
    status: KiloAppStatusDto,
    private val cs: CoroutineScope,
    private val app: KiloAppService = service(),
    private val browse: (String) -> Unit = { BrowserUtil.browse(it) },
    private val timers: UiTimerSource = UiTimers,
) : JPanel(BorderLayout()) {

    private val cards = JPanel(CardLayout())
    private val cardLayout = cards.layout as CardLayout

    private val out = LoggedOutProfileUi(
        login = ::start,
        retry = { app.retryAsync() },
        cancel = ::cancel,
        browse = browse,
        timers = timers,
    )
    private val account = LoggedInProfileUi(
        dashboard = {
            telemetry("Dashboard Opened", mapOf("surface" to "settings"))
            browse(DASHBOARD_URL)
        },
        topUp = {
            telemetry("Credits Opened", mapOf("surface" to "settings"))
            browse(TOP_UP_URL)
        },
        pass = {
            telemetry("Kilo Pass Opened", mapOf("surface" to "settings"))
            browse(PASS_URL)
        },
        logout = ::logout,
        organization = ::organization,
        refresh = ::refreshProfile,
    )

    private var prof = profile
    private var status = status
    private var login: LoginState = LoginState.Idle
    private var attempt = 0
    private var shown: Card? = null

    init {
        border = JBUI.Borders.empty(0, UiStyle.Gap.xl(), 0, UiStyle.Gap.xl())
        cards.add(out, Card.LOGGED_OUT.name)
        cards.add(account, Card.LOGGED_IN.name)
        add(cards, BorderLayout.NORTH)
        sync()
    }

    @RequiresEdt
    fun preferredFocus(): JComponent = when (targetCard()) {
        Card.LOGGED_IN -> account.preferredFocus()
        Card.LOGGED_OUT -> out.preferredFocus()
    }

    /**
     * Update from a full app state snapshot.
     *
     * A null profile is only treated as transient (keep the logged-in card without updating
     * account content) when [KiloAppStateDto.progress]`.profile` is [ProfileStatusDto.PENDING],
     * meaning a switch or initial load is still in flight. Any other null (no progress,
     * NOT_LOGGED_IN, etc.) clears the profile and shows the logged-out card.
     */
    @RequiresEdt
    fun update(state: KiloAppStateDto) {
        checkEdt()
        this.status = state.status
        val transient = state.profile == null && state.progress?.profile == ProfileStatusDto.PENDING
        when {
            state.profile != null -> {
                prof = state.profile
                login = LoginState.Idle
            }
            transient -> { /* keep existing prof and account UI untouched */ }
            else -> prof = null
        }
        sync(skipAccount = transient)
    }

    /**
     * Convenience overload for callers that already hold separate profile/status values
     * (login flow, direct tests). Null profile clears [prof] only when there is no existing
     * profile; otherwise keeps the logged-in card visible without updating account content.
     * Callers that pass null always provide a state fallback (`profile ?: state.profile`),
     * so this branch is not reachable in production — it exists for transient-null tests.
     */
    @RequiresEdt
    fun update(profile: ProfileDto?, status: KiloAppStatusDto) {
        checkEdt()
        this.status = status
        val transient = profile == null && prof != null
        if (profile != null) {
            prof = profile
            login = LoginState.Idle
        } else if (!transient) {
            prof = null
        }
        sync(skipAccount = transient)
    }

    @RequiresEdt
    private fun sync(skipAccount: Boolean = false) {
        checkEdt()
        val target = targetCard()
        if (target == Card.LOGGED_OUT) {
            out.update(status, login)
        } else if (!skipAccount) {
            prof?.let { account.update(it) }
        }
        if (shown != target) {
            cardLayout.show(cards, target.name)
            shown = target
            revalidate()
            repaint()
        }
    }

    private fun targetCard(): Card {
        val s = status
        val p = prof
        // When loading/connecting and already showing the logged-in card, stay on it to
        // avoid focus loss during reconnects, initial loads, and org switches.
        val transientLoad = s == KiloAppStatusDto.DOWNLOADING || s == KiloAppStatusDto.CONNECTING || s == KiloAppStatusDto.LOADING || s == KiloAppStatusDto.MIGRATION_REQUIRED
        if (transientLoad && shown == Card.LOGGED_IN) return Card.LOGGED_IN
        return when {
            s == KiloAppStatusDto.DISCONNECTED || transientLoad -> Card.LOGGED_OUT
            s == KiloAppStatusDto.ERROR -> Card.LOGGED_OUT
            p == null -> Card.LOGGED_OUT
            else -> Card.LOGGED_IN
        }
    }

    @RequiresEdt
    private fun applyState() {
        checkEdt()
        update(app.state.value)
    }

    /**
     * Invalidate any pending login flows and dispose the logged-out UI timer.
     * Called from [ai.kilocode.client.settings.profile.UserProfileConfigurable.disposeUIResources].
     */
    @RequiresEdt
    fun dispose() {
        attempt++
        out.dispose()
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) {
            "ProfileUi updates must run on EDT"
        }
    }

    private fun start() {
        val id = ++attempt
        login = LoginState.Initiating
        telemetry("Account Connect Clicked", mapOf("surface" to "settings"))
        sync()
        cs.launch {
            try {
                val next = app.startLogin()
                withContext(edt) {
                    if (id != attempt) return@withContext
                    login = LoginState.Pending(next, timers.now())
                    sync()
                    browse(next.verificationUrl)
                }
                val profile = app.completeLogin()
                telemetry("Account Connect Success", mapOf("surface" to "settings", "hasOrganizations" to ((profile?.organizations?.isNotEmpty()) == true).toString()))
                val state = app.state.value
                withContext(edt) {
                    if (id != attempt) return@withContext
                    login = LoginState.Idle
                    update(profile ?: state.profile, state.status)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                telemetry("Account Connect Failed", mapOf("stage" to "complete", "errorClass" to e::class.java.name))
                withContext(edt) {
                    if (id != attempt) return@withContext
                    login = LoginState.Error(compactLoginError(e))
                    sync()
                }
            }
        }
    }

    private fun cancel() {
        attempt++
        login = LoginState.Idle
        telemetry("Account Connect Failed", mapOf("stage" to "cancel", "errorClass" to "cancelled"))
        sync()
    }

    private fun logout() {
        telemetry("Account Logout Clicked", mapOf("surface" to "settings"))
        cs.launch {
            try {
                val ok = app.logout()
                if (!ok) return@launch
                telemetry("Account Logout Success", mapOf("surface" to "settings"))
                withContext(edt) {
                    login = LoginState.Idle
                    applyState()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                withContext(edt) {
                    applyState()
                }
            }
        }
    }

    private fun organization(org: String?) {
        cs.launch {
            try {
                val profile = app.setOrganization(org)
                telemetry("Organization Switched", mapOf("target" to if (org == null) "personal" else "organization"))
                val state = app.state.value
                withContext(edt) {
                    update(profile ?: state.profile, state.status)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                withContext(edt) {
                    applyState()
                }
            }
        }
    }

    private fun refreshProfile() {
        cs.launch {
            try {
                val profile = app.refreshProfile()
                val state = app.state.value
                withContext(edt) {
                    update(profile ?: state.profile, state.status)
                    account.setRefreshing(false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                withContext(edt) {
                    applyState()
                    account.setRefreshing(false)
                }
            }
        }
    }

    private fun telemetry(event: String, props: Map<String, String>) {
        Telemetry.send(event, props)
    }
}

private val HTML_MARKERS = listOf("<!doctype html", "<html", "<head", "<body")
private val HTTP_STATUS_RE = Regex("""(?:^|\s)([45]\d{2})(?:\s|$)""")

internal fun compactLoginError(e: Exception): String {
    val msg = e.message?.trim() ?: return KiloBundle.message("profile.login.failed")
    val lower = msg.lowercase()
    if (HTML_MARKERS.any { lower.contains(it) }) {
        val status = HTTP_STATUS_RE.find(msg)?.groupValues?.getOrNull(1)
        return if (status != null) "${KiloBundle.message("profile.login.failed")} ($status)"
        else KiloBundle.message("profile.login.failed")
    }
    val norm = msg.replace(Regex("\\s+"), " ")
    val summary = norm.take(180)
    return if (summary.isNotBlank()) summary else KiloBundle.message("profile.login.failed")
}
