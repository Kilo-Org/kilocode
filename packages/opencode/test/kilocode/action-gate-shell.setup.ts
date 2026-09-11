// Enable the ActionGate tripwire BEFORE `tool/shell` and `gate/action-gate` are imported: `enabled` is
// read once at module load (process.env["KILO_ACTION_GATE"] === "1"). The integration test imports this
// FIRST so the real shell permission path exercises the tripwire. Run that test in its own process.
process.env["KILO_ACTION_GATE"] = "1"
