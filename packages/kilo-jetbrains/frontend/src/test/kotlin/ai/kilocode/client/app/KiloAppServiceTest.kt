package ai.kilocode.client.app

import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking

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

    // ------ completeLogin ------

    fun `test completeLogin updates app state profile on success`() = runBlocking(Dispatchers.Default) {
        rpc.fakeProfile = profile()
        val result = app.completeLogin("/my/dir")
        assertNotNull(result)
        assertEquals("alice@test.com", result!!.email)
        assertEquals("alice@test.com", app.state.value.profile?.email)
        assertEquals(listOf("/my/dir"), rpc.completeDirectories)
    }

    fun `test completeLogin returns null on exception without clearing previous profile`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "existing@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.completeError = RuntimeException("complete failed")
        val result = app.completeLogin("/dir")
        assertNull(result)
        assertEquals("existing@test.com", app.state.value.profile?.email)
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
        assertNotNull(result)
        assertEquals("org_1", result!!.currentOrgId)
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
        assertNotNull(result)
        assertNull(result!!.currentOrgId)
        assertEquals(listOf<String?>(null), rpc.orgSelections)
    }

    fun `test setOrganization returns null on exception without changing profile`() = runBlocking(Dispatchers.Default) {
        val existing = profile(email = "alice@test.com")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = existing)
        rpc.organizationError = RuntimeException("org failed")
        val result = app.setOrganization("org_1")
        assertNull(result)
        assertEquals("alice@test.com", app.state.value.profile?.email)
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
