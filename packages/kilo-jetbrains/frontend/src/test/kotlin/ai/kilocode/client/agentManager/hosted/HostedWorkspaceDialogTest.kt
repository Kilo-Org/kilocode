package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentsDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.HostedFailureDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ModelsWorkspaceDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.rpc.dto.ProvidersDto
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.platform.ide.progress.runWithModalProgressBlocking
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBPanel
import com.intellij.ui.components.JBTextField
import com.intellij.ui.tabs.JBTabs
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.awt.Component
import java.awt.Container
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JList

class HostedWorkspaceDialogTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var workspaces: KiloWorkspaceService
    private lateinit var selection: FakeHostedProfileSelectionStore
    private var dialog: HostedWorkspaceDialog? = null
    private val profileItems = listOf(
        HostedWorkspaceProfileDto("profile-dev", "Standard", ownerType = "user"),
        HostedWorkspaceProfileDto("profile-prod", "Standard", ownerType = "organization"),
    )
    private val profiles = HostedWorkspaceProfileListDto(items = profileItems)

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        appRpc = FakeAppRpcApi().apply {
            models = ModelStateDto(favorite = listOf(
                ModelSelectionDto("kilo", "gpt-5"),
                ModelSelectionDto("openai", "local"),
                ModelSelectionDto("kilo", "opus"),
            ))
        }
        app = KiloAppService(coroutines.scope, appRpc)
        app._state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto())
        app.refreshModelFavoritesAsync()
        coroutines.drain()
        rpc = FakeWorkspaceRpcApi().apply { models = catalog() }
        workspaces = KiloWorkspaceService(coroutines.scope, rpc)
        selection = FakeHostedProfileSelectionStore()
        KiloPluginSettings.unsetAgent()
        KiloPluginSettings.unsetFetchWorktreeBase()
    }

    override fun tearDown() {
        try {
            edt {
                dialog?.takeUnless { it.isDisposed }?.let { Disposer.dispose(it.disposable) }
            }
            dialog = null
            coroutines.close()
            KiloPluginSettings.unsetAgent()
            KiloPluginSettings.unsetGithub()
            KiloPluginSettings.unsetFetchWorktreeBase()
        } finally {
            super.tearDown()
        }
    }

    fun `test prompt fills the dialog center`() {
        open()
        ready()
        edt { assertPromptCentered() }
    }

    fun `test default cloud selections create a plan with an optional blank branch`() {
        open()
        ready()

        edt {
            assertTrue(prompt().mode.text.contains("Build"))
            assertTrue(prompt().model.text.contains("GPT-5"))
            assertTrue(prompt().reasoning.isVisible)
            assertTrue(prompt().reasoning.text.contains("Low"))
            branch().text = "  "
            submit()
        }

        assertEquals(
            HostedCreatePlan("Build cloud feature", null, null, "build", "kilo/gpt-5", "low"),
            created(),
        )
    }

    fun `test no profile default leaves no profile selected`() {
        open()
        ready()

        edt {
            assertEquals(0, profile().selectedIndex)
            assertSame(profile().getItemAt(0), profile().selectedItem)
            assertNull(requireNotNull(dialog).validationForTest())
            assertTrue(okButton().isEnabled)
            profile().selectedIndex = 2
            assertTrue(okButton().isEnabled)
            submit()
        }

        assertEquals("profile-prod", created().profileID)
    }

    fun `test dialog loads profiles in the background without blocking the prompt`() {
        val gate = CompletableDeferred<HostedWorkspaceProfileListDto>()
        open(load = { gate.await() })
        edt { prompt().setText("Type while profiles load") }
        assertTrue(coroutines.pumpUntil { edt { prompt().model.text.contains("GPT-5") } })

        edt {
            modal {
                assertFalse(profile().isEnabled)
                assertEquals(
                    KiloBundle.message("hosted.workspace.dialog.profile.loading"),
                    cell(requireNotNull(profile().selectedItem), -1),
                )
                assertFalse(okButton().isEnabled)
                assertFalse(prompt().isSendEnabled)
                branch().text = "feature/background"
                prompt().send()
                rejected()

                gate.complete(profiles.copy(items = profileItems.mapIndexed { index, item ->
                    item.copy(isPersonalDefault = index == 0)
                }))
                assertTrue("Profiles must finish loading while the dialog is modal", coroutines.pumpUntil(pump = ::pump) {
                    profile().isEnabled
                })
                assertEquals("profile-dev", (profile().selectedItem as HostedWorkspaceProfileDto).id)
                assertEquals("Type while profiles load", prompt().text())
                assertEquals("feature/background", branch().text)
                assertTrue(okButton().isEnabled)
                assertTrue(prompt().isSendEnabled)
                assertEquals(
                    KiloBundle.message("hosted.workspace.dialog.profile.personalDefault", "Standard"),
                    cell(requireNotNull(profile().selectedItem), -1),
                )
            }
        }
    }

    fun `test failed profile loading stays visible and prevents creation`() {
        val gate = CompletableDeferred<HostedWorkspaceProfileListDto>()
        open(load = { gate.await() })
        edt { prompt().setText("Create cloud workspace") }
        assertTrue(coroutines.pumpUntil { edt { prompt().model.text.contains("GPT-5") } })

        edt {
            modal {
                gate.complete(HostedWorkspaceProfileListDto(error = HostedFailureDto("unavailable", "Profiles failed")))
                assertTrue("Profile load failures must be visible while modal", coroutines.pumpUntil(pump = ::pump) {
                    requireNotNull(dialog).validationForTest()?.message == "Profiles failed"
                })
                assertFalse(profile().isEnabled)
                assertEquals(
                    KiloBundle.message("hosted.workspace.profiles.failed"),
                    cell(requireNotNull(profile().selectedItem), -1),
                )
                prompt().setText("Another prompt")
                assertEquals("Profiles failed", requireNotNull(dialog).validationForTest()?.message)
                assertTrue(controls().filterIsInstance<JLabel>().any { it.text?.contains("Profiles failed") == true })
                assertFalse(okButton().isEnabled)
                prompt().send()
                rejected()
            }
        }
    }

    fun `test profiles loading first does not enable creation before the model catalog arrives`() {
        val gate = CompletableDeferred<Unit>()
        rpc.modelsGate = gate
        open(profiles = profiles.copy(items = profileItems.mapIndexed { index, item ->
            item.copy(isPersonalDefault = index == 0)
        }))

        edt {
            modal {
                prompt().setText("Wait for cloud models")
                assertTrue(profile().isEnabled)
                assertEquals("profile-dev", (profile().selectedItem as HostedWorkspaceProfileDto).id)
                assertFalse(okButton().isEnabled)
                assertFalse(prompt().isSendEnabled)

                gate.complete(Unit)
                assertTrue("Model loading must complete while the dialog is modal", coroutines.pumpUntil(pump = ::pump) {
                    prompt().isSendEnabled && okButton().isEnabled
                })
                assertEquals("profile-dev", (profile().selectedItem as HostedWorkspaceProfileDto).id)
                assertEquals("Wait for cloud models", prompt().text())
            }
        }
    }

    fun `test closing the dialog cancels profile loading`() {
        val started = CompletableDeferred<Unit>()
        val stopped = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<HostedWorkspaceProfileListDto>()
        open(load = {
            started.complete(Unit)
            try {
                gate.await()
            } finally {
                stopped.complete(Unit)
            }
        })
        assertTrue("Profile loading did not start", coroutines.pumpUntil { started.isCompleted })
        val closed = requireNotNull(dialog)
        edt { closed.doCancelAction() }
        assertTrue("Profile loading must be cancelled with the dialog", coroutines.pumpUntil { stopped.isCompleted })
        edt {
            assertTrue(closed.isDisposed)
            assertNull(closed.plan())
        }
    }

    fun `test closing the dialog cancels repository preference loading`() {
        val started = CompletableDeferred<Unit>()
        val stopped = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<String?>()
        val selection = object : HostedProfileSelectionStore {
            override suspend fun selected(repositoryUrl: String): String? {
                started.complete(Unit)
                return try {
                    gate.await()
                } finally {
                    stopped.complete(Unit)
                }
            }

            override fun remember(
                repositoryUrl: String,
                selectedProfileID: String?,
                backendDefaultProfileID: String?,
            ) = Unit
        }
        open(load = { profiles }, selection = selection)
        assertTrue("Preference loading did not start", coroutines.pumpUntil { started.isCompleted })
        val closed = requireNotNull(dialog)

        edt { closed.doCancelAction() }

        assertTrue("Preference loading must be cancelled with the dialog", coroutines.pumpUntil { stopped.isCompleted })
        edt { assertTrue(closed.isDisposed) }
    }

    fun `test organization default profile is preselected before personal default`() {
        open(profiles = profiles.copy(items = profileItems.mapIndexed { index, item ->
            item.copy(isPersonalDefault = index == 0, isOrganizationDefault = index == 1)
        }))

        edt {
            assertEquals(2, profile().selectedIndex)
            assertEquals("profile-prod", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertEquals(
                KiloBundle.message("hosted.workspace.dialog.profile.personalDefault", "Standard"),
                cell(profileItems[0], 1),
            )
            assertEquals(
                KiloBundle.message("hosted.workspace.dialog.profile.organizationDefault", "Standard"),
                cell(profileItems[1], 2),
            )
            assertFalse(useDefault().isVisible)
        }
    }

    fun `test organization default profile is preselected without a personal default`() {
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))

        edt {
            assertEquals(2, profile().selectedIndex)
            assertEquals("profile-prod", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertFalse(useDefault().isVisible)
        }
    }

    fun `test personal effective and legacy defaults are used as fallbacks`() {
        val cases = listOf(
            profiles.copy(personalDefaultProfileID = "profile-dev") to "profile-dev",
            profiles.copy(effectiveDefaultProfileID = "profile-prod") to "profile-prod",
            profiles.copy(items = profileItems.mapIndexed { index, item -> item.copy(isDefault = index == 0) }) to
                "profile-dev",
        )

        cases.forEachIndexed { index, (loaded, id) ->
            if (index > 0) {
                edt { Disposer.dispose(requireNotNull(dialog).disposable) }
                dialog = null
            }
            open(profiles = loaded)
            edt { assertEquals(id, (profile().selectedItem as HostedWorkspaceProfileDto).id) }
        }
    }

    fun `test organization and personal profiles can create workspaces`() {
        open()
        ready()

        edt {
            profile().selectedIndex = 2
            submit()
        }

        assertEquals("profile-prod", created().profileID)
    }

    fun `test profile flags preselect and label defaults without list defaults`() {
        val flagged = listOf(
            HostedWorkspaceProfileDto("profile-dev", "Cloud Agent", isPersonalDefault = true),
            HostedWorkspaceProfileDto("profile-prod", "Cloud Team", isOrganizationDefault = true),
        )
        open(profiles = HostedWorkspaceProfileListDto(items = flagged))

        edt {
            assertEquals(2, profile().selectedIndex)
            assertEquals("profile-prod", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertEquals(
                KiloBundle.message("hosted.workspace.dialog.profile.personalDefault", "Cloud Agent"),
                cell(flagged[0], 0),
            )
            assertEquals(
                KiloBundle.message("hosted.workspace.dialog.profile.organizationDefault", "Cloud Team"),
                cell(flagged[1], 1),
            )
            assertFalse(useDefault().isVisible)
        }
    }

    fun `test remembered repository profile overrides the backend default after loading`() {
        selection.value = "profile-dev"
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))

        edt {
            assertEquals("profile-dev", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertTrue(useDefault().isVisible)
        }
        assertEquals(listOf("https://github.com/kilo-org/kilocode.git"), selection.reads)
    }

    fun `test stale repository profile falls back to the backend default`() {
        selection.value = "missing-profile"
        open(profiles = profiles.copy(
            organizationDefaultProfileID = "profile-prod",
            personalDefaultProfileID = "profile-dev",
        ))

        edt {
            assertEquals("profile-prod", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertFalse(useDefault().isVisible)
        }
    }

    fun `test repository preference failure falls back to the backend default`() {
        selection.error = IllegalStateException("Preference backend unavailable")
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))
        ready()

        edt {
            assertTrue(profile().isEnabled)
            assertEquals("profile-prod", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertFalse(useDefault().isVisible)
            assertNull(requireNotNull(dialog).validationForTest())
        }
    }

    fun `test accepted creation remembers the selected profile against the backend default`() {
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))
        ready()

        edt {
            profile().selectedIndex = 1
            submit()
        }
        created()

        assertEquals(
            listOf(FakeHostedProfileSelectionStore.Save(
                "https://github.com/kilo-org/kilocode.git",
                "profile-dev",
                "profile-prod",
            )),
            selection.saves,
        )
    }

    fun `test accepting the backend default clears a remembered repository override`() {
        selection.value = "profile-dev"
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))
        ready()

        edt {
            useDefault().doClick()
            submit()
        }
        created()

        assertEquals(
            listOf(FakeHostedProfileSelectionStore.Save(
                "https://github.com/kilo-org/kilocode.git",
                "profile-prod",
                "profile-prod",
            )),
            selection.saves,
        )
    }

    fun `test cancelled selection does not update the repository preference`() {
        open(profiles = profiles.copy(organizationDefaultProfileID = "profile-prod"))

        edt {
            profile().selectedIndex = 1
            requireNotNull(dialog).doCancelAction()
        }

        assertTrue(selection.saves.isEmpty())
    }

    fun `test prompt uses a standard dialog border`() {
        open()
        ready()

        edt {
            assertEquals(JBUI.scale(1), prompt().insets.top)
            assertEquals(JBUI.scale(1), prompt().insets.left)
            assertEquals(JBUI.scale(1), prompt().insets.bottom)
            assertEquals(JBUI.scale(1), prompt().insets.right)
        }
    }

    fun `test profile actions use the standard button gap`() {
        open(profiles = profiles.copy(items = profileItems.mapIndexed { index, item ->
            item.copy(isPersonalDefault = index == 0)
        }))
        ready()

        edt {
            profile().selectedIndex = 2
            val links = controls().filterIsInstance<Stack>().single()
            assertEquals(UiStyle.Gap.pad(), links.space)
            assertEquals(listOf(useDefault()), links.components.toList())
        }
    }

    fun `test use default returns to the personal default`() {
        open(profiles = profiles.copy(items = profileItems.mapIndexed { index, item ->
            item.copy(isPersonalDefault = index == 0)
        }))

        edt {
            assertFalse(useDefault().isVisible)
            profile().selectedIndex = 2
            assertTrue(useDefault().isVisible)
            useDefault().doClick()
            assertEquals(1, profile().selectedIndex)
            assertEquals("profile-dev", (profile().selectedItem as HostedWorkspaceProfileDto).id)
            assertFalse(useDefault().isVisible)
        }
    }

    fun `test prompt send retains chosen mode model reasoning branch and profile ID`() {
        open(branch = "seed/branch")
        ready("  Implement cloud changes\nwith tests  ")
        edt {
            assertEquals("seed/branch", branch().text)
            branch().text = "  feature/cloud  "
            profile().selectedIndex = 2
            prompt().mode.cycle()
            prompt().model.cycle()
        }
        coroutines.drain()
        edt { prompt().reasoning.cycle() }
        coroutines.drain()

        edt {
            assertTrue(prompt().mode.text.contains("Plan"))
            assertTrue(prompt().model.text.contains("Opus"))
            assertTrue(prompt().reasoning.text.contains("Max"))
            prompt().send()
        }

        assertEquals(
            HostedCreatePlan(
                "Implement cloud changes\nwith tests", "feature/cloud", "profile-prod", "plan", "kilo/opus", "max",
            ),
            created(),
        )
        assertNull(KiloPluginSettings.getAgent())
        assertEmpty(appRpc.configPatches)
    }

    fun `test empty prompt creates a cloud workspace plan`() {
        open()
        ready()
        edt { prompt().setText("") }

        assertTrue("Empty prompt must be allowed for workspace creation", coroutines.pumpUntil {
            edt { requireNotNull(dialog).validationForTest() == null }
        })
        edt { submit() }
        assertEquals("", created().prompt)
    }

    fun `test remembered cloud mode model and valid saved reasoning are used`() {
        KiloPluginSettings.setAgent("plan")
        app.selectModel("plan", "kilo", "opus")
        coroutines.drain()
        app.selectVariant("kilo/opus", "max")
        coroutines.drain()
        open()
        ready()

        edt {
            assertTrue(prompt().mode.text.contains("Plan"))
            assertTrue(prompt().model.text.contains("Opus"))
            assertTrue(prompt().reasoning.text.contains("Max"))
            submit()
        }

        val plan = created()
        assertEquals("plan", plan.agent)
        assertEquals("kilo/opus", plan.model)
        assertEquals("max", plan.variant)
    }

    fun `test invalid saved reasoning submits the visible valid fallback`() {
        app.selectVariant("kilo/gpt-5", "removed")
        coroutines.drain()
        open()
        ready()

        edt {
            assertTrue(prompt().reasoning.text.contains("Low"))
            submit()
        }

        assertEquals("low", created().variant)
    }

    fun `test a cloud model without reasoning does not forward a stale variant`() {
        val providers = requireNotNull(rpc.models.providers)
        rpc.models = rpc.models.copy(providers = providers.copy(providers = providers.providers.map { provider ->
            if (provider.id != "kilo") return@map provider
            provider.copy(models = mapOf("gpt-5" to ModelDto("gpt-5", "GPT-5")))
        }))
        app.selectVariant("kilo/gpt-5", "removed")
        coroutines.drain()
        open()
        ready()

        edt {
            assertFalse(prompt().reasoning.isVisible)
            submit()
        }

        assertNull(created().variant)
    }

    fun `test local BYOK saved models and favorites never enter the cloud model catalog`() {
        app.selectModel("build", "openai", "local")
        coroutines.drain()
        open()
        ready()

        edt { assertTrue(prompt().model.text.contains("GPT-5")) }
        assertEquals(ModelSelectionDto("openai", "local"), app.models.value.model["build"])
        for (id in listOf("opus", "gpt-5", "opus")) {
            edt { prompt().model.cycle() }
            coroutines.drain()
            assertEquals(ModelSelectionDto("kilo", id), app.models.value.model["build"])
        }
        edt { submit() }

        assertEquals("kilo/opus", created().model)
    }

    fun `test cloud creation offers no local fetch or import controls and preserves fetch settings`() {
        KiloPluginSettings.setGithub(true)
        for (fetch in listOf(false, true)) {
            KiloPluginSettings.setFetchWorktreeBase(fetch)
            open()
            ready()

            edt {
                val controls = controls()
                assertEmpty(controls.filterIsInstance<JBCheckBox>())
                assertEmpty(controls.filterIsInstance<JBTabs>())
                assertEquals(2, controls.filterIsInstance<ComboBox<*>>().size)
                assertEquals("kilocode", repository().getItemAt(0))
                assertEquals(1, repository().itemCount)
                assertEmpty(controls.filterIsInstance<JBTextField>().filter { !it.isEditable })
                submit()
            }

            created()
            assertEquals(fetch, KiloPluginSettings.getFetchWorktreeBase())
        }
    }

    fun `test whitespace prompt creates an empty cloud workspace plan`() {
        open()
        ready()

        edt {
            prompt().setText(" \n\t ")
            assertTrue(okButton().isEnabled)
            submit()
        }
        assertEquals("", created().prompt)
    }

    fun `test an empty profile list allows workspace creation without a profile`() {
        open(profiles = HostedWorkspaceProfileListDto())
        ready()

        edt {
            assertEquals(1, profile().itemCount)
            assertEquals(0, profile().selectedIndex)
            assertSame(profile().getItemAt(0), profile().selectedItem)
            assertNull(requireNotNull(dialog).validationForTest())
            assertTrue(okButton().isEnabled)
            submit()
        }

        assertNull(created().profileID)
    }

    fun `test selecting no profile clears an explicit workspace profile`() {
        open()
        ready()

        edt {
            profile().selectedIndex = 2
            profile().selectedIndex = 0
            assertTrue(okButton().isEnabled)
            submit()
        }

        assertNull(created().profileID)
    }

    fun `test unknown workspace profile selections cannot create a plan`() {
        open()
        ready()

        for (selected in listOf(null, HostedWorkspaceProfileDto("unknown", "Standard"), "unknown")) {
            edt {
                profile().model.selectedItem = selected
                assertFalse(okButton().isEnabled)
                assertEquals(
                    KiloBundle.message("hosted.workspace.dialog.profile.invalid"),
                    requireNotNull(dialog).validationForTest()?.message,
                )
                prompt().send()
            }
            coroutines.drain()
            edt { rejected() }
        }
    }

    fun `test a BYOK only catalog cannot create a cloud plan`() {
        val providers = requireNotNull(rpc.models.providers)
        rpc.models = rpc.models.copy(providers = providers.copy(
            providers = providers.providers.filter { it.id != "kilo" },
        ))
        open()
        ready()

        edt {
            assertFalse(prompt().model.isEnabled)
            submit()
            rejected()
        }
    }

    fun `test missing mode validation does not create a plan`() {
        rpc.models = rpc.models.copy(agents = null)
        open()
        ready()

        edt {
            assertFalse(prompt().mode.isEnabled)
            submit()
            rejected()
        }
    }

    fun `test cloud prompt rejects local attachments and keeps file mentions as text`() {
        open()
        ready()

        edt {
            prompt().setDraft("", listOf(PromptAttachment(
                "local", "local.kt", "text/plain", "file:///test/local.kt", reference = true,
            )))
            assertEmpty(prompt().attachments())
            prompt().setText("Read @src/App.kt")
            prompt().send()
        }

        assertEquals("Read @src/App.kt", created().prompt)
        assertEmpty(rpc.fileCalls)
        assertEmpty(rpc.searchQueries)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test cancelling a queued prompt send is inert`() {
        open()
        ready()
        val closed = requireNotNull(dialog)

        edt {
            prompt().send()
            closed.doCancelAction()
        }
        coroutines.drain()

        edt {
            assertTrue(closed.isDisposed)
            assertEquals(DialogWrapper.CANCEL_EXIT_CODE, closed.exitCode)
            assertNull(closed.plan())
        }
        assertEmpty(appRpc.configPatches)
    }

    fun `test cancelling before the model catalog loads is inert`() {
        val gate = CompletableDeferred<Unit>()
        rpc.modelsGate = gate
        open()
        val closed = requireNotNull(dialog)

        edt {
            prompt().setText("Do not create")
            submit()
            rejected()
            closed.doCancelAction()
        }
        gate.complete(Unit)
        coroutines.drain()

        edt {
            assertTrue(closed.isDisposed)
            assertEquals(DialogWrapper.CANCEL_EXIT_CODE, closed.exitCode)
            assertNull(closed.plan())
        }
    }

    private fun open(
        profiles: HostedWorkspaceProfileListDto = this.profiles,
        branch: String = "",
        load: (suspend () -> HostedWorkspaceProfileListDto)? = null,
        selection: HostedProfileSelectionStore = this.selection,
    ) {
        dialog = edt {
            HostedWorkspaceDialog(
                JBPanel<Nothing>(), project, "/test", "https://github.com/kilo-org/kilocode.git",
                branch, app, workspaces, load ?: { profiles }, selection,
            )
        }
        if (load == null) {
            assertTrue("Cloud dialog did not load the supplied profiles", coroutines.pumpUntil {
                edt { profile().isEnabled }
            })
        }
    }

    private fun ready(text: String = "Build cloud feature") {
        edt { prompt().setText(text) }
        assertTrue("Cloud dialog did not finish loading its prompt controls", coroutines.pumpUntil {
            edt { prompt().isSendEnabled }
        })
    }

    private fun created(): HostedCreatePlan {
        val current = requireNotNull(dialog)
        assertTrue("Cloud dialog did not create a plan", coroutines.pumpUntil { edt { current.plan() != null } })
        return edt {
            assertEquals(DialogWrapper.OK_EXIT_CODE, current.exitCode)
            requireNotNull(current.plan())
        }
    }

    private fun submit() = okButton().doClick(0)

    private fun okButton(): JButton = controls().filterIsInstance<JButton>()
        .single { it.action?.getValue(DialogWrapper.DEFAULT_ACTION) == true }

    private fun rejected() {
        assertNull(requireNotNull(dialog).plan())
        assertFalse(requireNotNull(dialog).isDisposed)
    }

    private fun prompt(): PromptPanel = controls().filterIsInstance<PromptPanel>().single()

    private fun branch(): JBTextField = controls().filterIsInstance<JBTextField>().single { it.isEditable }

    private fun repository(): ComboBox<*> =
        controls().filterIsInstance<ComboBox<*>>().single { it.getItemAt(0) is String }

    private fun profile(): ComboBox<*> =
        controls().filterIsInstance<ComboBox<*>>().single { it.getItemAt(0) !is String }

    private fun useDefault(): HyperlinkLabel = controls().filterIsInstance<HyperlinkLabel>()
        .single { it.text == KiloBundle.message("hosted.workspace.dialog.profile.useDefault") }

    @Suppress("UNCHECKED_CAST")
    private fun cell(item: Any, index: Int): String {
        val renderer = profile().renderer as javax.swing.ListCellRenderer<Any>
        val component = renderer.getListCellRendererComponent(JList<Any>(), item, index, false, false)
        return (component as JLabel).text
    }

    private fun assertPromptCentered() {
        val layout = requireNotNull(prompt().parent).layout as java.awt.BorderLayout
        assertEquals(java.awt.BorderLayout.CENTER, layout.getConstraints(prompt()))
    }

    private fun controls(): List<Component> {
        // The headless DialogWrapper peer has no content pane; its focused editor still owns the real UI tree.
        val root = generateSequence<Component>(requireNotNull(dialog).preferredFocusedComponent) { it.parent }.last()
        return descendants(root)
    }

    private fun descendants(root: Component): List<Component> = buildList {
        fun visit(component: Component) {
            add(component)
            if (component is Container) component.components.forEach(::visit)
        }
        visit(root)
    }

    private fun <T> edt(block: () -> T): T = edtWait(block)

    @RequiresEdt
    private fun modal(block: () -> Unit) {
        val outer = ModalityState.current()
        try {
            runWithModalProgressBlocking(project, "Cloud profile default") {
                withContext(Dispatchers.EDT) {
                    assertNotSame(ModalityState.nonModal(), ModalityState.current())
                    block()
                }
            }
        } finally {
            assertSame(outer, ModalityState.current())
        }
    }

    @RequiresEdt
    private fun pump() {
        val state = ModalityState.current()
        // Unlike the shared test pump, preserve modality so non-modal callbacks remain blocked.
        PlatformTestUtil.dispatchAllInvocationEventsInIdeEventQueue()
        assertSame(state, ModalityState.current())
    }

    private fun catalog(): ModelsWorkspaceDto {
        val providers = ProvidersDto(
            providers = listOf(
                ProviderDto("openai", "OpenAI", models = mapOf(
                    "local" to ModelDto("local", "Local BYOK", byok = true, attachment = true),
                )),
                ProviderDto("kilo", "Kilo", models = mapOf(
                    "gpt-5" to ModelDto("gpt-5", "GPT-5", variants = listOf("low", "high"), attachment = true),
                    "opus" to ModelDto("opus", "Opus", variants = listOf("medium", "max")),
                )),
            ),
            connected = listOf("openai"),
            defaults = emptyMap(),
        )
        val agents = listOf(AgentDto("build", mode = "primary"), AgentDto("plan", mode = "primary"))
        return ModelsWorkspaceDto(providers, AgentsDto(agents, agents, "build"))
    }
}
