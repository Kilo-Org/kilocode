// kilocode_change - new file
// A worker that dies while evaluating its module graph — before `Rpc.listen` can install a handler,
// and so before it can ever announce one.
throw new Error("worker failed before Rpc.listen")
