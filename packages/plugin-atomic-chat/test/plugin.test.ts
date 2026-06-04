import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AtomicChatPlugin } from '../src/index'
import { ATOMIC_CHAT_PROVIDER_KEY } from '../src/constants'
import { sharedModelStatusCache } from '../src/cache/shared-model-status-cache'

const mockFetch = vi.fn()
global.fetch = mockFetch

if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    return controller.signal
  })
}

describe('AtomicChatPlugin', () => {
  let mockClient: any
  let pluginHooks: any

  beforeEach(async () => {
    mockFetch.mockClear()
    sharedModelStatusCache.invalidateAll()
    mockClient = {
      tui: {
        showToast: vi.fn().mockResolvedValue(true),
      },
    }
    const mockInput: any = {
      client: mockClient,
      project: {
        id: 'test-project',
        name: 'test',
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() },
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn(),
    }
    pluginHooks = await AtomicChatPlugin(mockInput)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes hooks', async () => {
    const mockInput: any = {
      client: mockClient,
      project: {
        id: 'test-project',
        name: 'test',
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() },
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn(),
    }
    const hooks = await AtomicChatPlugin(mockInput)
    expect(hooks.config).toBeTypeOf('function')
    expect(hooks.event).toBeTypeOf('function')
    expect(hooks['chat.params']).toBeTypeOf('function')
  })

  it('registers optional local-server auth (no API key required)', async () => {
    expect(pluginHooks.auth?.provider).toBe(ATOMIC_CHAT_PROVIDER_KEY)
    expect(pluginHooks.auth?.methods[0]?.type).toBe('api')
    expect(pluginHooks.auth?.methods[0]?.label).toBe('Local server')
  })

  it('handles invalid client', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = await AtomicChatPlugin({ client: null } as any)
    expect(hooks.config).toBeTypeOf('function')
    expect(consoleSpy).toHaveBeenCalledWith('[@kilocode/plugin-atomic-chat] Invalid client provided to plugin')
    consoleSpy.mockRestore()
  })

  describe('config hook', () => {
    it('rejects invalid config', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await pluginHooks.config(null)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('does not probe localhost when Atomic Chat is not configured', async () => {
      const config: any = {}
      await pluginHooks.config(config)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(config.provider?.[ATOMIC_CHAT_PROVIDER_KEY]).toBeUndefined()
    })

    it('auto-detects only when atomicChat.autoDetect is enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'm1', object: 'model', created: 1, owned_by: 'local' }],
        }),
      })

      const config: any = { atomicChat: { autoDetect: true } }
      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalled()
      expect(config.provider?.[ATOMIC_CHAT_PROVIDER_KEY]).toBeDefined()
      expect(config.provider[ATOMIC_CHAT_PROVIDER_KEY].options.baseURL).toBe('http://127.0.0.1:1337/v1')
    })

    it('merges discovered models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'new-model', object: 'model', created: 1, owned_by: 'local' }],
        }),
      })

      const config: any = {
        provider: {
          [ATOMIC_CHAT_PROVIDER_KEY]: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Atomic Chat (local)',
            options: { baseURL: 'http://127.0.0.1:1337/v1' },
            models: {
              'existing-model': { name: 'Existing Model' },
            },
          },
        },
      }

      await pluginHooks.config(config)

      expect(config.provider[ATOMIC_CHAT_PROVIDER_KEY].models).toEqual({
        'existing-model': { name: 'Existing Model' },
        'new-model': expect.objectContaining({
          id: 'new-model',
          name: 'New Model',
        }),
      })
    })

    it('handles offline API', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          [ATOMIC_CHAT_PROVIDER_KEY]: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Atomic Chat (local)',
            options: { baseURL: 'http://127.0.0.1:1337/v1' },
          },
        },
      }
      await pluginHooks.config(config)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('event hook', () => {
    it('validates event', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await pluginHooks.event({ event: null })
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('accepts session events', async () => {
      await pluginHooks.event({ event: { type: 'session.created' } })
      expect(true).toBe(true)
    })
  })

  describe('chat.params hook', () => {
    it('rejects invalid input', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await pluginHooks['chat.params'](null, {})
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('skips other providers', async () => {
      const output: any = {}
      await pluginHooks['chat.params'](
        {
          model: { id: 'x' },
          provider: { info: { id: 'anthropic' } },
        },
        output
      )
      expect(output).toEqual({})
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })

    it('validates model availability', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ id: 'test-model', object: 'model', created: 1, owned_by: 'local' }],
        }),
      })

      const output: any = {}
      await pluginHooks['chat.params'](
        {
          sessionID: 's1',
          model: { id: 'test-model' },
          provider: {
            info: { id: ATOMIC_CHAT_PROVIDER_KEY },
            options: { baseURL: 'http://127.0.0.1:1337/v1' },
          },
        },
        output
      )

      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
      expect(output.options?.atomicChatValidation).toEqual(
        expect.objectContaining({ status: 'success', model: 'test-model' })
      )
    })

    it('handles missing model', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      })

      const output: any = {}
      await pluginHooks['chat.params'](
        {
          sessionID: 's1',
          model: { id: 'missing' },
          provider: {
            info: { id: ATOMIC_CHAT_PROVIDER_KEY },
            options: { baseURL: 'http://127.0.0.1:1337/v1' },
          },
        },
        output
      )

      expect(output.options?.atomicChatValidation).toEqual(
        expect.objectContaining({ status: 'error', model: 'missing' })
      )
    })
  })
})
