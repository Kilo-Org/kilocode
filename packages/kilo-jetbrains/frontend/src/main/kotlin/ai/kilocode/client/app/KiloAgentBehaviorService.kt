@file:Suppress("UnstableApiUsage")

package ai.kilocode.client.app

import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.KiloAgentBehaviorRpcApi
import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.openapi.components.Service
import fleet.rpc.client.durable
import kotlinx.coroutines.CoroutineScope

@Service(Service.Level.APP)
class KiloAgentBehaviorService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: KiloAgentBehaviorRpcApi?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = KiloLog.create(KiloAgentBehaviorService::class.java)
    }

    private suspend fun <T> call(block: suspend KiloAgentBehaviorRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(KiloAgentBehaviorRpcApi.getInstance()) }
    }

    suspend fun agents(directory: String): List<AgentDetailDto> = safe(emptyList()) { call { agents(directory) } }

    suspend fun skills(directory: String): List<SkillDto> = safe(emptyList()) { call { skills(directory) } }

    suspend fun loadSkills(directory: String): List<SkillDto> = call { skills(directory) }

    suspend fun refreshSkills(directory: String, fallback: List<SkillDto>): List<SkillDto> = safe(fallback) { call { skills(directory) } }

    suspend fun commands(directory: String): List<CommandDto> = safe(emptyList()) { call { commands(directory) } }

    suspend fun mcpStatus(directory: String): List<McpStatusDto> = try {
        LOG.info("mcp status: requesting dir=$directory")
        call { mcpStatus(directory) }.also { LOG.info("mcp status: received dir=$directory count=${it.size}") }
    } catch (e: Exception) {
        LOG.warn("mcp status failed dir=$directory", e)
        emptyList()
    }

    suspend fun mcpConfig(directory: String): Map<String, McpServerConfigDto> = safe(emptyMap()) { call { mcpConfig(directory) } }

    suspend fun saveMcp(directory: String, name: String, scope: String, config: McpConfigDto?): Boolean =
        safe(false) { call { saveMcp(directory, name, scope, config) } }

    suspend fun removeSkill(directory: String, location: String): Boolean = safe(false) { call { removeSkill(directory, location) } }

    suspend fun reloadSkills(directory: String): Boolean = safe(false) { call { reloadSkills(directory) } }

    suspend fun saveSkill(directory: String, location: String, content: String): Boolean =
        safe(false) { call { saveSkill(directory, location, content) } }

    suspend fun removeAgent(directory: String, name: String): Boolean = safe(false) { call { removeAgent(directory, name) } }

    suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean = safe(false) { call { createAgent(directory, input) } }

    suspend fun mcpConnect(directory: String, name: String): Boolean = safe(false) { call { mcpConnect(directory, name) } }

    suspend fun mcpDisconnect(directory: String, name: String): Boolean = safe(false) { call { mcpDisconnect(directory, name) } }

    suspend fun mcpAuthenticate(directory: String, name: String): Boolean = safe(false) { call { mcpAuthenticate(directory, name) } }

    suspend fun claudeCodeCompat(): Boolean = safe(false) { call { claudeCodeCompat() } }

    suspend fun setClaudeCodeCompat(value: Boolean): Boolean = safe(false) { call { setClaudeCodeCompat(value) } }

    private suspend fun <T> safe(fallback: T, block: suspend () -> T): T = try {
        block()
    } catch (e: Exception) {
        LOG.warn("agent behavior RPC failed", e)
        fallback
    }
}
