package ai.kilocode.client.session.ui.account

import ai.kilocode.client.session.controller.SessionControllerEvent
import ai.kilocode.client.session.controller.SessionControllerEvent.AccountOverlaySnapshot
import ai.kilocode.client.session.controller.SessionControllerTestBase
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import com.intellij.icons.AllIcons

@Suppress("UnstableApiUsage")
class SessionAccountOverlayTest : SessionControllerTestBase() {

    private lateinit var panel: SessionAccountOverlay
    private var profileCalls = 0

    override fun setUp() {
        super.setUp()
        panel = SessionAccountOverlay(
            select = { },
            profile = { profileCalls++ },
        )
    }

    private fun show(snap: AccountOverlaySnapshot) {
        edt { panel.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap)) }
    }

    private fun hide() {
        edt { panel.onEvent(SessionControllerEvent.AccountOverlayChanged.Hide) }
    }

    private fun snap(profile: ProfileDto?) =
        AccountOverlaySnapshot(status = KiloAppStatusDto.READY, profile = profile)

    private fun profile(
        email: String = "user@example.com",
        name: String? = null,
        organizations: List<ProfileOrganizationDto> = emptyList(),
        balance: ProfileBalanceDto? = null,
        currentOrgId: String? = null,
        hasPersonalAccount: Boolean = true,
    ) = ProfileDto(
        email = email,
        name = name,
        organizations = organizations,
        hasPersonalAccount = hasPersonalAccount,
        balance = balance,
        currentOrgId = currentOrgId,
    )

    private fun org(id: String, name: String, role: String = "MEMBER") =
        ProfileOrganizationDto(id = id, name = name, role = role)

    // --- test 1: logged-out state hides the overlay entirely ---

    fun `test logged out state hides overlay`() {
        show(snap(null))
        edt { assertFalse(panel.isVisible) }
    }

    // --- test 2: logged-in personal account shows picker title ---

    fun `test logged in personal account shows picker title`() {
        val prof = profile(
            email = "user@example.com",
            name = "Test User",
            balance = ProfileBalanceDto(10.0),
        )
        show(snap(prof))
        edt {
            assertTrue(panel.isVisible)
            assertTrue(panel.loggedInVisible())
            assertTrue(panel.pickerVisible())
            assertEquals("Personal Account", panel.accountTitle())
        }
    }

    fun `test logged in with email fallback still shows personal account title`() {
        val prof = profile(email = "user@example.com")
        show(snap(prof))
        edt { assertEquals("Personal Account", panel.accountTitle()) }
    }

    // --- test 3: logged-in org account shows org title in picker ---

    fun `test logged in org account shows org title in picker`() {
        val acme = org("org_1", "Acme", "MEMBER")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            balance = ProfileBalanceDto(25.0),
            currentOrgId = "org_1",
        )
        show(snap(prof))
        edt {
            assertTrue(panel.isVisible)
            assertTrue(panel.loggedInVisible())
            assertTrue(panel.pickerVisible())
            assertEquals("Acme", panel.accountTitle())
            // personal + acme = 2 choices
            assertEquals(2, panel.choiceCount())
            // selected index is 1 (org_1 is the second item)
            assertEquals(1, panel.selectedIndex())
        }
    }

    fun `test profile without personal account hides personal choice`() {
        val acme = org("org_1", "Acme", "MEMBER")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = "org_1",
            hasPersonalAccount = false,
        )
        show(snap(prof))
        edt {
            assertEquals("Acme", panel.accountTitle())
            assertEquals(1, panel.choiceCount())
            assertEquals(0, panel.selectedIndex())
        }
    }

    // --- test 4: programmatic update does not call select callback ---

    fun `test programmatic update does not call select callback`() {
        val selected = mutableListOf<String?>()
        val p = SessionAccountOverlay(
            select = { org -> selected.add(org) },
            profile = {},
        )
        val acme = org("org_1", "Acme")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = null,
        )
        edt { p.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap(prof))) }
        selected.clear()

        // Show again with same profile - no user selection
        edt { p.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap(prof))) }

        assertEquals(0, selected.size)
    }

    // --- test 5: switching disables picker ---

    fun `test switching true disables picker`() {
        val acme = org("org_1", "Acme")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = null,
        )
        val switchingSnap = AccountOverlaySnapshot(
            status = KiloAppStatusDto.READY,
            profile = prof,
            switching = true,
            targetOrgId = "org_1",
        )
        show(switchingSnap)
        edt { assertFalse(panel.pickerEnabled()) }
    }

    fun `test switching false enables picker`() {
        val acme = org("org_1", "Acme")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = null,
        )
        show(snap(prof))
        edt { assertTrue(panel.pickerEnabled()) }
    }

    // --- test 6: switching with targetOrgId shows the target account title ---

    fun `test switching with targetOrgId shows target account title`() {
        val acme = org("org_1", "Acme")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = null,
        )
        val switchingSnap = AccountOverlaySnapshot(
            status = KiloAppStatusDto.READY,
            profile = prof,
            switching = true,
            targetOrgId = "org_1",
        )
        show(switchingSnap)
        edt {
            assertEquals("Acme", panel.accountTitle())
            assertFalse(panel.pickerEnabled())
        }
    }

    fun `test switching to personal account shows personal account title`() {
        val acme = org("org_1", "Acme")
        val prof = profile(
            email = "user@example.com",
            organizations = listOf(acme),
            currentOrgId = "org_1",
        )
        val switchingSnap = AccountOverlaySnapshot(
            status = KiloAppStatusDto.READY,
            profile = prof,
            switching = true,
            targetOrgId = null,
        )
        show(switchingSnap)
        edt {
            assertEquals("Personal Account", panel.accountTitle())
            assertFalse(panel.pickerEnabled())
        }
    }

    fun `test account switcher uses session view background and border`() {
        val prof = profile(email = "user@example.com")
        show(snap(prof))
        edt {
            assertEquals(SessionUiStyle.AccountPopup.bgColor(), panel.panelBackground())
            assertEquals(SessionUiStyle.AccountPopup.outlineColor(), panel.panelBorderColor())
        }
    }

    // --- test 7: transient null profile keeps existing logged-in content ---

    fun `test transient null profile keeps logged in card`() {
        val prof = profile(email = "user@example.com", name = "Test User")
        show(snap(prof))
        edt {
            assertTrue(panel.loggedInVisible())
            assertEquals("Personal Account", panel.accountTitle())
        }

        // Show transient null (pending switch)
        val transientSnap = AccountOverlaySnapshot(
            status = KiloAppStatusDto.READY,
            profile = null,
            transient = true,
        )
        show(transientSnap)
        edt {
            assertTrue(panel.isVisible)
            assertTrue(panel.loggedInVisible())
        }
    }

    // --- test 8: hide event hides component ---

    fun `test hide event hides component`() {
        val prof = profile(email = "user@example.com")
        show(snap(prof))
        edt { assertTrue(panel.isVisible) }

        hide()
        edt { assertFalse(panel.isVisible) }
    }

    // --- test 9: renderer uses check icon for active account ---

    fun `test renderer active account uses check icon`() {
        val choice = AccountChoice("org_1", "Acme")
        val renderer = AccountPickerRenderer { "org_1" }

        assertSame(AccountPickerRenderer.checked, renderer.icon(choice))
    }

    // --- test 10: renderer uses empty icon for inactive account ---

    fun `test renderer inactive account reserves icon space`() {
        val choice = AccountChoice(null, "Personal Account")
        val renderer = AccountPickerRenderer { "org_1" }

        assertSame(AccountPickerRenderer.empty, renderer.icon(choice))
        assertEquals(AllIcons.Actions.Checked.iconWidth, renderer.icon(choice).iconWidth)
    }

    // --- test 11: balance badge appears when profile has balance ---

    fun `test logged in account shows balance badge`() {
        val prof = profile(balance = ProfileBalanceDto(10.0))
        show(snap(prof))
        edt {
            assertTrue(panel.balanceVisible())
            assertTrue(panel.balanceIcon() is FilledBadgeIcon)
            assertEquals("\$10.00", panel.balanceText())
        }
    }

    // --- test 12: balance badge hides when balance is missing ---

    fun `test logged in account hides balance badge without balance`() {
        show(snap(profile(balance = null)))
        edt {
            assertFalse(panel.balanceVisible())
            assertNull(panel.balanceIcon())
        }
    }

    // --- test 13: balance badge updates when profile balance changes ---

    fun `test balance badge updates retained label`() {
        show(snap(profile(balance = ProfileBalanceDto(10.0))))
        edt { assertEquals("\$10.00", panel.balanceText()) }

        show(snap(profile(balance = ProfileBalanceDto(25.0))))
        edt {
            assertTrue(panel.balanceVisible())
            assertEquals("\$25.00", panel.balanceText())
        }
    }

    // --- test 14: profile button uses toolbar icon and invokes callback ---

    fun `test profile button uses profile icon and opens settings`() {
        show(snap(profile(email = "user@example.com")))
        edt {
            assertSame(AllIcons.General.User, panel.profileIcon())
            panel.clickProfile()
        }
        assertEquals(1, profileCalls)
    }

    // --- test 15: transient null profile keeps logged in balance badge ---

    fun `test transient null profile keeps logged in balance badge`() {
        show(snap(profile(balance = ProfileBalanceDto(10.0))))
        // Capture icon on EDT
        var icon: javax.swing.Icon? = null
        edt { icon = panel.balanceIcon() }

        show(AccountOverlaySnapshot(status = KiloAppStatusDto.READY, profile = null, transient = true))
        edt {
            assertTrue(panel.loggedInVisible())
            assertTrue(panel.balanceVisible())
            assertSame(icon, panel.balanceIcon())
        }
    }

    // --- test 16: non-transient null profile after login hides overlay ---

    fun `test non-transient null profile after login hides overlay`() {
        show(snap(profile(email = "user@example.com")))
        edt { assertTrue(panel.isVisible) }

        show(snap(null))
        edt { assertFalse(panel.isVisible) }
    }

    // --- test 17: account choice activation selects different org ---

    fun `test activate different org calls select callback`() {
        val selected = mutableListOf<String?>()
        val p = SessionAccountOverlay(
            select = { org -> selected.add(org) },
            profile = {},
        )
        val acme = org("org_1", "Acme")
        val prof = profile(organizations = listOf(acme), currentOrgId = null)
        edt { p.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap(prof))) }

        // Simulate selecting org_1 (different from currentOrgId = null)
        edt { p.activate(AccountChoice("org_1", "Acme")) }

        assertEquals(listOf<String?>("org_1"), selected)
    }

    fun `test activate personal calls select with null`() {
        val selected = mutableListOf<String?>()
        val p = SessionAccountOverlay(
            select = { org -> selected.add(org) },
            profile = {},
        )
        val acme = org("org_1", "Acme")
        val prof = profile(organizations = listOf(acme), currentOrgId = "org_1")
        edt { p.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap(prof))) }

        edt { p.activate(AccountChoice(null, "Personal Account")) }

        assertEquals(listOf<String?>(null), selected)
    }

    fun `test activate same account does not call select callback`() {
        val selected = mutableListOf<String?>()
        val p = SessionAccountOverlay(
            select = { org -> selected.add(org) },
            profile = {},
        )
        val acme = org("org_1", "Acme")
        val prof = profile(organizations = listOf(acme), currentOrgId = "org_1")
        edt { p.onEvent(SessionControllerEvent.AccountOverlayChanged.Show(snap(prof))) }

        // Activating the currently active org should not fire select
        edt { p.activate(AccountChoice("org_1", "Acme")) }

        assertEquals(0, selected.size)
    }
}
