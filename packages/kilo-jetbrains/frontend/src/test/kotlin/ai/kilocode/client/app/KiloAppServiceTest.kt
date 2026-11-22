package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadErrorDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import ai.kilocode.rpc.dto.ProfileSyncDto
import ai.kilocode.rpc.dto.SpeechModelDto
import ai.kilocode.rpc.dto.SpeechResultDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import kotlinx.coroutines.withTimeout

/**
 * Service-level tests for [KiloAppService] profile/login/logout/org operations.
 *
 * Uses [FakeAppRpcApi] to avoid RPC/backend involvement.
 */
@Suppress("UnstableApiUsage")
class KiloAppServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(scope, rpc)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY)
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    private fun profile(
        email: String = "alice@test.com",
        name: String? = "Alice",
        balance: ProfileBalanceDto? = null,
        orgs: List<ProfileOrganizationDto> = emptyList(),
        currentOrgId: String? = null,
    ) = ProfileDto(email = email, name = name, organizations = orgs, balance = balance, currentOrgId = currentOrgId)

    private suspend fun waitUntil(done: () -> Boolean) {
        withTimeout(5_000) {
            while (!done()) yield()
        }
    }

    fun `test transcription selects preferred model and forwards WAV bytes`() = runBlocking(Dispatchers.Default) {
        rpc.speechModels = listOf(
            SpeechModelDto("other/model", "Other"),
            SpeechModelDto("openai/whisper-1", "Whisper"),
        )
        rpc.speechResult = SpeechResultDto("dictated prompt")

        val result = app.transcribe("/repo", byteArrayOf(4, 5, 6))

        assertEquals("dictated prompt", result)
        assertEquals(listOf("/repo", "/repo"), rpc.speechDirectories)
        val request = rpc.speechRequests.single()
        assertEquals("openai/whisper-1", request.model)
        assertEquals("wav", request.format)
        assertTrue(request.data.contentEquals(byteArrayOf(4, 5, 6)))
    }

    fun `test transcription caches selected model`() = runBlocking(Dispatchers.Default) {
        rpc.speechModels = listOf(SpeechModelDto("speech/model", "Speech"))

        app.transcribe("/repo", byteArrayOf(1))
        app.transcribe("/repo", byteArrayOf(2))

        assertEquals(1, rpc.speechModelCalls)
        assertEquals(listOf("speech/model", "speech/model"), rpc.speechRequests.map { it.model })
    }

    fun `test transcription falls back to default model when discovery fails`() = runBlocking(Dispatchers.Default) {
        rpc.speechModelsError = IllegalStateException("catalog unavailable")

        app.transcribe("/repo", byteArrayOf(1))
        rpc.speechModelsError = null
        rpc.speechModels = listOf(SpeechModelDto("speech/allowed", "Allowed"))
        app.transcribe("/repo", byteArrayOf(2))

        assertEquals(2, rpc.speechModelCalls)
        assertEquals(listOf("openai/whisper-1", "speech/allowed"), rpc.speechRequests.map { it.model })
    }

    fun `test transcription model discovery propagates cancellation`() = runBlocking(Dispatchers.Default) {
        rpc.speechModelsError = CancellationException("cancelled")

        val err = runCatching { app.transcribe("/repo", byteArrayOf(1)) }.exceptionOrNull()

        assertTrue(err is CancellationException)
        assertTrue(rpc.speechRequests.isEmpty())
    }

    fun `test fetchCoreInfoAsync dedupes in flight requests`() = runBlocking(Dispatchers.Default) {
        rpc.cliInfoGate = CompletableDeferred()
        val seen = mutableListOf<CoreInfo?>()

        app.fetchCoreInfoAsync { seen.add(it) }
        app.fetchCoreInfoAsync { seen.add(it) }
        waitUntil { rpc.cliVersionCalls == 1 }

        assertEquals(1, rpc.cliVersionCalls)
        assertEquals(0, rpc.cliPlatformCalls)
        rpc.cliInfoGate!!.complete(Unit)
        waitUntil { seen.size == 2 }

        assertEquals(1, rpc.cliVersionCalls)
        assertEquals(1, rpc.cliPlatformCalls)
        assertEquals(listOf(CoreInfo("1.0.0", "darwin-arm64"), CoreInfo("1.0.0", "darwin-arm64")), seen)
    }

    fun `test fetchCoreInfoAsync retries after failure`() = runBlocking(Dispatchers.Default) {
        val seen = mutableListOf<CoreInfo?>()
        rpc.cliInfoError = RuntimeException("core failed")

        app.fetchCoreInfoAsync { seen.add(it) }
        waitUntil { seen.size == 1 }

        assertNull(seen.single())
        assertNull(app.core)
        rpc.cliInfoError = null
        app.fetchCoreInfoAsync { seen.add(it) }
        waitUntil { seen.size == 2 }

        assertEquals(CoreInfo("1.0.0", "darwin-arm64"), seen.last())
        assertEquals(2, rpc.cliVersionCalls)
    }

    // ------ refreshProfile ------

    fun `test refreshProfile updates app state profile on success`() = runBlocking(Dispatchers.Default) {
        rpc.fakeProfile = profile()
        val result = app.refreshProfile()
        assertNotNull(result)
        assertEquals("alice@test.com", result!!.email)
        assertEquals("alice@test.com", app.state.value.profile?.email)
    }

    fun `test refreshProfile returns null and leaves existing state on exception`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.refreshError = RuntimeException("refresh failed")
        val result = app.refreshProfile()
        assertNull(result)
        assertEquals("existing@test.com", app.state.value.profile?.email)
    }

    // ------ refreshAccount ------

    fun `test refreshAccount publishes the account on success`() = runBlocking(Dispatchers.Default) {
        rpc.refreshAccountResult = ProfileSyncDto(profile = profile())
        val result = app.refreshAccount()
        assertEquals("alice@test.com", result.profile?.email)
        assertEquals("alice@test.com", app.state.value.profile?.email)
    }

    fun `test refreshAccount leaves the published account on a failed read`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.refreshAccountResult = ProfileSyncDto(error = LoadErrorDto(resource = "profile", status = 503))
        val result = app.refreshAccount()
        assertEquals(503, result.error?.status)
        assertEquals("existing@test.com", app.state.value.profile?.email)
    }

    // ------ completeLogin ------

    fun `test completeLogin updates app state profile on success`() = runBlocking(Dispatchers.Default) {
        rpc.fakeProfile = profile()
        val result = app.completeLogin("/my/dir")
        assertNotNull(result.profile)
        assertEquals("alice@test.com", result.profile!!.email)
        assertEquals("alice@test.com", app.state.value.profile?.email)
        assertEquals(listOf("/my/dir"), rpc.completeDirectories)
    }

    fun `test completeLogin propagates an rpc failure and keeps the published profile`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.completeError = RuntimeException("complete failed")
        val err = runCatching { app.completeLogin("/dir") }.exceptionOrNull()
        assertEquals("complete failed", err?.message)
        assertEquals("existing@test.com", app.state.value.profile?.email)
    }

    fun `test completeLogin keeps the published profile when the follow-up profile read reports an error`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.completeResult = ProfileSyncDto(error = LoadErrorDto(resource = "profile", status = 500))
        val result = app.completeLogin("/dir")
        assertNull(result.profile)
        assertEquals("profile", result.error?.resource)
        assertEquals(KiloAppStateDto(KiloAppStatusDto.READY, profile = existing), app.state.value)
    }

    fun `test completeLogin clears the published profile when nobody is signed in`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            profile = existing,
            progress = LoadProgressDto(profile = ProfileStatusDto.LOADED),
        )
        rpc.completeResult = ProfileSyncDto(profile = null)
        val result = app.completeLogin("/dir")
        assertNull(result.profile)
        assertNull(result.error)
        assertNull(app.state.value.profile)
        assertEquals(ProfileStatusDto.NOT_LOGGED_IN, app.state.value.progress?.profile)
    }

    // ------ logout ------

    fun `test logout clears profile when rpc returns true`() = runBlocking(Dispatchers.Default) {
        val prof = profile()
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = prof)
        rpc.fakeProfile = prof
        rpc.logoutResult = true
        val ok = app.logout()
        assertTrue(ok)
        assertNull(app.state.value.profile)
    }

    fun `test logout does not clear profile when rpc returns false`() = runBlocking(Dispatchers.Default) {
        val prof = profile()
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = prof)
        rpc.logoutResult = false
        val ok = app.logout()
        assertFalse(ok)
        assertEquals("alice@test.com", app.state.value.profile?.email)
    }

    fun `test logout returns false on exception`() = runBlocking(Dispatchers.Default) {
        val prof = profile()
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = prof)
        rpc.logoutError = RuntimeException("logout failed")
        val ok = app.logout()
        assertFalse(ok)
        // Profile should be unchanged since logout threw
        assertEquals("alice@test.com", app.state.value.profile?.email)
    }

    // ------ setOrganization ------

    fun `test setOrganization updates profile on success for org id`() = runBlocking(Dispatchers.Default) {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val personal = profile(orgs = orgs)
        rpc.fakeProfile = personal
        val org = personal.copy(currentOrgId = "org_1")
        rpc.orgProfiles["org_1"] = org
        val result = app.setOrganization("org_1")
        assertNotNull(result.profile)
        assertEquals("org_1", result.profile!!.currentOrgId)
        assertEquals(listOf<String?>("org_1"), rpc.orgSelections)
        assertEquals("org_1", app.state.value.profile?.currentOrgId)
    }

    fun `test setOrganization updates profile for personal null selection`() = runBlocking(Dispatchers.Default) {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val org = profile(orgs = orgs, currentOrgId = "org_1")
        rpc.fakeProfile = org
        val personal = profile(orgs = orgs, currentOrgId = null)
        rpc.orgProfiles[null] = personal
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = org)
        val result = app.setOrganization(null)
        assertNotNull(result.profile)
        assertNull(result.profile!!.currentOrgId)
        assertEquals(listOf<String?>(null), rpc.orgSelections)
    }

    fun `test setOrganization propagates an rpc failure and keeps the published profile`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "alice@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.organizationError = RuntimeException("org failed")
        val err = runCatching { app.setOrganization("org_1") }.exceptionOrNull()
        assertEquals("org failed", err?.message)
        assertEquals(KiloAppStateDto(KiloAppStatusDto.READY, profile = existing), app.state.value)
    }

    fun `test setOrganization keeps the published profile when the follow-up profile read reports an error`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "alice@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.organizationResult = ProfileSyncDto(error = LoadErrorDto(resource = "profile", status = 503))
        val result = app.setOrganization("org_1")
        assertNull(result.profile)
        assertEquals(503, result.error?.status)
        assertEquals(listOf<String?>("org_1"), rpc.orgSelections)
        assertEquals(KiloAppStateDto(KiloAppStatusDto.READY, profile = existing), app.state.value)
    }

    // ------ startLogin / completeLogin directory forwarding ------

    fun `test startLogin forwards directory`() = runBlocking(Dispatchers.Default) {
        app.startLogin("/workspace")
        assertEquals(listOf("/workspace"), rpc.startDirectories)
    }

    fun `test completeLogin forwards directory`() = runBlocking(Dispatchers.Default) {
        rpc.fakeProfile = profile()
        app.completeLogin("/workspace")
        assertEquals(listOf("/workspace"), rpc.completeDirectories)
    }

    fun `test startLogin with null directory is forwarded`() = runBlocking(Dispatchers.Default) {
        app.startLogin(null)
        assertEquals(listOf<String?>(null), rpc.startDirectories)
    }
}
