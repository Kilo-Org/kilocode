package ai.kilocode.client.onboarding

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.onboarding.providers.v5migration.KiloMigrationService
import ai.kilocode.client.onboarding.providers.v5migration.MigrationOnboardingProvider
import ai.kilocode.client.onboarding.ui.OnboardingDialog
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.KiloAppStateDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch

/** Interface exposed to session UI + dialog components. */
interface OnboardingController {
    val steps: StateFlow<List<OnboardingStep>>
    fun provider(id: String): OnboardingProvider?

    /** List-card `Later`: defer every currently detected step for the rest of this IDE run. */
    fun later()

    /** List-card `Skip All`: permanently skip every currently detected step. */
    fun skipAll()

    /** Dialog `Later` for one step. */
    fun laterStep(id: String)

    /** Dialog `Skip` for one step. */
    fun skipStep(id: String)

    /** List-card `Start`: open the onboarding dialog at the first pending step. */
    fun start()

    /**
     * Drop the current run's `Later` deferral for [id] so the step is offered again as soon as its
     * provider detects a need. Used by forced reruns (e.g. the migration action).
     */
    fun reoffer(id: String)
}

/**
 * App-level registry + detector for pluggable onboarding sources (see [OnboardingProvider]).
 *
 * Re-runs [OnboardingProvider.detect] on every distinct app-state emission and every provider
 * [OnboardingProvider.invalidate] signal, republishes [steps], and owns the single onboarding
 * dialog instance so a second `Start` click focuses the existing dialog instead of opening another.
 *
 * Persistence is entirely provider-owned (see [OnboardingProvider.skip] / [OnboardingProvider.later]);
 * this service keeps only an in-memory set of ids deferred for the current IDE run.
 */
@Service(Service.Level.APP)
class KiloOnboardingService internal constructor(
    private val cs: CoroutineScope,
    providerList: List<OnboardingProvider>,
    appState: StateFlow<KiloAppStateDto>?,
    private val capture: (String, Map<String, String>) -> Unit = { event, props -> Telemetry.send(event, props) },
) : OnboardingController {

    /** Platform constructor — resolves the default provider set from the service container. */
    constructor(cs: CoroutineScope) : this(
        cs,
        listOf(MigrationOnboardingProvider(service<KiloMigrationService>())),
        service<KiloAppService>().state,
    )

    companion object {
        private val LOG = KiloLog.create(KiloOnboardingService::class.java)

        fun getInstance(): KiloOnboardingService = service()
    }

    private val providers = providerList.associateBy { it.id }

    private val _steps = MutableStateFlow<List<OnboardingStep>>(emptyList())
    override val steps: StateFlow<List<OnboardingStep>> = _steps.asStateFlow()

    /** This-IDE-run deferrals ("Later"). In-memory only — cleared on restart so steps re-offer. */
    private val deferred = ConcurrentHashMap.newKeySet<String>()

    private var dialog: OnboardingDialog? = null

    init {
        if (appState != null) {
            val triggers: Flow<Unit> = merge(
                appState.map { },
                *providerList.map { it.invalidate }.toTypedArray(),
            )
            cs.launch { triggers.collect { redetect() } }
        }
    }

    override fun provider(id: String): OnboardingProvider? = providers[id]

    override fun later() {
        steps.value.forEach { laterStep(it.id) }
    }

    override fun skipAll() {
        steps.value.forEach { skipStep(it.id) }
    }

    override fun laterStep(id: String) {
        val provider = providers[id] ?: return
        capture("Onboarding Step Deferred", mapOf("stepId" to id))
        cs.launch {
            // Defer only once the provider confirms. For a blocking step, `later()` is what
            // unpauses the app, so suppressing the step on a failed resume would hide the only UI
            // that can still resolve it.
            if (provider.later()) deferred.add(id)
            else LOG.warn("Onboarding: keeping the step offered because later failed id=$id")
            redetect()
        }
    }

    override fun skipStep(id: String) {
        providers[id]?.skip()
        capture("Onboarding Step Skipped", mapOf("stepId" to id))
        cs.launch { redetect() }
    }

    override fun reoffer(id: String) {
        if (!deferred.remove(id)) return
        LOG.info("Onboarding: cleared this-run deferral so the step can be offered again id=$id")
        cs.launch { redetect() }
    }

    override fun start() {
        if (dialog != null) return
        val initial = steps.value
        if (initial.isEmpty()) return
        capture(
            "Onboarding Started",
            mapOf("stepCount" to initial.size.toString(), "stepIds" to initial.joinToString(",") { it.id }),
        )
        val created = OnboardingDialog(this, initial) { dialog = null }
        dialog = created
        created.show()
    }

    private suspend fun redetect() {
        val next = providers.values.mapNotNull { provider ->
            if (provider.id in deferred) return@mapNotNull null
            val need = try {
                provider.detect()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LOG.warn("onboarding detect failed provider=${provider.id}", e)
                null
            } ?: return@mapNotNull null
            OnboardingStep(provider.id, need, provider.blocking)
        }
        if (next == _steps.value) return
        val wasEmpty = _steps.value.isEmpty()
        _steps.value = next
        if (next.isNotEmpty() && wasEmpty) {
            capture(
                "Onboarding Shown",
                mapOf("stepCount" to next.size.toString(), "stepIds" to next.joinToString(",") { it.id }),
            )
        }
    }
}
