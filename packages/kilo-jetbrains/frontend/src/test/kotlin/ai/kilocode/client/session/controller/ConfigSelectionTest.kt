package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelStateDto
import ai.kilocode.rpc.dto.ProviderDto
import ai.kilocode.client.testing.FakeAppRpcApi
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

class ConfigSelectionTest : SessionControllerTestBase() {

    fun `test selectModel updates SessionModel and persists model state`() {
        projectRpc.state.value = workspaceReady()
        val m = controller()
        collect(m)
        flush()

        edt { m.selectModel("kilo", "gpt-5") }
        flush()

        assertTrue(rpc.configs.isEmpty())
        assertEquals("code", appRpc.selections.single().agent)
        assertEquals("kilo", appRpc.selections.single().providerID)
        assertEquals("gpt-5", appRpc.selections.single().modelID)
        assertSession(
            """
            [code] [kilo/gpt-5] [app: DISCONNECTED] [workspace: READY]
            """,
            m,
            show = false,
        )
    }

    fun `test selectAgent updates SessionModel and calls updateConfig`() {
        val m = controller()
        collect(m)
        flush()

        edt { m.selectAgent("plan") }
        flush()

        assertEquals(1, rpc.configs.size)
        assertEquals("plan", rpc.configs[0].second.agent)
        assertSession(
            """
            [plan] [app: DISCONNECTED] [workspace: PENDING]
            """,
            m,
            show = false,
        )
    }

    fun `test selectModel fires WorkspaceReady event`() {
        projectRpc.state.value = workspaceReady()
        val m = controller()
        val events = collect(m)
        flush()
        events.clear()

        edt { m.selectModel("kilo", "gpt-5") }
        flush()

        assertControllerEvents("WorkspaceReady", events)
    }

