/**
 * Serializes the sends of one draft. A draft has no session id until its first send creates one, so two sends that
 * start together would each create a session. A send that starts while an earlier one runs waits, then adopts the
 * session that send created instead of reading the active tab, which the user may have switched meanwhile.
 */
export function createDraftSends() {
  const queues = new Map<string, Promise<string | undefined>>()

  return {
    /**
     * Runs `send` after every earlier send of `key`. `pressed` is the session the draft showed when the send was
     * pressed; undefined marks a draft whose session the earlier send may have created.
     */
    run<T extends { id: string }>(
      key: string,
      pressed: string | undefined,
      send: (existing: string | undefined) => Promise<T>,
    ): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve<string | undefined>(undefined)
      const started = previous.then((earlier) => send(pressed ?? earlier))
      // The next send of this draft waits for this one and adopts the session it created; a failed send releases it.
      const queued = started.then(
        (result) => result.id,
        () => undefined,
      )
      queues.set(key, queued)
      void queued.then(() => {
        if (queues.get(key) === queued) queues.delete(key)
      })
      return started
    },
  }
}
