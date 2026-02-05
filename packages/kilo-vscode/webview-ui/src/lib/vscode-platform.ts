/**
 * VS Code Platform adapter
 * 
 * This implements the Platform interface from opencode-app for use in VS Code webviews.
 * Instead of native capabilities, it uses VS Code webview APIs and message passing.
 */

import type { Platform } from '@/context/platform';
import { postMessage } from './transport';

/**
 * Create a Platform implementation for VS Code webviews
 */
export function createVsCodePlatform(): Platform {
  // Simple in-memory storage fallback for VS Code webview
  const memoryStorage = new Map<string, string>();
  
  const storage = () => ({
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, value); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
    clear: () => { memoryStorage.clear(); },
    key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
    get length() { return memoryStorage.size; },
  });

  return {
    platform: 'web',

    openLink(url: string) {
      // Send message to extension to open link
      postMessage({
        type: 'action',
        action: 'openLink',
        // @ts-expect-error - extending protocol for this use case
        url,
      });
    },

    async restart() {
      // Not applicable in VS Code webview - reload the webview
      window.location.reload();
    },

    back() {
      window.history.back();
    },

    forward() {
      window.history.forward();
    },

    async notify(title: string, description?: string, _href?: string) {
      // Send notification to extension host
      postMessage({
        type: 'action',
        action: 'notify',
        // @ts-expect-error - extending protocol for this use case
        title,
        description,
      });
    },

    storage,

    // Use native fetch - VS Code webviews have fetch available
    fetch: window.fetch.bind(window),

    getDefaultServerUrl() {
      // This will be provided by the extension host
      return null;
    },

    setDefaultServerUrl(_url: string | null) {
      // Not applicable - extension manages this
    },
  };
}
