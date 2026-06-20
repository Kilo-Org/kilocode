// kilocode_change - smoke tests for the createEffect wiring in
// packages/opencode/src/kilocode/cli/cmd/tui/app.tsx. These do not exercise
// the createEffect itself — that requires Solid contexts and is out of
// scope here. They verify that the primitives compose correctly.
import { beforeEach, describe, expect, test } from 'bun:test'
import { TuiAutoApprove } from '../../../src/kilocode/cli/cmd/tui/auto-approve'

describe('tui auto-approve wiring', () => {
  beforeEach(() => {
    TuiAutoApprove.reset()
  })

  test('scope includes root and direct parentID children only', () => {
    TuiAutoApprove.set('root', true)
    const sessions = [
      { id: 'root' },
      { id: 'child1', parentID: 'root' },
      { id: 'grandchild', parentID: 'child1' },
    ]
    const scope = TuiAutoApprove.scope('root', sessions)
    expect([...scope].sort()).toEqual(['child1', 'root'])
    // grandchild is NOT included — only direct children
  })

  test('reset clears all state including queued and replies', () => {
    TuiAutoApprove.pending(true)
    TuiAutoApprove.set('ses_a', true)
    TuiAutoApprove.mark('ses_a', 'req_1')
    TuiAutoApprove.reset()
    expect(TuiAutoApprove.enabled('ses_a')).toBe(false)
    expect(TuiAutoApprove.next()).toBe(false)
    expect(TuiAutoApprove.shouldReply('ses_a', 'req_1')).toBe(false)
  })

  test('reply error path: mark then unmark releases the request for retry', () => {
    TuiAutoApprove.set('ses_a', true)
    expect(TuiAutoApprove.mark('ses_a', 'req_1')).toBe(true)
    expect(TuiAutoApprove.shouldReply('ses_a', 'req_1')).toBe(false)
    TuiAutoApprove.unmark('ses_a', 'req_1')
    expect(TuiAutoApprove.shouldReply('ses_a', 'req_1')).toBe(true)
  })

  test('prune preserves sessions still in active set', () => {
    TuiAutoApprove.set('ses_a', true)
    TuiAutoApprove.set('ses_b', true)
    TuiAutoApprove.prune(new Set(['ses_b']))
    expect(TuiAutoApprove.enabled('ses_a')).toBe(false)
    expect(TuiAutoApprove.enabled('ses_b')).toBe(true)
  })
})
