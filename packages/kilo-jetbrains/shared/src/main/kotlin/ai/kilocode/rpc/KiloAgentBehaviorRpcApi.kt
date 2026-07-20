package ai.kilocode.rpc

import ai.kilocode.rpc.dto.AgentDetailDto
import ai.kilocode.rpc.dto.AgentCreateDto
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.McpConfigDto
import ai.kilocode.rpc.dto.McpServerConfigDto
import ai.kilocode.rpc.dto.McpStatusDto
import ai.kilocode.rpc.dto.SkillDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

@Rpc
interface KiloAgentBehaviorRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): KiloAgentBehaviorRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<KiloAgentBehaviorRpcApi>())
        }
    }

    suspend fun agents(directory: String): List<AgentDetailDto>

    suspend fun skills(directory: String): List<SkillDto>

    suspend fun removeSkill(directory: String, location: String): Boolean

    suspend fun reloadSkills(directory: String): Boolean

    suspend fun saveSkill(directory: String, location: String, content: String): Boolean

    suspend fun removeAgent(directory: String, name: String): Boolean

    suspend fun createAgent(directory: String, input: AgentCreateDto): Boolean

    suspend fun commands(directory: String): List<CommandDto>

    suspend fun mcpStatus(directory: String): List<McpStatusDto>

    suspend fun mcpConfig(directory: String): Map<String, McpServerConfigDto>

    suspend fun saveMcp(directory: String, name: String, scope: String, config: McpConfigDto?): Boolean

    suspend fun mcpConnect(directory: String, name: String): Boolean

    suspend fun mcpDisconnect(directory: String, name: String): Boolean

    suspend fun mcpAuthenticate(directory: String, name: String): Boolean

    suspend fun claudeCodeCompat(): Boolean

    suspend fun setClaudeCodeCompat(value: Boolean): Boolean
}