    fun `test clearModelOverride restores default model`() {
        appRpc.models = ModelStateDto(model = mapOf("code" to ModelSelectionDto("openai", "gpt")))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(agent = mapOf("code" to AgentConfigDto(model = "anthropic/claude"))),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto")),
                ),
                ProviderDto(
                    id = "anthropic",
                    name = "Anthropic",
                    models = mapOf("claude" to ModelDto(id = "claude", name = "Claude")),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT")),
                ),
            ),
            connected = listOf("kilo", "anthropic", "openai"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("openai/gpt", m.model.model)
        assertTrue(m.model.modelOverride)

        edt { m.clearModelOverride() }
        flush()

        assertEquals("anthropic/claude", m.model.model)
        assertFalse(m.model.modelOverride)
        assertEquals(listOf("code"), appRpc.cleared)
    }

    fun `test global config supplies computed default`() {
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "openai/gpt"),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto")),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT")),
                ),
            ),
            connected = listOf("kilo", "openai"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("openai/gpt", m.model.defaultModel)
        assertEquals("openai/gpt", m.model.model)
        assertFalse(m.model.modelOverride)
    }

    fun `test recent supplies computed default when config is absent`() {
        appRpc.models = ModelStateDto(recent = listOf(ModelSelectionDto("anthropic", "claude")))
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY)
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto")),
                ),
                ProviderDto(
                    id = "anthropic",
                    name = "Anthropic",
                    models = mapOf("claude" to ModelDto(id = "claude", name = "Claude")),
                ),
            ),
            connected = listOf("kilo", "anthropic"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("anthropic/claude", m.model.defaultModel)
        assertEquals("anthropic/claude", m.model.model)
        assertFalse(m.model.modelOverride)
    }

    fun `test invalid config falls through to recent`() {
        appRpc.models = ModelStateDto(recent = listOf(ModelSelectionDto("anthropic", "claude")))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "openai/gpt"),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto")),
                ),
                ProviderDto(
                    id = "anthropic",
                    name = "Anthropic",
                    models = mapOf("claude" to ModelDto(id = "claude", name = "Claude")),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT")),
                ),
            ),
            connected = listOf("kilo", "anthropic"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("anthropic/claude", m.model.defaultModel)
        assertEquals("anthropic/claude", m.model.model)
    }

    fun `test no valid candidates falls back to kilo auto`() {
        appRpc.models = ModelStateDto(recent = listOf(ModelSelectionDto("openai", "gpt")))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "missing/model"),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("kilo-auto/free" to ModelDto(id = "kilo-auto/free", name = "Auto")),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT")),
                ),
            ),
            connected = listOf("kilo"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("kilo/kilo-auto/free", m.model.defaultModel)
        assertEquals("kilo/kilo-auto/free", m.model.model)
        assertFalse(m.model.modelOverride)
    }

    fun `test reset resolves matching agent config variant`() {
        appRpc.models = ModelStateDto(
            model = mapOf("code" to ModelSelectionDto("openai", "gpt")),
        )
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(agent = mapOf("code" to AgentConfigDto(model = "anthropic/claude", variant = "high"))),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "anthropic",
                    name = "Anthropic",
                    models = mapOf("claude" to ModelDto(id = "claude", name = "Claude", variants = listOf("low", "high"))),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT", variants = listOf("fast"))),
                ),
            ),
            connected = listOf("anthropic", "openai"),
            defaults = emptyMap(),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("openai/gpt", m.model.model)
        assertEquals(listOf("fast"), m.model.variants)

        edt { m.clearModelOverride() }
        flush()

        assertEquals("anthropic/claude", m.model.model)
        assertEquals(listOf("low", "high"), m.model.variants)
        assertEquals("high", m.model.variant)
    }

    fun `test configured variant resolves without legacy model state`() {
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(agent = mapOf("code" to AgentConfigDto(model = "kilo/gpt-5", variant = "high"))),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("high", m.model.variant)
    }

    fun `test unpinned agent variant applies to selected model`() {
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                model = "kilo/gpt-5",
                agent = mapOf("code" to AgentConfigDto(variant = "high")),
            ),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("high", m.model.variant)
    }

    fun `test unmatched agent model selects default variant`() {
        appRpc.models = ModelStateDto(model = mapOf("code" to ModelSelectionDto("openai", "gpt")))
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(agent = mapOf("code" to AgentConfigDto(model = "anthropic/claude", variant = "high"))),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "anthropic",
                    name = "Anthropic",
                    models = mapOf("claude" to ModelDto(id = "claude", name = "Claude", variants = listOf("low", "high"))),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT", variants = listOf("low", "high"))),
                ),
            ),
            connected = listOf("anthropic", "openai"),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("openai/gpt", m.model.model)
        assertEquals("default", m.model.variant)
    }

    fun `test absent or invalid config selects default variant`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        assertEquals("default", m.model.variant)

        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(agent = mapOf("code" to AgentConfigDto(model = "kilo/gpt-5", variant = "invalid"))),
        )
        flush()

        assertEquals("default", m.model.variant)
    }

    fun `test selectAgent uses saved model for selected agent`() {
        appRpc.models = ModelStateDto(model = mapOf("plan" to ModelSelectionDto("openai", "gpt")))
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            agents = listOf(
                AgentDto(name = "code", displayName = "Code", mode = "code"),
                AgentDto(name = "plan", displayName = "Plan", mode = "code"),
            ),
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5")),
                ),
                ProviderDto(
                    id = "openai",
                    name = "OpenAI",
                    models = mapOf("gpt" to ModelDto(id = "gpt", name = "GPT")),
                ),
            ),
            connected = listOf("kilo", "openai"),
            defaults = mapOf("code" to "kilo/gpt-5", "plan" to "kilo/gpt-5"),
        )
        val m = controller()
        collect(m)
        flush()

        edt { m.selectAgent("plan") }
        flush()

        assertEquals("openai/gpt", m.model.model)
        assertTrue(m.model.modelOverride)
    }

    fun `test selectVariant writes agent config variant`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "medium", "high")),
                    ),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt { m.selectVariant("high") }
        flush()

        assertEquals("high", m.model.variant)
        assertEquals("high", appRpc.configPatches.single().agents["code"]?.variant)
        assertEquals("high", appRpc.telemetry.last().properties["variant"])
    }

    fun `test explicit default writes config and telemetry`() {
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt { m.selectVariant("default") }
        flush()

        assertEquals("default", appRpc.configPatches.single().agents["code"]?.variant)
        assertEquals("default", appRpc.telemetry.last().properties["variant"])
    }

    fun `test variantless model ignores config selection and prompt variant`() {
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(model = "kilo/plain", agent = mapOf("code" to AgentConfigDto(variant = "default"))),
        )
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("plain" to ModelDto(id = "plain", name = "Plain")),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        assertNull(m.model.variant)
        edt {
            m.selectVariant("default")
            m.prompt("hello")
        }
        flush()

        assertTrue(appRpc.configPatches.isEmpty())
        assertNull(rpc.prompts.single().third.variant)
    }

    fun `test same agent variant writes serialize and persist the latest value`() {
        val first = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        val second = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += listOf(first, second)
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt {
            m.selectVariant("low")
            m.selectVariant("high")
        }
        runBlocking { withTimeout(1_000) { first.started.await() } }

        assertEquals(1, appRpc.configUpdateAttempts)
        assertEquals("high", m.model.variant)
        first.gate!!.complete(Unit)
        runBlocking { withTimeout(1_000) { second.started.await() } }

        assertEquals(2, appRpc.configUpdateAttempts)
        second.gate!!.complete(Unit)
        flush()

        assertEquals(listOf("low", "high"), appRpc.configPatches.map { it.agents.getValue("code").variant })
        assertEquals("high", m.model.variant)
    }

    fun `test latest failed variant write restores latest confirmed config`() {
        val first = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        val second = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred(), IllegalStateException("failed"))
        appRpc.configUpdates += listOf(first, second)
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt {
            m.selectVariant("high")
            m.selectVariant("low")
        }
        runBlocking { withTimeout(1_000) { first.started.await() } }
        first.gate!!.complete(Unit)
        runBlocking { withTimeout(1_000) { second.started.await() } }

        assertEquals("low", m.model.variant)
        second.gate!!.complete(Unit)
        flush()

        assertEquals("high", m.model.variant)
        assertEquals("high", appRpc.state.value.config?.agent?.get("code")?.variant)
    }

    fun `test stale variant completion does not change a newly selected agent`() {
        val update = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += update
        appRpc.state.value = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(
                model = "kilo/gpt-5",
                agent = mapOf("plan" to AgentConfigDto(model = "kilo/plan")),
            ),
        )
        projectRpc.state.value = workspaceReady(
            agents = listOf(
                AgentDto(name = "code", displayName = "Code", mode = "code"),
                AgentDto(name = "plan", displayName = "Plan", mode = "code"),
            ),
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high")),
                        "plan" to ModelDto(id = "plan", name = "Plan", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt { m.selectVariant("high") }
        runBlocking { withTimeout(1_000) { update.started.await() } }
        edt { m.selectAgent("plan") }
        update.gate!!.complete(Unit)
        flush()

        assertEquals("plan", m.model.agent)
        assertEquals("kilo/plan", m.model.model)
        assertEquals("default", m.model.variant)
    }

    fun `test stale unpinned variant write does not alter newly selected model`() {
        val update = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += update
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val m = controller()
        collect(m)
        flush()

        edt { m.selectVariant("high") }
        runBlocking { withTimeout(1_000) { update.started.await() } }
        edt { m.selectModel("kilo", "model-b") }
        update.gate!!.complete(Unit)
        flush()

        assertEquals("kilo/model-b", m.model.model)
        assertEquals("default", m.model.variant)
        assertEquals("high", appRpc.state.value.config?.agent?.get("code")?.variant)
    }

    fun `test stale unpinned variant write does not alter another controller model`() {
        val update = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += update
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val first = controller()
        val second = controller()
        collect(first)
        collect(second)
        flush()

        edt { first.selectVariant("high") }
        runBlocking { withTimeout(1_000) { update.started.await() } }
        edt { second.selectModel("kilo", "model-b") }
        update.gate!!.complete(Unit)
        flush()

        assertEquals("kilo/model-b", second.model.model)
        assertEquals("default", second.model.variant)
        assertEquals("high", appRpc.state.value.config?.agent?.get("code")?.variant)
    }

    fun `test redundant configured variant restores another controller model`() {
        val update = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += update
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val first = controller()
        val second = controller()
        collect(first)
        collect(second)
        flush()

        edt { first.selectVariant("high") }
        runBlocking { withTimeout(1_000) { update.started.await() } }
        edt { second.selectModel("kilo", "model-b") }
        update.gate!!.complete(Unit)
        flush()

        assertEquals("default", second.model.variant)
        edt { second.selectVariant("high") }
        flush()

        assertEquals("high", second.model.variant)
        assertEquals(listOf("high", "high"), appRpc.configPatches.map { it.agents.getValue("code").variant })
    }

    fun `test pinned config takes precedence over unpinned provenance`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val source = controller()
        val target = controller()
        collect(source)
        collect(target)
        flush()

        edt { source.selectVariant("high") }
        flush()
        app.updateConfigAsync(
            ConfigPatchDto(agents = mapOf("code" to AgentConfigPatchDto(model = "kilo/model-b", variant = "high"))),
        ) {}
        flush()
        edt { target.selectModel("kilo", "model-b") }
        flush()

        assertEquals("kilo/model-b", target.model.model)
        assertEquals("high", target.model.variant)
    }

    fun `test redundant configured variant refreshes passive controller model`() {
        val update = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += update
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val first = controller()
        val active = controller()
        val passive = controller()
        collect(first)
        collect(active)
        collect(passive)
        flush()

        edt { first.selectVariant("high") }
        runBlocking { withTimeout(1_000) { update.started.await() } }
        edt { active.selectModel("kilo", "model-b") }
        update.gate!!.complete(Unit)
        flush()

        assertEquals("default", passive.model.variant)
        edt { active.selectVariant("high") }
        flush()

        assertEquals("high", passive.model.variant)
    }

    fun `test failed redundant variant write restores passive controller provenance`() {
        val first = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        val second = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred(), IllegalStateException("failed"))
        appRpc.configUpdates += listOf(first, second)
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val source = controller()
        val active = controller()
        val passive = controller()
        collect(source)
        collect(active)
        collect(passive)
        flush()

        edt { source.selectVariant("high") }
        runBlocking { withTimeout(1_000) { first.started.await() } }
        edt { active.selectModel("kilo", "model-b") }
        first.gate!!.complete(Unit)
        flush()

        assertEquals("default", passive.model.variant)
        edt { active.selectVariant("high") }
        runBlocking { withTimeout(1_000) { second.started.await() } }
        flush()

        assertEquals("high", passive.model.variant)
        second.gate!!.complete(Unit)
        flush()

        assertEquals("default", passive.model.variant)
    }

    fun `test failed variant write restores provenance for passive controller models`() {
        val first = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        val second = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred(), IllegalStateException("failed"))
        appRpc.configUpdates += listOf(first, second)
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/model-a"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "model-a" to ModelDto(id = "model-a", name = "Model A", variants = listOf("low", "high")),
                        "model-b" to ModelDto(id = "model-b", name = "Model B", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val source = controller()
        val active = controller()
        val passive = controller()
        val other = controller()
        collect(source)
        collect(active)
        collect(passive)
        collect(other)
        flush()

        edt { source.selectVariant("high") }
        runBlocking { withTimeout(1_000) { first.started.await() } }
        edt { active.selectModel("kilo", "model-b") }
        first.gate!!.complete(Unit)
        flush()

        assertEquals("default", passive.model.variant)
        assertEquals("default", other.model.variant)
        edt { active.selectVariant("low") }
        runBlocking { withTimeout(1_000) { second.started.await() } }
        flush()

        assertEquals("high", passive.model.variant)
        assertEquals("high", other.model.variant)
        second.gate!!.complete(Unit)
        flush()

        assertEquals("default", passive.model.variant)
        assertEquals("default", other.model.variant)
    }

    fun `test shared app service serializes variant writes from two controllers`() {
        val first = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        val second = FakeAppRpcApi.ConfigUpdateOperation(CompletableDeferred())
        appRpc.configUpdates += listOf(first, second)
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf("gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5", variants = listOf("low", "high"))),
                ),
            ),
        )
        val firstController = controller()
        val secondController = controller()
        collect(firstController)
        collect(secondController)
        flush()

        edt {
            firstController.selectVariant("low")
            secondController.selectVariant("high")
        }
        runBlocking { withTimeout(1_000) { first.started.await() } }

        assertEquals(1, appRpc.configUpdateAttempts)
        first.gate!!.complete(Unit)
        runBlocking { withTimeout(1_000) { second.started.await() } }
        second.gate!!.complete(Unit)
        flush()

        assertEquals(listOf("low", "high"), appRpc.configPatches.map { it.agents.getValue("code").variant })
    }
}
