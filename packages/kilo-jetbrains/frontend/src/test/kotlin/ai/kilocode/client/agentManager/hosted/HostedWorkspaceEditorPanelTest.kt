package ai.kilocode.client.agentManager.hosted

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.agentManager.WorkspaceSessionEditorPanel
import ai.kilocode.client.agentManager.WorkspaceSessionHeader
import ai.kilocode.client.agentManager.WorkspaceSessionListToggle
import ai.kilocode.client.session.history.HistorySection
import ai.kilocode.client.session.history.HistoryTime
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeSessionRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.pumpEdt
import ai.kilocode.client.ui.active.ActiveItem
import ai.kilocode.client.ui.list.ActiveSection
import ai.kilocode.client.ui.active.ActiveBadgeCell
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.active.activeLayout
import javax.swing.SwingUtilities
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.session.SessionHost
import ai.kilocode.client.session.ui.ProgressPanel
import ai.kilocode.client.session.SessionUi
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.views.LoginRequiredView
import ai.kilocode.client.session.views.SessionOutcomeView
import ai.kilocode.client.session.views.TextView
import ai.kilocode.client.session.views.permission.PermissionView
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.util.edtWait
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import ai.kilocode.rpc.KiloHostedRpcApi
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.HostedAgentDto
import ai.kilocode.rpc.dto.HostedCreateWorkspaceDto
import ai.kilocode.rpc.dto.HostedDeleteResultDto
import ai.kilocode.rpc.dto.HostedMutationResultDto
import ai.kilocode.rpc.dto.HostedProviderDto
import ai.kilocode.rpc.dto.HostedRepositoryDto
import ai.kilocode.rpc.dto.HostedStartSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceProfileListDto
import ai.kilocode.rpc.dto.HostedSystemEventDto
import ai.kilocode.rpc.dto.SessionActivityDto
import ai.kilocode.rpc.dto.SessionActivityKindDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceListDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import ai.kilocode.rpc.dto.HostedWorkspaceStatusDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.SessionStatusDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.registry.Registry
import com.intellij.openapi.util.registry.RegistryKeyDescriptor
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.Container
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import javax.swing.JComponent
import javax.swing.JButton
import javax.swing.JTextArea
import javax.swing.KeyStroke

