package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.settings.profile.ProfileUi
import ai.kilocode.client.settings.profile.formatResetDate
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.rpc.dto.DeviceAuthDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.LoadProgressDto
import ai.kilocode.rpc.dto.ProfileBalanceDto
import ai.kilocode.rpc.dto.ProfileDto
import ai.kilocode.rpc.dto.ProfileKiloPassDto
import ai.kilocode.rpc.dto.ProfileOrganizationDto
import ai.kilocode.rpc.dto.ProfileStatusDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.Component
import java.awt.Container
import java.util.TimeZone
import javax.swing.AbstractButton
import javax.swing.JComboBox
import javax.swing.JEditorPane
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JTextField
import javax.swing.SwingConstants
import javax.swing.SwingUtilities
import javax.swing.event.ListDataEvent
import javax.swing.event.ListDataListener

@Suppress("UnstableApiUsage")
class UserProfileConfigurableTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeAppRpcApi
    private lateinit var app: KiloAppService
    private lateinit var panel: ProfileUi
    private val urls = mutableListOf<String>()

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeAppRpcApi()
        app = KiloAppService(scope, rpc)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        edt {
            panel = ProfileUi(
                profile = null,
                status = KiloAppStatusDto.READY,
                cs = scope,
                app = app,
                browse = { urls.add(it) },
            )
        }
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test login updates profile UI`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")

        edt {
            assertTrue(text(panel).contains("Not logged in"))
            buttons(panel).first { it.text == "Login with Kilo Code" }.doClick()
        }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Alice"))
            assertTrue(t, t.contains("alice@test.com"))
            assertTrue(buttons(panel).any { it.text == "Log Out" })
        }
        assertEquals(listOf("https://auth.kilo.ai/device"), urls)
    }

    fun `test logout updates profile UI`() {
        val profile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.fakeProfile = profile
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            assertTrue(buttons(panel).any { it.text == "Log Out" })
            buttons(panel).first { it.text == "Log Out" }.doClick()
        }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Not logged in"))
            assertTrue(buttons(panel).any { it.text == "Login with Kilo Code" })
        }
    }

    fun `test organization switch updates balance UI`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val personal = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            balance = ProfileBalanceDto(10.0),
        )
        val org = personal.copy(balance = ProfileBalanceDto(25.0), currentOrgId = "org_1")
        rpc.fakeProfile = personal
        rpc.orgProfiles["org_1"] = org
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = personal)
        edt { panel.update(personal, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("\$10.00"))
            val combo = combos(panel).single()
            assertEquals("Acme", combo.getItemAt(1))
            assertFalse(combo.getItemAt(1).toString().contains("admin", ignoreCase = true))
            combo.selectedIndex = 1
        }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("\$25.00"))
        }
        assertEquals(listOf("org_1"), rpc.orgSelections)
    }

    fun `test logged in profile uses compact stack and copyable email`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "MEMBER")),
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Alice"))
            assertTrue(t, t.contains("alice@test.com"))
            assertTrue(t, t.contains("BALANCE"))
            assertTrue(t, t.contains("Refresh"))
            assertFalse(t, t.contains("Active account"))
            assertFalse(t, t.contains("Organization"))

            val mail = labels(panel).filterIsInstance<JBLabel>().first { it.text == "alice@test.com" }
            assertTrue(editorPanes(mail).isNotEmpty())

            panel.setSize(800, 600)
            layout(panel)
            val logo = labelsByName(panel, "kilo.profile.logo.loggedIn").single()
            val name = labels(panel).first { it.text == "Alice" }
            val logoLoc = SwingUtilities.convertPoint(logo.parent, logo.location, panel)
            val nameLoc = SwingUtilities.convertPoint(name.parent, name.location, panel)
            assertNotNull(logo.icon)
            assertTrue(logo.icon.iconWidth > 0)
            assertTrue(logoLoc.x > nameLoc.x)

            val refresh = buttons(panel).first { it.text == "Refresh" }
            assertFalse(refresh.isContentAreaFilled)
            val card = refresh.parent
            val dash = buttons(panel).first { it.text == "Dashboard" }
            val cardLoc = SwingUtilities.convertPoint(card.parent, card.location, panel)
            val dashLoc = SwingUtilities.convertPoint(dash.parent, dash.location, panel)
            assertTrue(dashLoc.y >= cardLoc.y + card.height)
        }
    }

    fun `test personal profile shows kilo pass usage`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            balance = ProfileBalanceDto(267.59),
            kiloPass = ProfileKiloPassDto(
                currentPeriodBaseCreditsUsd = 199.0,
                currentPeriodUsageUsd = 73.27,
                currentPeriodBonusCreditsUsd = 99.5,
                nextBillingAt = "2026-07-01T00:00:00.000Z",
            ),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Kilo Pass"))
            assertTrue(t, t.contains("$73 / $199"))
            assertTrue(t, t.contains("Bonus"))
            assertTrue(t, t.contains("$99.50"))
            assertTrue(t, t.contains("Renews"))
            assertTrue(t, t.contains("Jul 1"))
            assertTrue("pass meter should be visible", panelsByName(panel, "kilo.profile.passPanel").single().isVisible)
            assertFalse(t, t.contains("Get Kilo Pass"))
        }
    }

    fun `test personal profile shows kilo pass without balance`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            kiloPass = ProfileKiloPassDto(
                currentPeriodBaseCreditsUsd = 199.0,
                currentPeriodUsageUsd = 73.27,
                currentPeriodBonusCreditsUsd = 99.5,
                nextBillingAt = "2026-07-01T00:00:00.000Z",
            ),
        )
        val updated = profile.copy(
            kiloPass = profile.kiloPass?.copy(currentPeriodUsageUsd = 88.0),
        )
        rpc.fakeProfile = updated
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Kilo Pass"))
            assertTrue(t, t.contains("$73 / $199"))
            assertTrue(t, t.contains("Jul 1"))
            assertFalse(t, t.contains("BALANCE"))
            assertTrue("pass panel should be visible", panelsByName(panel, "kilo.profile.passPanel").single().isVisible)
            buttons(panel).first { it.text == "Refresh" }.doClick()
            assertTrue(text(panel).contains("Refreshing...."))
        }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("$88 / $199"))
            assertTrue(t, t.contains("Refresh"))
        }
    }

    fun `test personal profile without kilo pass shows subscribe link`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Get Kilo Pass to add credits and earn bonuses"))
            buttons(panel).first { it.text == "Dashboard" }.doClick()
            buttons(panel).first { it.text == "Top up" }.doClick()
            buttons(panel).first { it.text == "Get Kilo Pass to add credits and earn bonuses" }.doClick()
        }

        assertEquals(listOf("https://app.kilo.ai/profile", "https://app.kilo.ai/credits", "https://kilo.ai/pricing/kilo-pass"), urls)
    }

    fun `test kilo pass renewal date uses utc`() {
        val zone = TimeZone.getDefault()
        try {
            TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
            assertEquals("Jul 1", formatResetDate("2026-07-01T00:00:00.000Z"))
        } finally {
            TimeZone.setDefault(zone)
        }
    }

    fun `test org profile hides kilo pass`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            currentOrgId = "org_1",
            balance = ProfileBalanceDto(25.0),
            kiloPass = ProfileKiloPassDto(
                currentPeriodBaseCreditsUsd = 199.0,
                currentPeriodUsageUsd = 73.27,
                currentPeriodBonusCreditsUsd = 99.5,
            ),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val t = text(panel)
            assertFalse(t, t.contains("Kilo Pass"))
            assertFalse(t, t.contains("Get Kilo Pass"))
        }
    }

    fun `test refresh updates balance UI`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            balance = ProfileBalanceDto(10.0),
        )
        val updated = profile.copy(balance = ProfileBalanceDto(25.0))
        rpc.fakeProfile = profile
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            assertTrue(text(panel).contains("\$10.00"))
            rpc.fakeProfile = updated
            buttons(panel).first { it.text == "Refresh" }.doClick()
            assertTrue(text(panel).contains("Refreshing...."))
        }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("\$25.00"))
            assertTrue(t, t.contains("Refresh"))
            assertFalse(t, t.contains("Refreshing...."))
            assertTrue(buttons(panel).first { it.text == "Refresh" }.isEnabled)
        }
    }

    fun `test logged out update retains login button`() {
        edt {
            val btn = buttons(panel).first { it.text == "Login with Kilo Code" }
            panel.update(null, KiloAppStatusDto.READY)
            val btn2 = buttons(panel).first { it.text == "Login with Kilo Code" }
            assertSame(btn, btn2)
        }
    }

    fun `test logged out profile shows kilo icon above login content`() {
        edt {
            panel.update(null, KiloAppStatusDto.READY)
            panel.setSize(800, 600)
            layout(panel)

            val logo = labelsByName(panel, "kilo.profile.logo.loggedOut").single()
            val label = labels(panel).first { it.text == "Not logged in" }
            val btn = buttons(panel).first { it.text == "Login with Kilo Code" }
            val logoLoc = SwingUtilities.convertPoint(logo.parent, logo.location, panel)
            val labelLoc = SwingUtilities.convertPoint(label.parent, label.location, panel)
            val btnLoc = SwingUtilities.convertPoint(btn.parent, btn.location, panel)

            assertTrue(visible(logo))
            assertNotNull(logo.icon)
            assertTrue(logo.icon.iconWidth > 0)
            assertTrue(logo.icon.iconHeight > 0)
            assertTrue(logoLoc.y < labelLoc.y)
            assertTrue(labelLoc.y < btnLoc.y)
        }
    }

    fun `test account update retains name label`() {
        val alice = ProfileDto(email = "alice@test.com", name = "Alice")
        val bob = ProfileDto(email = "bob@test.com", name = "Bob")
        edt {
            panel.update(alice, KiloAppStatusDto.READY)
            val lbl = labels(panel).first { it.text == "Alice" }
            panel.update(bob, KiloAppStatusDto.READY)
            val lbl2 = labels(panel).first { it.text == "Bob" }
            assertSame(lbl, lbl2)
        }
    }

    fun `test organization switch retains combo`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val personal = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            balance = ProfileBalanceDto(10.0),
        )
        val org = personal.copy(balance = ProfileBalanceDto(25.0), currentOrgId = "org_1")
        rpc.fakeProfile = personal
        rpc.orgProfiles["org_1"] = org
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = personal)

        edt { panel.update(personal, KiloAppStatusDto.READY) }

        val captured = edt { combos(panel).single() }

        edt { captured.selectedIndex = 1 }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("\$25.00"))
            val same = combos(panel).single()
            assertSame(captured, same)
            assertEquals(1, same.selectedIndex)
        }
    }

    fun `test organization switch keeps account visible during transient null profile`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val personal = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = personal)

        // A transient null profile update with PENDING progress (e.g. mid-switch state from collector)
        // must keep the logged-in card visible and not reset combo selection.
        val transientState = KiloAppStateDto(
            status = KiloAppStatusDto.READY,
            profile = null,
            progress = LoadProgressDto(profile = ProfileStatusDto.PENDING),
        )

        edt {
            panel.update(personal, KiloAppStatusDto.READY)
            // Simulate user switching org — sets selectedIndex to 1
            combos(panel).single().selectedIndex = 1
            // State-collector fires a transient null before RPC completes
            panel.update(transientState)

            val t = text(panel)
            assertTrue(t, t.contains("Alice"))
            assertFalse(t, t.contains("Not logged in"))
            // Combo selection must not be reset by the transient update
            assertEquals(1, combos(panel).single().selectedIndex)
        }
    }

    fun `test login shows device auth card before completion`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt {
            buttons(panel).first { it.text == "Login with Kilo Code" }.doClick()
        }

        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Sign in to Kilo Code"))
            assertTrue(t, t.contains("Step 1:"))
            assertTrue(t, t.contains("Open this URL"))
            assertTrue(t, t.contains("https://auth.kilo.ai/device"))
            assertTrue(t, t.contains("Open Browser"))
            assertTrue(t, t.contains("Step 2:"))
            assertTrue(t, t.contains("Enter this code"))
            assertTrue(t, t.contains("Waiting for authorization..."))
            assertTrue(t, t.contains("Cancel"))
        }

        // QR label should have an icon
        edt {
            val qr = labelsByName(panel, "kilo.login.qr").firstOrNull()
            assertNotNull(qr)
            assertNotNull(qr!!.icon)
        }

        assertEquals(listOf("https://auth.kilo.ai/device"), urls)

        // Complete login
        edt { rpc.completeGate!!.complete(Unit) }
        flushUntil { text(panel).contains("Alice") }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Alice"))
            assertTrue(t, t.contains("alice@test.com"))
            assertTrue(buttons(panel).any { it.text == "Log Out" })
        }
    }

    fun `test cancel login invalidates stale completion`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        // Click Cancel
        edt { buttons(panel).first { it.text == "Cancel" }.doClick() }
        flush()

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Not logged in"))
            assertTrue(buttons(panel).any { it.text == "Login with Kilo Code" })
        }

        // Now complete the gate — the stale result should be ignored
        rpc.fakeProfile = ProfileDto(email = "stale@test.com", name = "Stale")
        edt { rpc.completeGate!!.complete(Unit) }
        flush()

        edt {
            val t = text(panel)
            assertFalse(t, t.contains("Stale"))
            assertTrue(t, t.contains("Not logged in"))
        }
    }

    fun `test login failure shows retry`() {
        rpc.startError = IllegalStateException("HTTP 500 <!doctype html><body>Internal Server Error</body>")

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Login failed") }

        edt {
            val t = text(panel)
            assertTrue(t, t.contains("Login failed"))
            assertTrue(buttons(panel).any { it.text == "Try Again" })
        }
    }

    fun `test auth card retains qr label across sync`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        val qrBefore = edt { labelsByName(panel, "kilo.login.qr").firstOrNull() }
        assertNotNull(qrBefore)

        // Force another sync call while still pending
        edt { panel.update(null, KiloAppStatusDto.READY) }
        flush()

        val qrAfter = edt { labelsByName(panel, "kilo.login.qr").firstOrNull() }
        assertNotNull(qrAfter)
        assertSame(qrBefore, qrAfter)

        edt { rpc.completeGate!!.complete(Unit) }
        flush()
    }

    fun `test auth card step labels are present`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        edt {
            val t = text(panel)
            // Step labels are now SimpleColoredComponent with bold "Step N:" + grayed suffix
            assertTrue("Step 1 label not found", t.contains("Step 1:"))
            assertTrue("Step 1 url text not found", t.contains("Open this URL"))
            assertTrue("Step 2 label not found", t.contains("Step 2:"))
            assertTrue("Step 2 code text not found", t.contains("Enter this code"))
        }

        edt { rpc.completeGate!!.complete(Unit) }
        flush()
    }

    fun `test url field selects all on click`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        edt {
            val field = fieldsByName(panel, "kilo.login.url").firstOrNull()
            assertNotNull("URL field not found", field)
            // Verify the field has focus/mouse listeners wired for selectAll
            assertTrue("URL field should have focus listeners", field!!.focusListeners.isNotEmpty())
            assertTrue("URL field should have mouse listeners", field.mouseListeners.isNotEmpty())
        }

        edt { rpc.completeGate!!.complete(Unit) }
        flush()
    }

    fun `test balance card has card background`() {
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        edt {
            val card = panelsByName(panel, "kilo.profile.balanceCard").firstOrNull()
            assertNotNull("Balance card not found", card)
            assertFalse("Balance card should paint its own rounded background", card!!.isOpaque)
            assertNotNull("Balance card background should not be null", card.background)
            val inner = panels(card).filter { it !== card }
            assertTrue("Balance card internals should be transparent", inner.all { !it.isOpaque })
        }
    }

    fun `test code panel has card background`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        edt {
            val codePanel = panelsByName(panel, "kilo.login.codePanel").firstOrNull()
            assertNotNull("Code panel not found", codePanel)
            assertFalse("Code panel should paint its own rounded background", codePanel!!.isOpaque)
            assertNotNull("Code panel background should not be null", codePanel.background)
        }

        edt { rpc.completeGate!!.complete(Unit) }
        flush()
    }

    fun `test combo model not rebuilt when org list unchanged during switch`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val personal = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            balance = ProfileBalanceDto(10.0),
        )
        val switched = personal.copy(balance = ProfileBalanceDto(25.0), currentOrgId = "org_1")
        rpc.fakeProfile = personal
        rpc.orgProfiles["org_1"] = switched
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = personal)
        edt { panel.update(personal, KiloAppStatusDto.READY) }

        val combo = edt { combos(panel).single() }

        // Track any removals from the model
        var removals = 0
        edt {
            combo.model.addListDataListener(object : ListDataListener {
                override fun intervalAdded(e: ListDataEvent) {}
                override fun intervalRemoved(e: ListDataEvent) { removals++ }
                override fun contentsChanged(e: ListDataEvent) {}
            })
        }

        // Switch org — same org list, only balance and currentOrgId change
        edt { combo.selectedIndex = 1 }
        flush()

        edt {
            // Combo should reflect org selection
            assertEquals(1, combos(panel).single().selectedIndex)
            // Same combo instance retained
            assertSame(combo, combos(panel).single())
            // Model should never have been cleared — org list is identical
            assertEquals("combo model should not be cleared for unchanged org list", 0, removals)
        }
    }

    fun `test combo model not rebuilt on balance change with same org list`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            currentOrgId = "org_1",
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        val combo = edt { combos(panel).single() }

        var removals = 0
        edt {
            combo.model.addListDataListener(object : ListDataListener {
                override fun intervalAdded(e: ListDataEvent) {}
                override fun intervalRemoved(e: ListDataEvent) { removals++ }
                override fun contentsChanged(e: ListDataEvent) {}
            })
        }

        // Update with same orgs but different balance — model should not be rebuilt
        val updated = profile.copy(balance = ProfileBalanceDto(99.0))
        edt { panel.update(updated, KiloAppStatusDto.READY) }

        edt {
            assertEquals("removals should be 0 for unchanged org list", 0, removals)
            assertEquals("selection should remain at org_1 index", 1, combos(panel).single().selectedIndex)
            assertTrue(text(panel).contains("\$99.00"))
        }
    }

    fun `test combo model updated in place when org list changes`() {
        val orgs1 = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val orgs2 = listOf(
            ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"),
            ProfileOrganizationDto(id = "org_2", name = "Beta", role = "MEMBER"),
        )
        val profile1 = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs1,
            currentOrgId = "org_1",
        )
        val profile2 = profile1.copy(organizations = orgs2, currentOrgId = "org_2")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile1)
        edt { panel.update(profile1, KiloAppStatusDto.READY) }

        val combo = edt { combos(panel).single() }
        // Track that the model was never emptied (no removeAllElements-style full clear)
        var minSizeDuringUpdate = Int.MAX_VALUE
        edt {
            combo.model.addListDataListener(object : ListDataListener {
                override fun intervalAdded(e: ListDataEvent) {
                    minSizeDuringUpdate = minOf(minSizeDuringUpdate, combo.model.size)
                }
                override fun intervalRemoved(e: ListDataEvent) {
                    minSizeDuringUpdate = minOf(minSizeDuringUpdate, combo.model.size)
                }
                override fun contentsChanged(e: ListDataEvent) {}
            })
        }

        edt { panel.update(profile2, KiloAppStatusDto.READY) }

        edt {
            val c = combos(panel).single()
            // Same combo instance retained — never replaced
            assertSame(combo, c)
            // 3 items: personal + org_1 + org_2
            assertEquals(3, c.itemCount)
            assertEquals("Beta", c.getItemAt(2))
            // Selection is at org_2
            assertEquals(2, c.selectedIndex)
            // Model was never fully emptied during the update
            assertTrue(
                "combo model must never become empty during org list change",
                minSizeDuringUpdate > 0,
            )
        }
    }

    fun `test profile update does not trigger organization rpc`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            currentOrgId = "org_1",
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }
        edt { panel.update(profile.copy(currentOrgId = "org_1"), KiloAppStatusDto.READY) }
        flush()
        assertTrue(rpc.orgSelections.isEmpty())
    }

    fun `test connecting while logged in keeps logged-in card visible`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        // Simulate reconnect: CONNECTING with null profile (CLI restarting)
        edt { panel.update(null, KiloAppStatusDto.CONNECTING) }

        edt {
            val t = text(panel)
            assertTrue("logged-in card must stay visible during reconnect", t.contains("Alice"))
            assertFalse("logged-out card must not show during reconnect", t.contains("Not logged in"))
            // combo selection must be retained
            assertEquals(0, combos(panel).single().selectedIndex)
        }
    }

    fun `test loading while logged in keeps logged-in card visible`() {
        val profile = ProfileDto(email = "alice@test.com", name = "Alice")
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        // Simulate org switch in progress: LOADING with profile cleared
        edt { panel.update(null, KiloAppStatusDto.LOADING) }

        edt {
            val t = text(panel)
            assertTrue("logged-in card must stay visible during loading", t.contains("Alice"))
            assertFalse("logged-out card must not show during loading", t.contains("Not logged in"))
        }
    }

    fun `test loading with null profile while logged in does not crash`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            currentOrgId = "org_1",
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt { panel.update(profile, KiloAppStatusDto.READY) }

        // Account switch: backend emits LOADING state with no profile yet
        // Must not throw NullPointerException on account.update(prof!!)
        edt { panel.update(KiloAppStateDto(KiloAppStatusDto.LOADING)) }

        edt {
            // Logged-in card stays, stale content still shown until new profile arrives
            val t = text(panel)
            assertTrue("logged-in card must stay visible", t.contains("Alice"))
            assertFalse("must not flip to logged-out", t.contains("Not logged in"))
            assertEquals("combo selection must be retained", 1, combos(panel).single().selectedIndex)
        }

        // Profile arrives — UI updates with new data
        val switched = profile.copy(currentOrgId = null, balance = ProfileBalanceDto(5.0))
        edt { panel.update(switched, KiloAppStatusDto.READY) }

        edt {
            assertTrue(text(panel).contains("\$5.00"))
        }
    }

    fun `test connecting while logged in with org selected keeps combo selection`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
            currentOrgId = "org_1",
            balance = ProfileBalanceDto(10.0),
        )
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, profile = profile)
        edt {
            panel.update(profile, KiloAppStatusDto.READY)
            combos(panel).single().selectedIndex = 1
        }

        edt { panel.update(null, KiloAppStatusDto.CONNECTING) }

        edt {
            val t = text(panel)
            assertTrue("logged-in card must stay visible", t.contains("Alice"))
            assertEquals("combo selection must not reset during reconnect", 1, combos(panel).single().selectedIndex)
        }
    }

    fun `test preferred focus for logged-in is combo when visible`() {
        val orgs = listOf(ProfileOrganizationDto(id = "org_1", name = "Acme", role = "ADMIN"))
        val profile = ProfileDto(
            email = "alice@test.com",
            name = "Alice",
            organizations = orgs,
        )
        edt {
            panel.update(profile, KiloAppStatusDto.READY)
            val focus = panel.preferredFocus()
            assertTrue("preferred focus should be combo for logged-in with orgs", focus is javax.swing.JComboBox<*>)
        }
    }

    fun `test preferred focus for logged-out is login button`() {
        edt {
            val focus = panel.preferredFocus()
            val loginBtn = buttons(panel).firstOrNull { it.text == "Login with Kilo Code" }
            assertNotNull("login button not found", loginBtn)
            assertSame("preferred focus should be login button for logged-out", loginBtn, focus)
        }
    }

    fun `test dispose during login invalidates stale completion`() {
        rpc.fakeProfile = ProfileDto(email = "stale@test.com", name = "Stale")
        rpc.completeGate = CompletableDeferred()

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        // Dispose while login is in progress
        edt { panel.dispose() }
        flush()

        // Complete the gate — stale result should be ignored
        edt { rpc.completeGate!!.complete(Unit) }
        flush()

        edt {
            val t = text(panel)
            // After dispose, stale login should not update UI to logged-in state.
            // The panel is disposed and attempt counter incremented, so completion is ignored.
            assertFalse("stale login must not show logged-in state after dispose", t.contains("Stale"))
        }
    }

    fun `test device auth without code hides code panel and step2 label`() {
        rpc.fakeProfile = ProfileDto(email = "alice@test.com", name = "Alice")
        rpc.completeGate = CompletableDeferred()
        // Set device auth response without a code
        rpc.fakeDeviceAuth = DeviceAuthDto(code = null, verificationUrl = "https://auth.kilo.ai/device")

        edt { buttons(panel).first { it.text == "Login with Kilo Code" }.doClick() }
        flushUntil { text(panel).contains("Sign in to Kilo Code") }

        edt {
            // Code panel should be hidden when no code is provided
            val codePanel = panelsByName(panel, "kilo.login.codePanel").firstOrNull()
            assertNotNull("Code panel should exist", codePanel)
            assertFalse("Code panel should be hidden when no code", codePanel!!.isVisible)
        }

        edt { rpc.completeGate!!.complete(Unit) }
        flush()
    }

    // -- helpers --

    private fun flushUntil(timeoutMs: Long = 3000, condition: () -> Boolean) = runBlocking {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!edt { condition() }) {
            if (System.currentTimeMillis() > deadline) fail("flushUntil timed out after ${timeoutMs}ms")
            delay(50)
            edt { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun labelsByName(root: Container, name: String): List<JLabel> = buildList {
        for (comp in root.components) {
            if (comp is JLabel && comp.name == name) add(comp)
            if (comp is Container) addAll(labelsByName(comp, name))
        }
    }

    private fun fieldsByName(root: Container, name: String): List<JTextField> = buildList {
        for (comp in root.components) {
            if (comp is JTextField && comp.name == name) add(comp)
            if (comp is Container) addAll(fieldsByName(comp, name))
        }
    }

    private fun panelsByName(root: Container, name: String): List<JPanel> = buildList {
        for (comp in root.components) {
            if (comp is JPanel && comp.name == name) add(comp)
            if (comp is Container) addAll(panelsByName(comp, name))
        }
    }

    private fun panels(root: Container): List<JPanel> = buildList {
        if (root is JPanel) add(root)
        for (comp in root.components) {
            if (comp is Container) addAll(panels(comp))
        }
    }

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun flush() = runBlocking {
        repeat(5) {
            delay(100)
            edt { UIUtil.dispatchAllInvocationEvents() }
        }
    }

    private fun visible(comp: Component): Boolean =
        comp.isVisible && (comp.parent?.let(::visible) ?: true)

    private fun buttons(root: Container): List<AbstractButton> = buildList {
        for (comp in root.components) {
            if (!comp.isVisible) continue
            if (comp is AbstractButton) add(comp)
            if (comp is Container) addAll(buttons(comp))
        }
    }

    private fun combos(root: Container): List<JComboBox<*>> = buildList {
        for (comp in root.components) {
            if (!comp.isVisible) continue
            if (comp is JComboBox<*>) add(comp)
            if (comp is Container) addAll(combos(comp))
        }
    }

    private fun labels(root: Container): List<JLabel> = buildList {
        for (comp in root.components) {
            if (!comp.isVisible) continue
            if (comp is JLabel) add(comp)
            if (comp is Container) addAll(labels(comp))
        }
    }

    private fun layout(root: Container) {
        root.doLayout()
        for (comp in root.components) {
            if (comp is Container) layout(comp)
        }
    }

    private fun editorPanes(root: Container): List<JEditorPane> = buildList {
        for (comp in root.components) {
            if (!comp.isVisible) continue
            if (comp is JEditorPane) add(comp)
            if (comp is Container) addAll(editorPanes(comp))
        }
    }

    private fun text(root: Container): String {
        val acc = mutableListOf<String>()
        collectText(root, acc)
        return acc.joinToString("\n")
    }

    private fun collectText(root: Container, acc: MutableList<String>) {
        for (comp in root.components) {
            if (!comp.isVisible) continue
            when (comp) {
                is AbstractButton -> comp.text?.let { acc.add(it) }
                is JEditorPane -> comp.text?.let { acc.add(it) }
                is JLabel -> comp.text?.let { acc.add(it) }
                is JTextField -> comp.text?.let { acc.add(it) }
                is SimpleColoredComponent -> {
                    val t = comp.toString()
                    if (t.isNotEmpty()) acc.add(t)
                }
            }
            if (comp is Container) collectText(comp, acc)
        }
    }
}
