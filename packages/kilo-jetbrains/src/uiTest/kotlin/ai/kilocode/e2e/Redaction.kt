package ai.kilocode.e2e

/** Removes descriptor credentials from anything that could reach the result file or an artifact. */
class Redactor(secrets: Iterable<String?>) {
    private val values = secrets
        .filterNotNull()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .distinctBy { it }

    val replacement = "[redacted]"

    fun text(value: String?): String? = value?.let { input ->
        values.fold(input) { current, secret -> current.replace(secret, replacement) }
    }

    fun map(value: Map<String, String>): Map<String, String> =
        value.mapValues { (_, item) -> text(item) ?: item }

    fun strings(value: Iterable<String>): List<String> = value.mapNotNull { text(it) }
}
