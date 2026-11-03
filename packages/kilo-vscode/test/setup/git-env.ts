// Test Git commands must not rewrite line endings: the assertions compare LF content,
// and Windows Git defaults to core.autocrlf=true.
process.env.GIT_CONFIG_COUNT = "2"
process.env.GIT_CONFIG_KEY_0 = "core.autocrlf"
process.env.GIT_CONFIG_VALUE_0 = "false"
process.env.GIT_CONFIG_KEY_1 = "core.eol"
process.env.GIT_CONFIG_VALUE_1 = "lf"
