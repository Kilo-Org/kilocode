package ai.kilocode.client.agentManager.worktree

import kotlin.random.Random

/**
 * Generates friendly two-word worktree branch names like "ambitious-keyboard", mirroring the
 * VS Code Agent Manager (which uses the `friendly-words` package). Uses a curated adjective/noun
 * pair so the plugin does not have to bundle the full multi-thousand word lists, and avoids names
 * already present in [taken] with a numeric suffix fallback.
 */
internal object WorktreeNames {
    private const val ATTEMPTS = 10
    private const val MAX_SUFFIX = 100

    private val adjectives = listOf(
        "ambitious", "brave", "calm", "clever", "cosmic", "curious", "daring", "eager", "electric",
        "fancy", "fearless", "fluffy", "gentle", "glowing", "happy", "hidden", "humble", "jolly",
        "keen", "lively", "lucky", "mellow", "mighty", "nimble", "playful", "polished", "quiet",
        "quirky", "rapid", "restless", "shiny", "silent", "sleepy", "snappy", "spry", "sturdy",
        "swift", "tidy", "vivid", "witty", "zesty", "bold", "breezy", "crisp", "dapper", "frosty",
        "golden", "merry", "plucky", "wandering",
    )

    private val nouns = listOf(
        "keyboard", "otter", "falcon", "comet", "harbor", "lantern", "meadow", "nebula", "pebble",
        "quokka", "raccoon", "sparrow", "thunder", "walrus", "willow", "acorn", "badger", "cactus",
        "canyon", "dolphin", "ember", "ferret", "glacier", "hedgehog", "iceberg", "jaguar", "koala",
        "lynx", "mango", "narwhal", "orchid", "panther", "quartz", "reef", "sequoia", "tundra",
        "urchin", "viper", "wombat", "yak", "zephyr", "anchor", "beacon", "cobble", "dune", "fjord",
        "grove", "harvest", "island", "junction",
    )

    fun generate(taken: Set<String>, random: Random = Random.Default): String {
        val existing = taken.mapTo(HashSet()) { it.lowercase() }
        fun pick() = "${adjectives.random(random)}-${nouns.random(random)}"
        repeat(ATTEMPTS) {
            val name = pick()
            if (name !in existing) return name
        }
        val base = pick()
        for (i in 0 until MAX_SUFFIX) {
            val name = "$base-$i"
            if (name !in existing) return name
        }
        return "$base-${System.currentTimeMillis()}"
    }
}
