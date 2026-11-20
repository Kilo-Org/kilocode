package ai.kilocode.backend.app

import ai.kilocode.backend.settings.*
import ai.kilocode.rpc.dto.*
import com.intellij.openapi.application.PathManager
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

/** All split-mode clients of this IDE share the backend's picker preferences. */
class KiloBackendModelStateManager(
    private val file: Path = Path.of(PathManager.getConfigPath(), "kilo2", "model.json")
) {
    private val mutex = Mutex()

    suspend fun state() = withContext(Dispatchers.IO) { mutex.withLock { parse(read()) } }

    suspend fun favorite(update: ModelFavoriteUpdateDto) = change { state ->
        val ref = ModelSelectionDto(update.providerID, update.modelID)
        state.copy(
            favorite =
                when (update.action) {
                    "add" ->
                        if (ref in state.favorite) state.favorite else listOf(ref) + state.favorite
                    "remove" -> state.favorite - ref
                    else -> state.favorite
                }
        )
    }

    suspend fun selection(update: ModelSelectionUpdateDto) = change {
        it.copy(
            model =
                it.model + (update.agent to ModelSelectionDto(update.providerID, update.modelID))
        )
    }

    suspend fun variant(update: ModelVariantUpdateDto) = change {
        it.copy(variant = it.variant + (update.key to update.value))
    }

    private suspend fun change(transform: (ModelStateDto) -> ModelStateDto): ModelStateDto =
        withContext(Dispatchers.IO) {
            mutex.withLock {
                val raw = read()
                val state = transform(parse(raw))
                val value =
                    JsonObject(
                        raw +
                            buildJsonObject {
                                put("favorite", JsonArray(state.favorite.map(::ref)))
                                put("model", JsonObject(state.model.mapValues { ref(it.value) }))
                                put("variant", state.variant.asJson())
                                put("recent", JsonArray(state.recent.map(::ref)))
                            }
                    )
                Files.createDirectories(file.parent)
                val temp = Files.createTempFile(file.parent, "model", ".json")
                try {
                    Files.writeString(temp, value.toString())
                    Files.move(
                        temp,
                        file,
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE,
                    )
                } finally {
                    Files.deleteIfExists(temp)
                }
                state
            }
        }

    private fun read() =
        if (Files.exists(file))
            runCatching { Json.parseToJsonElement(Files.readString(file)).jsonObject }
                .getOrDefault(emptyObject)
        else emptyObject

    private fun ref(value: ModelSelectionDto) =
        mapOf("providerID" to value.providerID, "modelID" to value.modelID).asJson()

    private fun parseRef(value: JsonElement): ModelSelectionDto? {
        val obj = value as? JsonObject ?: return null
        return ModelSelectionDto(
            obj.text("providerID") ?: return null,
            obj.text("modelID") ?: return null,
        )
    }

    private fun parse(obj: JsonObject): ModelStateDto =
        ModelStateDto(
            (obj["favorite"] as? JsonArray).orEmpty().mapNotNull(::parseRef),
            obj.obj("model").mapNotNull { (k, v) -> parseRef(v)?.let { k to it } }.toMap(),
            obj.obj("variant")
                .mapNotNull { (k, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { k to it } }
                .toMap(),
            (obj["recent"] as? JsonArray).orEmpty().mapNotNull(::parseRef),
        )
}
