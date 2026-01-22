package ai.kilocode.jetbrains.monitoring

import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.isActive
import java.util.concurrent.ConcurrentHashMap

object ScopeRegistry {
    private val logger = Logger.getInstance(ScopeRegistry::class.java)
    private val scopes = ConcurrentHashMap<String, CoroutineScope>()
    
    fun register(name: String, scope: CoroutineScope) {
        scopes[name] = scope
        logger.info("Registered coroutine scope: $name")
    }
    
    fun unregister(name: String) {
        scopes.remove(name)
        logger.info("Unregistered coroutine scope: $name")
    }
    
    fun getActiveScopes(): Map<String, Boolean> {
        return scopes.mapValues { it.value.isActive }
    }
    
    fun logScopeStatus() {
        val activeScopes = getActiveScopes()
        logger.info("Coroutine scope status (${activeScopes.size} total):")
        activeScopes.forEach { (name, isActive) ->
            logger.info("  $name: ${if (isActive) "ACTIVE" else "INACTIVE"}")
        }
    }
}
