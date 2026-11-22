package ai.kilocode.client.settings.profile

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.rpc.dto.ProfileSyncDto
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

    private companion object {
        private val LOG = KiloLog.create(ProfileUi::class.java)
    }

    private val cards = JPanel(CardLayout())
    private val cardLayout = cards.layout as CardLayout

    private val out = LoggedOutProfileUi(
        login = ::start,
        retry = { app.retryAsync() },
        cancel = ::cancel,
        browse = browse,
        refresh = ::refreshProfile,
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

    /** Whether an account step reported that its follow-up account read did not complete. */
    private var unavailable = false

    /**
     * The account the notice was raised against. A read that completes and brings a different
     * account clears the notice; a reload that republishes the held account changed nothing.
     */
    private var held: ProfileDto? = null
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
     * A null profile is treated as transient (keep the logged-in card without updating account
     * content) when [KiloAppStateDto.progress]`.profile` is [ProfileStatusDto.PENDING], meaning a
     * switch or initial load is still in flight. Otherwise a null clears the profile and shows the
     * logged-out card, except while the account notice is up — see below.
     *
     * An emission that carries a different account than the one the notice was raised against proves
     * a read completed, so it ends the notice. A reload that republishes the held account changed
     * nothing: its own read did not produce a new account, so the notice stays.
     *
     * While the notice is up, an emission that carries no account keeps the account and the notice.
     * The tolerant background refresh publishes no account for a read that could not complete and
     * marks it [ProfileStatusDto.NOT_LOGGED_IN], the same state a definitive sign-out produces, so
     * this emission cannot tell an outage from a sign-out. Dropping the account here would hide the
     * failure the notice reports. The notice's own retry reports its read, and that answer decides.
     * A logout clears both explicitly instead of going through this branch.
     */
    @RequiresEdt
    fun update(state: KiloAppStateDto) {
        checkEdt()
        this.status = state.status
        val fresh = state.profile
        if (fresh != null && unavailable && fresh != held) clearUnavailable()
        val transient = fresh == null && state.progress?.profile == ProfileStatusDto.PENDING
        val keep = unavailable && fresh == null && !transient
        when {
            fresh != null -> {
                prof = fresh
                login = LoginState.Idle
            }
            transient -> { /* keep existing prof and account UI untouched */ }
            keep -> { /* the notice owns the account until its own retry answers */ }
            else -> prof = null
        }
        sync(skipAccount = transient || keep)
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
                val result = app.completeLogin()
                val error = result.error
                if (error == null) {
                    telemetry("Account Connect Success", mapOf("surface" to "settings", "hasOrganizations" to ((result.profile?.organizations?.isNotEmpty()) == true).toString()))
                } else {
                    telemetry("Account Connect Failed", mapOf("stage" to "profile", "errorClass" to accountErrorToken(error)))
                    LOG.warn("account profile read failed resource=${error.resource} status=${error.status}")
                }
                val state = app.state.value
                withContext(edt) {
                    if (id != attempt) return@withContext
                    login = LoginState.Idle
                    if (error != null) showUnavailable(state.profile, state.status)
                    else {
                        clearUnavailable()
                        update(result.profile ?: state.profile, state.status)
                    }
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
                    // A logout is definitive and user-initiated, so it clears the account and the
                    // notice outright. Relying on the next state emission would not do it: while the
                    // notice is up, an account-less emission deliberately keeps the held account.
                    clearUnavailable()
                    prof = null
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
                val result = app.setOrganization(org)
                if (result.error != null) {
                    val state = app.state.value
                    withContext(edt) {
                        // The switch itself finished, so the previous account stays: re-applying it
                        // reverts the combo, and the notice keeps Refresh within reach.
                        showUnavailable(state.profile, state.status)
                    }
                    return@launch
                }
                telemetry("Organization Switched", mapOf("target" to if (org == null) "personal" else "organization"))
                val state = app.state.value
                withContext(edt) {
                    clearUnavailable()
                    update(result.profile ?: state.profile, state.status)
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

    /**
     * Report an account step whose follow-up profile read did not complete.
     *
     * A known account keeps its card and gains the notice that offers Refresh; without one the
     * logged-out card shows the same text and offers Refresh itself.
     */
    @RequiresEdt
    private fun showUnavailable(fallback: ProfileDto?, appStatus: KiloAppStatusDto) {
        unavailable = true
        val known = prof ?: fallback
        held = known
        if (known == null) {
            login = LoginState.Error(accountUnavailable(), LoginState.Retry.PROFILE)
            sync()
            return
        }
        update(known, appStatus)
        account.setNotice(accountUnavailable())
    }

    /**
     * Clear the notice an account step left behind, now that a read completed. Only a completed
     * read clears it: an unrelated state emission keeps the notice in place, and so does a reload
     * that republishes the account the notice was raised against.
     */
    @RequiresEdt
    private fun clearUnavailable() {
        unavailable = false
        held = null
        val current = login
        if (current is LoginState.Error && current.retry == LoginState.Retry.PROFILE) login = LoginState.Idle
        account.setNotice(null)
    }

    private fun accountUnavailable(): String = KiloBundle.message("profile.notice.accountUnavailable")

    /**
     * Re-read the profile from the notice's Refresh action.
     *
     * The notice's retry reports its outcome, so a read that cannot complete keeps the account and
     * the notice, while a plain refresh keeps its tolerant behaviour.
     */
    private fun refreshProfile() {
        cs.launch {
            try {
                // `unavailable` is written only on the EDT, while this coroutine runs on
                // Dispatchers.Default. Read it on the EDT so the retry reliably takes the strict read.
                val strict = withContext(edt) { unavailable }
                val result = if (strict) app.refreshAccount() else ProfileSyncDto(app.refreshProfile())
                withContext(edt) {
                    if (result.error != null) applyState()
                    else {
                        clearUnavailable()
                        applyState()
                    }
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