class HostedWorkspaceEditorPanelTest : BasePlatformTestCase() {
    private lateinit var coroutines: TestCoroutines
    private lateinit var rpc: FakeHosted
    private lateinit var sessions: FakeSessionRpcApi
    private lateinit var hosted: KiloHostedService
    private lateinit var panel: HostedWorkspaceEditorPanel
    private val ref = HostedWorkspaceRefDto("cloud", "workspace")
    private val key get() = "${ref.key}:selected"

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        rpc = FakeHosted(ref)
        sessions = FakeSessionRpcApi().also { it.session = it.session.copy(id = key) }
        hosted = KiloHostedService(coroutines.scope, rpc, gate = { true }, log = TestLog(), repo = { "repo" })
        project.replaceService(KiloHostedService::class.java, hosted, testRootDisposable)
        project.replaceService(KiloSessionService::class.java,
            KiloSessionService(project, coroutines.scope, sessions), testRootDisposable)
        val app = ApplicationManager.getApplication()
        app.replaceService(KiloAppService::class.java, KiloAppService(coroutines.scope, FakeAppRpcApi().also {
            it.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        }), testRootDisposable)
        app.replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(coroutines.scope, FakeWorkspaceRpcApi().also {
            it.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY)
        }), testRootDisposable)
        useInactiveDisposeTimeout()
        panel = edtWait { HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace") }
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 1.0))
        assertTrue(coroutines.pumpUntil { edtWait {
            badge().segments.singleOrNull()?.text == "Sleeping" && descendants(panel).any { it is SessionUi }
        } })
        edtWait { toggle() }
    }

    override fun tearDown() {
        try {
            edtWait { Disposer.dispose(panel) }
            edtWait { project.service<HostedManagementService>().forget(ref) }
            coroutines.close()
        } finally { super.tearDown() }
    }

    fun testPreparationIsMountedAndComputeFollowsLiveEventsWithoutRefresh() {
        emit(HostedSystemEventDto(key, "cloud.status", step = "allocate", message = "Preparing compute",
            cloudStatus = "preparing", observedAt = 110.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Starting" } })
        val footer = edtWait { descendants(panel).filterIsInstance<ProgressPanel>().single() }
        edtWait {
            assertTrue(footer.isVisible)
            assertEquals("Preparing compute", footer.labelText())
            assertTrue(descendants(panel).filterIsInstance<SessionUi>().any {
                javax.swing.SwingUtilities.isDescendingFrom(footer, it)
            })
        }
        emit(HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_progress",
            message = "Cloning repository... Receiving objects: 33%", observedAt = 120.0))
        assertTrue(coroutines.pumpUntil { edtWait { footer.labelText().contains("33%") } })
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "running", sandboxDetail = "ready", observedAt = 200.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Setting Up" } })
        edtWait { assertSame(ai.kilocode.client.ui.UiStyle.Badge.Secondary, badge().segments.single().style) }
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 210.0))
        assertTrue(coroutines.pumpUntil { edtWait { !footer.isVisible } })
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Active" } })
        assertEquals("running", hosted.state.value.statuses[ref.key]?.computeStatus)
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", sandboxDetail = "sandbox_stopped", observedAt = 300.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Sleeping" } })
        assertEquals(1, rpc.collectors)
        emit(HostedSystemEventDto(key, "cloud.status", message = "Preparing again",
            cloudStatus = "preparing", observedAt = 400.0))
        assertTrue(coroutines.pumpUntil { edtWait { footer.isVisible } })
        edtWait { assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single()) }
    }

    fun testHistoryWaitsForPreparationAndShowsPhase() {
        val fake = FakeHosted(ref)
        fake.events.tryEmit(HostedSystemEventDto(key, "preparing", step = "sandbox", action = "attempt_started",
            attemptID = "attempt_1", message = "Creating sandbox", observedAt = 1.0, revision = 1))
        project.replaceService(KiloHostedService::class.java,
            KiloHostedService(coroutines.scope, fake, gate = { true }, log = TestLog(), repo = { "repo" }), testRootDisposable)
        edtWait { Disposer.dispose(panel) }
        edtWait { project.service<HostedManagementService>().forget(ref) }
        coroutines.drain()
        val before = sessions.historyCalls
        panel = edtWait { HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace") }
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().any { ui ->
                descendants(ui).filterIsInstance<ProgressPanel>().any {
                    it.isVisible && it.labelText() == "Creating sandbox"
                }
            }
        } })
        assertEquals("History must wait for Cloud preparation", before, sessions.historyCalls)
        assertTrue(fake.events.tryEmit(HostedSystemEventDto(key, "preparing", action = "attempt_completed",
            attemptID = "attempt_1", observedAt = 2.0, revision = 2)))
        assertTrue(coroutines.pumpUntil { sessions.historyCalls == before + 1 })
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<ProgressPanel>().none { it.isVisible }
        } })
    }

    fun testSessionBadgesUpdateWithoutReloadingOrChangingSelection() {
        val list = edtWait { descendants(panel).filterIsInstance<JBList<*>>().single() }
        val selection = edtWait { (list.selectedValue as ActiveItem).key }
        val other = "${ref.key}:other"
        sessions.statuses.value = mapOf(other to SessionStatusDto("busy"))
        assertTrue(coroutines.pumpUntil {
            edtWait { (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }
                .single { it.key == other }.badges.isNotEmpty() }
        })
        edtWait { assertEquals(selection, (list.selectedValue as ActiveItem).key) }
        sessions.statuses.value = mapOf(other to SessionStatusDto("idle"))
        assertTrue(coroutines.pumpUntil {
            edtWait { (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }
                .single { it.key == other }.badges.isEmpty() }
        })
        assertEquals(1, rpc.workspaceCalls)
        assertEquals(1, rpc.collectors)
    }

    fun testPreparationFailureUsesOutcomeCardAndNewAttemptProgress() {
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_failed", attemptID = "attempt_1",
            failure = "workspace_setup_failed", message = "Finishing setup", observedAt = 110.0, revision = 8))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).any { it is SessionOutcomeView }
        } })
        val card = edtWait { descendants(panel).filterIsInstance<SessionOutcomeView>().single() }
        assertTrue(coroutines.pumpUntil { edtWait {
            card.isVisible && descendants(card).filterIsInstance<javax.swing.JTextArea>().any {
                it.text.contains(KiloBundle.message("hosted.workspace.preparation.setupFailed"))
            }
        } })
        val footer = edtWait { descendants(panel).filterIsInstance<ProgressPanel>().single() }
        emit(HostedSystemEventDto(key, "cloud.status", cloudStatus = "idle", observedAt = 120.0))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key) != null &&
            hosted.state.value.preparations[key]?.cloudStatus == "error" })
        edtWait {
            assertTrue(card.isVisible)
            assertSame(card, descendants(panel).filterIsInstance<SessionOutcomeView>().single())
        }
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_started", attemptID = "attempt_2",
            message = "New preparation", observedAt = 200.0, revision = 1))
        assertTrue(coroutines.pumpUntil { edtWait { !card.isVisible && footer.isVisible && footer.labelText() == "New preparation" } })
        edtWait { assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single()) }
        assertNull(hosted.state.value.failure(key))
        assertEquals("sleeping", hosted.state.value.statuses[ref.key]?.computeStatus)
    }

    fun testCreatePromptFailureOverridesHistory503AndFailedRetryWithoutNativeIdle() {
        val root = rpc.rootSessions.first()
        rpc.mutation = HostedMutationResultDto(
            workspace = HostedWorkspaceDto(ref, sessions = rpc.rootSessions),
            session = root,
            messageID = "msg_initial",
        )
        sessions.pendingError = IllegalStateException("HTTP 503")
        sessions.historyGate = CompletableDeferred<Unit>().also {
            it.completeExceptionally(IllegalStateException("HTTP 503"))
        }
        coroutines.scope.launch {
            hosted.create(HostedCreateWorkspaceDto(
                HostedRepositoryDto("github", repo = "Kilo-Org/cloud-agent-e2e-playground"), "profile",
                "Tell me about Kilo Code", HostedAgentDto("code", "kilo/kilo-auto/free"), "create", "msg_initial",
            ))
        }
        coroutines.drain()
        edtWait {
            Disposer.dispose(panel)
            panel = HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace")
        }
        assertTrue(coroutines.pumpUntil { edtWait { descendants(panel).any { it is SessionUi } } })
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionOutcomeView>().any { card ->
                card.isVisible && descendants(card).filterIsInstance<JTextArea>().any {
                    it.text == KiloBundle.message("hosted.session.error.unavailable")
                }
            }
        } })
        assertTrue("Creating the workspace must not submit its initial prompt twice", sessions.prompts.isEmpty())
        val failed = HostedSystemEventDto(key, "preparing", action = "attempt_failed", attemptID = "attempt_1",
            failure = "workspace_setup_failed", triggerMessageID = "msg_initial", revision = 21, observedAt = 120.0)
        emit(failed)
        val output = "Setup command 1 failed (exit code 1)\nbash: line 1: cd: cloud-agent: No such file or directory\n"
        emit(failed.copy(action = "failed", step = "setup_commands", stepID = "setup_command:0",
            stepKind = "setup_command", detail = output, revision = 19, observedAt = 110.0, outputTruncated = true))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<JTextArea>().any {
                it.text.contains(output) && it.text.contains(KiloBundle.message("hosted.workspace.preparation.outputTruncated"))
            }
        } })
        val card = edtWait { descendants(panel).filterIsInstance<SessionOutcomeView>().single() }
        val area = edtWait { descendants(card).filterIsInstance<JTextArea>().single { it.text.contains(output) } }
        val footer = edtWait { descendants(panel).filterIsInstance<ProgressPanel>().single() }
        edtWait {
            assertTrue(card.isVisible)
            val button = descendants(card).filterIsInstance<JButton>()
                .single { it.text == KiloBundle.message("session.outcome.retry") }
            button.doClick()
        }
        assertTrue(coroutines.pumpUntil { sessions.prompts.isNotEmpty() })
        assertEquals("Tell me about Kilo Code", sessions.prompts.single().third.parts.single().text)
        val retry = sessions.prompts.single().third.messageID!!
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_started", attemptID = "attempt_2",
            triggerMessageID = retry, message = "Retrying setup", revision = 1, observedAt = 200.0))
        assertTrue(coroutines.pumpUntil { edtWait {
            !card.isVisible && footer.isVisible && footer.labelText() == "Retrying setup"
        } })

        emit(failed.copy(attemptID = "attempt_2", triggerMessageID = retry, observedAt = 210.0,
            detail = output, outputTruncated = true))

        assertTrue(coroutines.pumpUntil { edtWait {
            card.isVisible && area.text.contains(output) &&
                descendants(card).filterIsInstance<JButton>().any { it.text == KiloBundle.message("session.outcome.retry") }
        } })
        edtWait {
            assertSame(card, descendants(panel).filterIsInstance<SessionOutcomeView>().single())
            assertSame(area, descendants(card).filterIsInstance<JTextArea>().single { it.text.contains(output) })
            assertSame(footer, descendants(panel).filterIsInstance<ProgressPanel>().single())
            assertFalse("Stale native progress must yield to the setup failure", footer.isVisible)
            assertTrue("Failure presentation must not rewrite native Busy", descendants(panel).filterIsInstance<PromptPanel>().single().isStopEnabled)
            descendants(card).filterIsInstance<JButton>()
                .single { it.text == KiloBundle.message("session.outcome.retry") }.doClick()
        }
        assertTrue("A second failed preparation must remain retryable without native idle",
            coroutines.pumpUntil { sessions.prompts.size == 2 })
        val next = sessions.prompts.last().third.messageID!!
        assertTrue(retry != next)
        emit(failed.copy(attemptID = "attempt_3", triggerMessageID = next, observedAt = 300.0, detail = output))
        assertTrue(coroutines.pumpUntil { edtWait { card.isVisible && area.text.contains(output) } })
        edtWait {
            descendants(card).filterIsInstance<JButton>()
                .single { it.text == KiloBundle.message("session.outcome.dismiss") }.doClick()
            assertFalse(card.isVisible)
            assertTrue(descendants(panel).filterIsInstance<PromptPanel>().single().isStopEnabled)
        }
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "stopped", observedAt = 400.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Stopped" } })
        edtWait { assertFalse("Unrelated hosted refresh must not reopen a dismissed failure", card.isVisible) }
        emit(failed.copy(attemptID = "attempt_3", triggerMessageID = next, observedAt = 410.0, detail = "$output\nLate detail", revision = 22))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key)?.revision == 22L })
        emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping", observedAt = 420.0))
        assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Sleeping" } })
        edtWait { assertFalse("Replay or enrichment of the same dismissed attempt must stay dismissed", card.isVisible) }
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_started", attemptID = "attempt_4",
            triggerMessageID = next, message = "Preparing a new attempt", observedAt = 500.0))
        assertTrue(coroutines.pumpUntil { edtWait { footer.labelText() == "Preparing a new attempt" && footer.isVisible } })
        emit(failed.copy(attemptID = "attempt_4", triggerMessageID = next, observedAt = 510.0, detail = output))
        assertTrue(coroutines.pumpUntil { edtWait { card.isVisible && area.text.contains(output) } })
        assertEquals(2, sessions.prompts.size)
    }

    fun testPreparationFailureDoesNotClobberNewerPromptOrPendingInteractions() {
        val ui = edtWait { descendants(panel).filterIsInstance<SessionUi>().single() }
        edtWait { ui.submitPrompt("First prompt") }
        assertTrue(coroutines.pumpUntil { sessions.prompts.size == 1 })
        assertTrue(sessions.events.tryEmit(ChatEventDto.SessionStatusChanged(key, SessionStatusDto("busy"))))
        assertTrue(coroutines.pumpUntil { edtWait { descendants(panel).filterIsInstance<PromptPanel>().single().isStopEnabled } })
        val first = sessions.prompts.single().third.messageID!!
        val failure = HostedSystemEventDto(key, "preparing", action = "attempt_failed", attemptID = "attempt_1",
            triggerMessageID = first, failure = "workspace_setup_failed", detail = "Setup command 1 failed", revision = 2)
        emit(failure)
        val card = edtWait { descendants(panel).filterIsInstance<SessionOutcomeView>().single() }
        assertTrue(coroutines.pumpUntil { edtWait { card.isVisible } })

        edtWait { ui.submitPrompt("Newer prompt") }
        assertTrue(coroutines.pumpUntil { sessions.prompts.size == 2 })
        val current = sessions.prompts.last().third.messageID!!
        emit(failure.copy(detail = "Late output for the older prompt", revision = 3))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key)?.detail == "Late output for the older prompt" })
        edtWait {
            assertFalse(card.isVisible)
            assertTrue(descendants(panel).filterIsInstance<PromptPanel>().single().isStopEnabled)
        }

        emit(failure.copy(attemptID = "attempt_2", triggerMessageID = current, revision = 4))
        assertTrue(coroutines.pumpUntil { edtWait { card.isVisible } })
        assertTrue(sessions.events.tryEmit(ChatEventDto.QuestionAsked(key,
            QuestionRequestDto("question", key, listOf(QuestionInfoDto("Proceed?", "Question"))))))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<QuestionView>().single().isVisible && !card.isVisible
        } })
        emit(failure.copy(attemptID = "attempt_2", triggerMessageID = current, revision = 5))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key)?.revision == 5L })
        edtWait { assertTrue(descendants(panel).filterIsInstance<QuestionView>().single().isVisible); assertFalse(card.isVisible) }

        assertTrue(sessions.events.tryEmit(ChatEventDto.QuestionRejected(key, "question")))
        assertTrue(sessions.events.tryEmit(ChatEventDto.PermissionAsked(key,
            PermissionRequestDto("permission", key, "edit", listOf("*.kt")))))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<PermissionView>().single().isVisible && !card.isVisible
        } })
        emit(failure.copy(attemptID = "attempt_2", triggerMessageID = current, revision = 6))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key)?.revision == 6L })
        edtWait { assertTrue(descendants(panel).filterIsInstance<PermissionView>().single().isVisible); assertFalse(card.isVisible) }

        assertTrue(sessions.events.tryEmit(ChatEventDto.Error(key,
            MessageErrorDto("APIError", statusCode = 401, responseBody = """{"code":"PAID_MODEL_AUTH_REQUIRED"}"""))))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<LoginRequiredView>().single().isVisible && !card.isVisible
        } })
        emit(failure.copy(attemptID = "attempt_2", triggerMessageID = current, revision = 7))
        assertTrue(coroutines.pumpUntil { hosted.state.value.failure(key)?.revision == 7L })
        edtWait { assertTrue(descendants(panel).filterIsInstance<LoginRequiredView>().single().isVisible); assertFalse(card.isVisible) }
        assertEquals(2, sessions.prompts.size)
        assertTrue(sessions.permissionReplies.isEmpty())
        assertTrue(sessions.questionReplies.isEmpty())
    }

    fun testLateInitialHistory503CannotReplaceCurrentBusyPreparationFailure() {
        val before = sessions.historyCalls
        val gate = CompletableDeferred<Unit>()
        sessions.historyGate = gate
        edtWait {
            Disposer.dispose(panel)
            panel = HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace")
        }
        assertTrue(coroutines.pumpUntil { sessions.historyCalls > before && edtWait {
            descendants(panel).any { it is SessionUi }
        } })
        edtWait { descendants(panel).filterIsInstance<SessionUi>().single().submitPrompt("Prepare the workspace") }
        assertTrue(coroutines.pumpUntil { sessions.prompts.size == 1 })
        // Transcript parts wait for history; preparation and native status can advance independently.
        assertTrue(sessions.events.tryEmit(ChatEventDto.SessionStatusChanged(key, SessionStatusDto("busy"))))
        val id = sessions.prompts.single().third.messageID!!
        val output = "Setup command 1 failed (exit code 1)\nbash: line 1: cd: cloud-agent: No such file or directory"
        emit(HostedSystemEventDto(key, "preparing", action = "attempt_failed", attemptID = "attempt_1",
            triggerMessageID = id, failure = "workspace_setup_failed", detail = output))
        val card = edtWait { descendants(panel).filterIsInstance<SessionOutcomeView>().single() }
        assertTrue(coroutines.pumpUntil { edtWait {
            card.isVisible && descendants(card).filterIsInstance<JTextArea>().any { it.text.contains(output) }
        } })
        assertTrue(sessions.events.tryEmit(ChatEventDto.MessageUpdated(key,
            MessageDto(id, key, "user", MessageTimeDto(200.0)))))
        assertTrue(sessions.events.tryEmit(ChatEventDto.PartUpdated(key,
            PartDto("native", key, id, "text", text = "Native prompt accepted"))))
        gate.completeExceptionally(IllegalStateException("HTTP 503"))

        assertTrue("Settling initial history must release queued native content", coroutines.pumpUntil(
            pump = {
                flushChat()
                pumpEdt()
            },
        ) { edtWait {
            descendants(panel).filterIsInstance<TextView>().any { it.markdown() == "Native prompt accepted" }
        } })
        edtWait {
            assertTrue("A stale initial error must not replace the current native Busy", descendants(panel).filterIsInstance<PromptPanel>().single().isStopEnabled)
            assertTrue(card.isVisible)
            assertTrue(descendants(card).filterIsInstance<JTextArea>().any { it.text.contains(output) })
            assertFalse(descendants(card).filterIsInstance<JTextArea>().any { it.text == "HTTP 503" })
            assertNotNull(descendants(card).filterIsInstance<JButton>()
                .singleOrNull { it.text == KiloBundle.message("session.outcome.retry") })
        }
    }

    fun testCloudUsesSharedEditorHeaderRowsAndWorktreeSessionStyling() {
        edtWait {
            assertEquals(WorkspaceSessionEditorPanel::class.java, panel.javaClass.superclass)
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            assertEquals(0.25f, splitter.proportion, 0.01f)
            assertNotNull(descendants(panel).filterIsInstance<WorkspaceSessionHeader>().single())
            val list = descendants(panel).filterIsInstance<JBList<*>>().single()
            val rows = (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }
            assertTrue(rows.all { it is HostedSessionRow })
            assertEquals(listOf("${ref.key}:selected", "${ref.key}:other"), rows.map { it.key })
            assertEquals(HistoryTime.title(HistorySection.OLDER), (rows.first() as ActiveSection).section)
            assertEquals("New session", rows.last().title)
            @Suppress("UNCHECKED_CAST")
            val view = list as JBList<ActiveItem>
            val cell = view.cellRenderer.getListCellRendererComponent(view, rows.first(), 0, false, false)
            val title = ai.kilocode.client.testing.rowTitle(cell)
            val iter = title.iterator()
            iter.next()
            assertEquals(SimpleTextAttributes.STYLE_PLAIN, iter.textAttributes.style)
        }
    }

    fun testCloudSessionTitleRefreshesFromWorkspace() {
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().single().title() == "Selected session"
        } })
        val current = rpc.rootSessions
        rpc.rootSessions = current.mapIndexed { index, session ->
            if (index == 0) session.copy(title = "OpenRouter API access", updated = 3.0) else session
        }
        hosted.refresh("repo")
        assertTrue(coroutines.pumpUntil { edtWait {
            val list = descendants(panel).filterIsInstance<JBList<*>>().single()
            val row = (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }
                .firstOrNull { it.key == key }
            descendants(panel).filterIsInstance<SessionUi>().single().title() == "OpenRouter API access" &&
                row?.title == "OpenRouter API access"
        } })
    }

    fun testFinishedTurnOnTheOpenSessionRereadsTheWorkspaceUntilCloudNamesIt() {
        // Cloud creates the session with a placeholder name and only names it after the first turn.
        val placeholder = "New session - 2026-11-10T19:59:50.555Z"
        rpc.rootSessions = rpc.rootSessions.map { if (it.id == key) it.copy(title = placeholder) else it }
        // Discovery is what the Agent Manager tree reads; seed it with the stale placeholder.
        rpc.list = HostedWorkspaceListDto(listOf(HostedWorkspaceDto(ref, branch = "feature/cloud", sessions = rpc.rootSessions)))
        hosted.refresh("repo")
        assertTrue(coroutines.pumpUntil { hosted.state.value.items.any { it.ref == ref } })
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().single().title() == placeholder
        } })
        val reads = rpc.workspaceCalls

        // The turn runs and finishes in this editor's own session: no tree, no global activity map.
        sessions.statuses.value = mapOf(key to SessionStatusDto("busy"))
        assertTrue(coroutines.pumpUntil { edtWait {
            val list = descendants(panel).filterIsInstance<JBList<*>>().single()
            (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }
                .single { it.key == key }.badges.isNotEmpty()
        } })
        rpc.rootSessions = rpc.rootSessions.map {
            if (it.id == key) it.copy(title = "Microsoft company overview", updated = 5.0) else it
        }
        sessions.statuses.value = mapOf(key to SessionStatusDto("idle"))

        assertTrue(coroutines.pumpUntil(deadlineMs = 10_000) { rpc.workspaceCalls > reads })
        assertTrue(coroutines.pumpUntil(deadlineMs = 10_000) { edtWait {
            val list = descendants(panel).filterIsInstance<JBList<*>>().single()
            val row = (0 until list.model.size).map { list.model.getElementAt(it) as ActiveItem }.firstOrNull { it.key == key }
            val header = descendants(panel).filterIsInstance<SimpleColoredComponent>().first().getCharSequence(true).toString()
            row?.title == "Microsoft company overview" && header == "Microsoft company overview"
        } })
        // The tree reads discovery items, so the fetched workspace must land there as well.
        assertEquals(
            "Microsoft company overview",
            hosted.state.value.items.single { it.ref == ref }.sessions.single { it.id == key }.title,
        )
    }

    fun testHostedSessionOfMatchesCompositeAndNativeIds() {
        val current = listOf(HostedWorkspaceSessionDto(
            id = key,
            nativeSessionID = "selected",
            title = "Selected session",
            updated = 1.0,
        ))
        assertTrue(hostedSessionOf(key, ref.workspaceID, current))
        assertTrue(hostedSessionOf("selected", ref.workspaceID, current))
        assertFalse(hostedSessionOf("selected", "other", emptyList()))
    }

    fun testHeaderUsesTheRowBadgeAndSeparateHourlyPriceWithoutRefreshControl() {
        val cell = edtWait { descendants(panel).filterIsInstance<ActiveBadgeCell>().single { it.cellId == "cloud-compute" } }
        val initial = edtWait { badge() }
        val header = edtWait { descendants(panel).filterIsInstance<WorkspaceSessionHeader>().single() }
        val count = edtWait { descendants(header).size }
        edtWait {
            assertTrue(descendants(header).filterIsInstance<HoverIcon>().isEmpty())
            val price = descendants(header).filterIsInstance<JBLabel>().single { it.text == "$1.20/h" }
            val row = HostedWorkspaceRow(HostedWorkspaceRowData(HostedWorkspaceDto(ref), hosted.state.value.presentation(ref)))
            assertEquals(row.badges.single().text, initial.segments.single().text)
            assertSame(row.badges.single().style, initial.segments.single().style)
            header.setSize(900, header.preferredSize.height)
            activeLayout(header)
            val pill = SwingUtilities.convertRectangle(cell.parent, cell.bounds, header)
            val title = descendants(header).filterIsInstance<SimpleColoredComponent>().single()
            val name = SwingUtilities.convertRectangle(title.parent, title.bounds, header)
            val label = SwingUtilities.convertRectangle(price.parent, price.bounds, header)
            assertTrue("Status sits in the trailing action group", pill.x > header.width / 2)
            assertTrue("Status stays clear of the title", pill.x > name.x + name.width)
            assertTrue("Price follows the status badge", label.x > pill.x + pill.width)
            assertTrue(descendants(header).filterIsInstance<JBLabel>().none { it.text.orEmpty().contains(" · ") })
        }
        repeat(100) {
            emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "active",
                sandboxDetail = "sandbox_ready", observedAt = 200.0 + it * 2))
            assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Active" } })
            emit(HostedSystemEventDto(key, "cloud.sandbox.status", sandboxStatus = "sleeping",
                sandboxDetail = "sandbox_stopped", observedAt = 201.0 + it * 2))
            assertTrue(coroutines.pumpUntil { edtWait { badge().segments.singleOrNull()?.text == "Sleeping" } })
            edtWait { assertSame(cell, descendants(panel).filterIsInstance<ActiveBadgeCell>().single { it.cellId == "cloud-compute" }) }
        }
        edtWait { assertEquals("Sleeping", badge().segments.single().text); assertEquals(count, descendants(header).size) }
    }

    fun testInitialPanelShowsABlankSessionInsteadOfAPlaceholder() {
        edtWait {
            val second = HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace")
            try {
                assertTrue(
                    "Cloud editor must open a blank prompt panel, not an empty hint",
                    descendants(second).any { it is SessionUi },
                )
                assertTrue(
                    descendants(second).filterIsInstance<JBLabel>()
                        .none { it.text == KiloBundle.message("hosted.workspace.empty") },
                )
            } finally {
                Disposer.dispose(second)
            }
        }
    }

    fun testCloudListVisibilityUsesSharedToggleAndRetainsSessionAndHeader() {
        edtWait {
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            val list = splitter.firstComponent
            val title = descendants(panel).filterIsInstance<SimpleColoredComponent>().first()
            val session = descendants(panel).filterIsInstance<SessionUi>().single()
            repeat(100) {
                toggle()
                assertNull(splitter.firstComponent)
                assertSame(session, descendants(panel).filterIsInstance<SessionUi>().single())
                toggle()
                assertSame(list, splitter.firstComponent)
                assertSame(title, descendants(panel).filterIsInstance<SimpleColoredComponent>().first())
            }
            assertTrue(project.service<HostedManagementService>().listVisible(ref))
        }
    }

    fun testPreferredFocusAlwaysBelongsToTheAttachedSharedEditorSurface() {
        edtWait {
            assertTrue(SwingUtilities.isDescendingFrom(panel.preferredFocus(), panel))
            toggle()
            val splitter = descendants(panel).filterIsInstance<OnePixelSplitter>().single()
            assertNull(splitter.firstComponent)
            assertSame(splitter.secondComponent, panel.preferredFocus())
            assertTrue(SwingUtilities.isDescendingFrom(panel.preferredFocus(), panel))
            assertTrue(descendants(splitter.secondComponent).any { it is SessionUi })
            toggle()
        }
    }

    fun testMissingCurrentSessionFallsBackToTheLatestAvailableSession() {
        rpc.rootSessions = listOf(rpc.rootSessions.last())

        hosted.refresh("/renamed-repository")

        assertTrue(coroutines.pumpUntil {
            val value = edtWait { descendants(panel).filterIsInstance<JBList<*>>().single().selectedValue }
            (value as? ActiveItem)?.key == rpc.rootSessions.single().id
        })
        edtWait {
            assertEquals(rpc.rootSessions.single().id,
                (descendants(panel).filterIsInstance<JBList<*>>().single().selectedValue as ActiveItem).key)
            assertEquals(1, descendants(panel).filterIsInstance<SessionUi>().size)
        }
    }

    fun testEmptyWorkspaceRefreshRetainsOneBlankSessionAndReleasesItsEditors() {
        edtWait { Disposer.dispose(panel) }
        coroutines.drain()
        val baseline = edtWait { EditorFactory.getInstance().allEditors.size }
        panel = edtWait { HostedWorkspaceEditorPanel(testRootDisposable, project, ref, "Cloud workspace") }
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().singleOrNull()?.id == key
        } })

        rpc.rootSessions = emptyList()
        hosted.refresh(project.basePath.orEmpty())

        assertTrue("An empty workspace must finish creating its blank session", coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().singleOrNull()?.blank == true
        } })
        coroutines.drain()
        edtWait {
            val blank = descendants(panel).filterIsInstance<SessionUi>().single()
            val count = descendants(panel).size
            val editors = EditorFactory.getInstance().allEditors.size
            val model = controller(blank).model
            repeat(200) {
                model.loadHistory(emptyList())
                assertSame(blank, descendants(panel).filterIsInstance<SessionUi>().single())
                assertEquals(count, descendants(panel).size)
                assertEquals(editors, EditorFactory.getInstance().allEditors.size)
            }
            Disposer.dispose(panel)
        }
        coroutines.drain()
        edtWait { assertEquals(baseline, EditorFactory.getInstance().allEditors.size) }
    }

    fun testCurrentSessionIsReobservedAfterSignInRestoresTheGate() {
        val initial = rpc.collectors
        rpc.list = HostedWorkspaceListDto(signedOut = true)
        hosted.refresh("/signed-out")
        assertTrue(coroutines.pumpUntil { hosted.state.value.signedOut && rpc.active == 0 })

        rpc.list = HostedWorkspaceListDto(items = listOf(HostedWorkspaceDto(ref)))
        hosted.refresh("/signed-in")

        assertTrue(coroutines.pumpUntil { rpc.collectors > initial && rpc.active == 1 })
        emit(HostedSystemEventDto(key, "cloud.status", message = "Preparing after sign-in",
            cloudStatus = "preparing", observedAt = 500.0))
        // The progress panel mounts asynchronously after the event, so keep polling until it exists.
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<ProgressPanel>().singleOrNull()?.labelText() == "Preparing after sign-in"
        } })
    }

    fun testSignedOutResetDiscardsAnInFlightReload() {
        val gate = CompletableDeferred<Unit>()
        rpc.gate = gate
        val before = rpc.statusCalls
        val reads = rpc.workspaceCalls
        rpc.list = HostedWorkspaceListDto(signedOut = true)

        hosted.refresh("/signed-out")
        assertTrue(coroutines.pumpUntil { rpc.workspaceCalls > reads })
        assertTrue(coroutines.pumpUntil { hosted.state.value.signedOut })
        gate.complete(Unit)
        assertTrue(coroutines.pumpUntil { rpc.statusCalls > before })
        edtWait {}
        edtWait {}
        edtWait { assertEquals(0, descendants(panel).filterIsInstance<JBList<*>>().single().model.size) }
    }

    fun testNewSessionStartsABlankPromptWithoutCallingCloud() {
        val manager = HostedWorkspaceEditorPanel::class.java
            .getDeclaredField("manager")
            .apply { isAccessible = true }
            .get(panel) as ai.kilocode.client.agentManager.WorkspaceSessionEditorManager

        edtWait { manager.newSession() }

        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<SessionUi>().any { it.blank }
        } })
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<JBList<*>>().single()
                .let { list -> (0 until list.model.size).any { (list.model.getElementAt(it) as ActiveItem).key == SessionHost.NEW } }
        } })
        assertEquals(0, rpc.starts)
    }

    fun testBlankNewSessionNeverInheritsThePreviousSessionsPreparation() {
        emit(HostedSystemEventDto(key, "cloud.status", step = "allocate", message = "Preparing compute",
            cloudStatus = "preparing", observedAt = 110.0))
        assertTrue(coroutines.pumpUntil { edtWait {
            descendants(panel).filterIsInstance<ProgressPanel>().any { it.isVisible && it.labelText() == "Preparing compute" }
        } })
        val manager = HostedWorkspaceEditorPanel::class.java
            .getDeclaredField("manager")
            .apply { isAccessible = true }
            .get(panel) as ai.kilocode.client.agentManager.WorkspaceSessionEditorManager

        edtWait { manager.newSession() }
        assertTrue(coroutines.pumpUntil { edtWait { descendants(panel).filterIsInstance<SessionUi>().any { it.blank } } })
        // Another status tick while the blank panel is current must not paint the old session's strip on it.
        emit(HostedSystemEventDto(key, "preparing", step = "cloning", action = "step_progress",
            message = "Cloning repository", observedAt = 120.0))
        coroutines.drain()

        edtWait {
            val blank = descendants(panel).filterIsInstance<SessionUi>().single { it.blank }
            assertTrue(descendants(blank).filterIsInstance<ProgressPanel>().none { it.isVisible })
        }
    }

    fun testWorkspaceHeaderUsesTheSessionTitleThenFallsBackToWorkspaceMetadata() {
        val title = edtWait { descendants(panel).filterIsInstance<SimpleColoredComponent>().first() }
        // A titled session wins everywhere: tree row, header, tab, and status bar agree.
        edtWait { assertEquals("Selected session", title.getCharSequence(true).toString()) }
        rpc.rootSessions = emptyList()
        hosted.refresh(project.basePath.orEmpty())
        assertTrue(coroutines.pumpUntil { edtWait { title.getCharSequence(true).toString() == "feature/cloud" } })
        rpc.name = "Cloud custom name"
        hosted.refresh(project.basePath.orEmpty())
        assertTrue(coroutines.pumpUntil { edtWait { title.getCharSequence(true).toString() == "Cloud custom name" } })
        edtWait { assertSame(title, descendants(panel).filterIsInstance<SimpleColoredComponent>().first()) }
    }

    fun testRefreshingWorkspaceMetadataRetitlesAndReusesTheOpenEditor() {
        rpc.rootSessions = emptyList()
        val dto = HostedWorkspaceDto(ref, branch = "feature/cloud")
        val editors = FileEditorManager.getInstance(project)
        try {
            edtWait { openHostedWorkspace(project, dto, focus = false) }
            val file = edtWait { editors.openFiles.single() }
            edtWait {
                assertEquals("feature/cloud", file.name)
                assertEquals(mapOf("provider" to "cloud", "workspace" to "workspace"),
                    (file as ai.kilocode.client.vfs.KiloVirtualFile).path.params)
            }
            rpc.name = "Cloud renamed"
            hosted.refresh(project.basePath.orEmpty())
            assertTrue(coroutines.pumpUntil { edtWait { file.name == "Cloud renamed" } })
            edtWait {
                openHostedWorkspace(project, dto.copy(name = "Cloud renamed"), focus = false)
                assertSame(file, editors.openFiles.single())
                assertSame(file, KiloVirtualFileSystem.getInstance().cached(
                    ai.kilocode.client.vfs.KiloPath(HostedWorkspaceEditorKind.ID, hostedWorkspaceParams(dto))))
            }
        } finally {
            edtWait {
                editors.openFiles.forEach { editors.closeFile(it) }
                service<KiloEditorKindRegistry>().unregister(HostedWorkspaceEditorKind.ID)
                KiloVirtualFileSystem.getInstance().clear()
            }
        }
    }

    private fun useInactiveDisposeTimeout() {
        Registry.mutateContributedKeys {
            it + (TIMEOUT to RegistryKeyDescriptor(
                TIMEOUT,
                "Milliseconds before hidden session UI is disposed after switching away.",
                "180000",
                false,
                false,
                null,
                null,
            ))
        }
        Disposer.register(testRootDisposable) { Registry.mutateContributedKeys { it - TIMEOUT } }
        Registry.get(TIMEOUT).setValue(60_000, testRootDisposable)
    }

    private fun emit(event: HostedSystemEventDto) { assertTrue(rpc.events.tryEmit(event)) }

    /**
     * This test's SessionUi is never showing, so the controller's update queue defers message/part
     * events instead of flushing them on enqueue. A chat event emitted around history settling can
     * land after that settle flush and stay pending, which depends on subscription scheduling. Force
     * the flush while waiting, matching `SessionUiTestBase`, so the assertion does not race delivery.
     */
    private fun flushChat() {
        val ui = edtWait { descendants(panel).filterIsInstance<SessionUi>().singleOrNull() } ?: return
        edtWait { controller(ui).flushEvents() }
    }

    private fun controller(ui: SessionUi): SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(ui) as SessionController
    }

    private fun labels() = descendants(panel).filterIsInstance<JBLabel>().filter { it.text != null }
    private fun badge(): FilledBadgeIcon = descendants(panel).filterIsInstance<ActiveBadgeCell>()
        .single { it.cellId == "cloud-compute" }.icon as FilledBadgeIcon
    private fun toggle() {
        val toggle = descendants(panel).filterIsInstance<WorkspaceSessionListToggle>().single()
        val key = toggle.getInputMap(JComponent.WHEN_FOCUSED).get(KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0))
        toggle.actionMap.get(key).actionPerformed(ActionEvent(toggle, ActionEvent.ACTION_PERFORMED, ""))
    }
    private fun descendants(root: Component): List<Component> = listOf(root) +
        if (root is Container) root.components.flatMap { descendants(it) } else emptyList()

    private companion object {
        const val TIMEOUT = "kilo.session.inactive.disposeTimeoutMs"
    }

    private class FakeHosted(private val ref: HostedWorkspaceRefDto) : KiloHostedRpcApi {
        val events = MutableSharedFlow<HostedSystemEventDto>(replay = 16)
        var collectors = 0
        var active = 0
        var workspaceCalls = 0
        var statusCalls = 0
        var starts = 0
        var gate: CompletableDeferred<Unit>? = null
        var name: String? = null
        var list = HostedWorkspaceListDto()
        var mutation = HostedMutationResultDto()
        var rootSessions = listOf(
            HostedWorkspaceSessionDto("${ref.key}:selected", "selected", "Selected session", updated = 2.0),
            HostedWorkspaceSessionDto("${ref.key}:other", "other", "New session - 2026-07-30T19:01:40.945Z", updated = 1.0),
        )
        override suspend fun providers(): List<HostedProviderDto> = emptyList()
        override suspend fun workspaces(repositoryUrl: String?, cursor: String?, organizationID: String?) = list
        override suspend fun workspace(ref: HostedWorkspaceRefDto, sessionCursor: String?, organizationID: String?): HostedWorkspaceDto {
            workspaceCalls++
            gate?.await()
            return HostedWorkspaceDto(ref, name = name, branch = "feature/cloud", sessions = rootSessions)
        }
        override suspend fun workspaceStatus(ref: HostedWorkspaceRefDto, organizationID: String?): HostedWorkspaceStatusDto {
            statusCalls++
            return HostedWorkspaceStatusDto(ref, "active", "sleeping", "sandbox_stopped", 100.0, rateMicrodollarsPerHour = 1_200_000)
        }
        override suspend fun workspaceProfiles(organizationID: String?) = HostedWorkspaceProfileListDto()
        override suspend fun setPersonalDefaultProfile(profileID: String) = ai.kilocode.rpc.dto.HostedProfileDefaultDto(success = true)
        override suspend fun createWorkspace(request: HostedCreateWorkspaceDto) = mutation
        override suspend fun startWorkspaceSession(ref: HostedWorkspaceRefDto, request: HostedStartSessionDto): HostedMutationResultDto {
            starts++
            return HostedMutationResultDto()
        }
        override suspend fun deleteWorkspace(ref: HostedWorkspaceRefDto, organizationID: String?) =
            HostedDeleteResultDto(ref)
        override suspend fun systemEvents(ref: HostedWorkspaceRefDto, sessionID: String, organizationID: String?): Flow<HostedSystemEventDto> = flow {
            collectors++
            active++
            try {
                events.collect { emit(it) }
            } finally {
                active--
            }
        }
    }
}
