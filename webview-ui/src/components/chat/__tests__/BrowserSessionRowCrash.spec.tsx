
import { render, screen } from '@testing-library/react'
import BrowserSessionRow from '../BrowserSessionRow'
import { ClineMessage } from '@roo-code/types'
import React from 'react'
import { TooltipProvider } from '@src/components/ui/tooltip'

// Mock dependencies
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: any) => {
          if (key === 'chat:browser.actions.clicked' && options?.coordinate) {
              return `Clicked ${options.coordinate}`
          }
          if (key === 'chat:browser.actions.pressed' && options?.key) {
              return `Pressed ${options.key}`
          }
          if (key === 'chat:browser.actions.typed' && options?.text) {
               return `Typed ${options.text}`
          }
          if (key === 'chat:browser.actions.resized' && options?.size) {
              return `Resized to ${options.size}` // Changed to expect formatted size
          }

          return key
      },
    }),
    initReactI18next: {
      type: '3rdParty',
      init: () => {},
    },
  }
})

vi.mock('@src/utils/vscode', () => ({
  vscode: {
    postMessage: vi.fn(),
  },
}))

vi.mock('@src/context/ExtensionStateContext', () => ({
  useExtensionState: () => ({
    browserViewportSize: '900x600',
    isBrowserSessionActive: true,
  }),
}))

vi.mock('../kilocode/common/CodeBlock', () => ({
  default: ({ source }: { source: string }) => <div>{source}</div>,
}))

describe('BrowserSessionRow Crash Reproduction', () => {
    it('should handle non-string text in press action', () => {
         const messages: ClineMessage[] = [
            {
                ts: 1234567890,
                type: 'say',
                say: 'browser_action',
                text: JSON.stringify({
                    action: 'press',
                    // @ts-ignore - Simulating invalid type
                    text: 12345
                })
            },
             {
                ts: 1234567891,
                type: 'say',
                say: 'browser_action_result',
                text: JSON.stringify({
                     currentUrl: 'http://example.com',
                     logs: '',
                     screenshot: '',
                     currentMousePosition: '',
                     viewportWidth: 900,
                     viewportHeight: 600
                 })
             }
        ]

        expect(() => {
             render(
                <TooltipProvider>
                    <BrowserSessionRow
                        messages={messages}
                        isExpanded={() => true}
                        onToggleExpand={() => {}}
                        isLast={true}
                        isStreaming={false}
                    />
                </TooltipProvider>
            )
        }).not.toThrow()
    })

    it('should handle non-string size in resize action', () => {
        const messages: ClineMessage[] = [
           {
               ts: 1234567892,
               type: 'say',
               say: 'browser_action',
               text: JSON.stringify({
                   action: 'resize',
                   // @ts-ignore - Simulating invalid type
                   size: 12345
               })
           },
            {
               ts: 1234567893,
               type: 'say',
               say: 'browser_action_result',
               text: JSON.stringify({
                    currentUrl: 'http://example.com',
                    logs: '',
                    screenshot: '',
                    currentMousePosition: '',
                    viewportWidth: 900,
                    viewportHeight: 600
                })
            }
       ]

       expect(() => {
            render(
               <TooltipProvider>
                   <BrowserSessionRow
                       messages={messages}
                       isExpanded={() => true}
                       onToggleExpand={() => {}}
                       isLast={true}
                       isStreaming={false}
                   />
               </TooltipProvider>
           )
       }).not.toThrow()
   })
})
