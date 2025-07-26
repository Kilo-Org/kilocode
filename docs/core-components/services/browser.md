# Browser Services

The browser services provide web automation capabilities, allowing the AI assistant to interact with web pages,
extract content, and perform browser-based tasks. This includes both automated browser control and URL content
fetching.

## Location

`src/services/browser/`

## Core Components

### BrowserSession.ts

Manages browser automation using Puppeteer with support for both local and remote browser instances.

**Key Features:**

- **Multi-browser support**: Local Chromium and remote browser connections
- **Tab management**: Intelligent tab switching and creation
- **Network monitoring**: Tracks network activity for better interaction timing
- **Screenshot capture**: High-quality screenshots with configurable quality
- **Error handling**: Comprehensive error recovery and reporting

### UrlContentFetcher.ts

Fetches and processes web content without full browser automation.

**Key Features:**

- **Content extraction**: Extract text content from web pages
- **Metadata parsing**: Extract page titles, descriptions, and metadata
- **Performance optimization**: Lightweight alternative to full browser automation
- **Caching**: Cache frequently accessed content

## Browser Session Architecture

### Connection Types

#### Local Browser

```typescript
private async launchLocalBrowser(): Promise<void> {
  const stats = await this.ensureChromiumExists()
  this.browser = await stats.puppeteer.launch({
    args: [
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    ],
    executablePath: stats.executablePath,
    defaultViewport: this.getViewport()
  })
  this.isUsingRemoteBrowser = false
}
```

#### Remote Browser Connection

```typescript
private async connectWithChromeHostUrl(chromeHostUrl: string): Promise<boolean> {
  try {
    this.browser = await connect({
      browserURL: chromeHostUrl,
      defaultViewport: this.getViewport()
    })

    this.context.globalState.update("cachedChromeHostUrl", chromeHostUrl)
    this.isUsingRemoteBrowser = true
    return true
  } catch (error) {
    console.log(`Failed to connect using WebSocket endpoint: ${error}`)
    return false
  }
}
```

### Tab Management

#### Intelligent Tab Switching

```typescript
async navigateToUrl(url: string): Promise<BrowserActionResult> {
  const normalizedNewUrl = url.replace(/\/$/, "")
  const rootDomain = this.getRootDomain(normalizedNewUrl)

  // Find existing tab with same root domain
  const pages = await this.browser.pages()
  let existingPage: Page | undefined

  for (const page of pages) {
    const pageUrl = page.url()
    if (pageUrl && this.getRootDomain(pageUrl) === rootDomain) {
      existingPage = page
      break
    }
  }

  if (existingPage) {
    // Switch to existing tab
    this.page = existingPage
    existingPage.bringToFront()
    // Navigate if URL is different
  } else {
    // Create new tab
    return this.createNewTab(normalizedNewUrl)
  }
}
```

#### Domain-Based Tab Organization

- **Root domain extraction**: Groups tabs by root domain
- **Smart navigation**: Reuses tabs for same domain
- **Tab creation**: Creates new tabs only when necessary

### Interaction Handling

#### Mouse Interactions

```typescript
private async handleMouseInteraction(
  page: Page,
  coordinate: string,
  action: (x: number, y: number) => Promise<void>
): Promise<void> {
  const [x, y] = coordinate.split(",").map(Number)

  // Monitor network activity
  let hasNetworkActivity = false
  const requestListener = () => { hasNetworkActivity = true }
  page.on("request", requestListener)

  // Perform action
  await action(x, y)
  this.currentMousePosition = coordinate

  // Wait for navigation if network activity detected
  if (hasNetworkActivity) {
    await page.waitForNavigation({
      waitUntil: ["domcontentloaded", "networkidle2"],
      timeout: BROWSER_NAVIGATION_TIMEOUT
    }).catch(() => {})
    await this.waitTillHTMLStable(page)
  }

  page.off("request", requestListener)
}
```

#### Supported Actions

- **Click**: Mouse clicks with network activity monitoring
- **Type**: Keyboard input with proper timing
- **Scroll**: Page scrolling with configurable amounts
- **Hover**: Mouse hover with visual feedback
- **Resize**: Browser window resizing

### Page Stability Detection

#### HTML Stability Monitoring

```typescript
private async waitTillHTMLStable(page: Page, timeout = 5_000) {
  const checkDurationMsecs = 500
  const maxChecks = timeout / checkDurationMsecs
  let lastHTMLSize = 0
  let checkCounts = 1
  let countStableSizeIterations = 0
  const minStableSizeIterations = 3

  while (checkCounts++ <= maxChecks) {
    const html = await page.content()
    const currentHTMLSize = html.length

    if (lastHTMLSize !== 0 && currentHTMLSize === lastHTMLSize) {
      countStableSizeIterations++
    } else {
      countStableSizeIterations = 0
    }

    if (countStableSizeIterations >= minStableSizeIterations) {
      break
    }

    lastHTMLSize = currentHTMLSize
    await delay(checkDurationMsecs)
  }
}
```

## Browser Discovery

### Automatic Discovery

```typescript
// In browserDiscovery.ts
export async function discoverChromeHostUrl(): Promise<string | null> {
	const commonPorts = [9222, 9223, 9224, 9225]

	for (const port of commonPorts) {
		const hostUrl = `http://localhost:${port}`
		if (await tryChromeHostUrl(hostUrl)) {
			return hostUrl
		}
	}

	return null
}
```

### Connection Validation

```typescript
export async function tryChromeHostUrl(hostUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${hostUrl}/json/version`, {
			method: "GET",
			timeout: 5000,
		})

		if (response.ok) {
			const data = await response.json()
			return data.webSocketDebuggerUrl !== undefined
		}
	} catch (error) {
		// Connection failed
	}

	return false
}
```

## Screenshot and Logging

### Screenshot Capture

```typescript
async doAction(action: (page: Page) => Promise<void>): Promise<BrowserActionResult> {
  // Execute action with logging
  const logs: string[] = []
  const consoleListener = (msg: any) => {
    logs.push(msg.type() === "log" ? msg.text() : `[${msg.type()}] ${msg.text()}`)
  }

  this.page.on("console", consoleListener)
  this.page.on("pageerror", errorListener)

  try {
    await action(this.page)
  } finally {
    // Capture screenshot
    const screenshotBase64 = await this.page.screenshot({
      encoding: "base64",
      type: "webp",
      quality: this.context.globalState.get("screenshotQuality") ?? 75
    })

    // Cleanup listeners
    this.page.off("console", consoleListener)
    this.page.off("pageerror", errorListener)

    return {
      screenshot: `data:image/webp;base64,${screenshotBase64}`,
      logs: logs.join("\n"),
      currentUrl: this.page.url(),
      currentMousePosition: this.currentMousePosition
    }
  }
}
```

### Console Logging

- **Real-time capture**: Captures console output during actions
- **Error tracking**: Tracks page errors and exceptions
- **Log aggregation**: Combines logs from multiple sources

## URL Content Fetching

### Content Extraction

```typescript
// In UrlContentFetcher.ts
export class UrlContentFetcher {
	async fetchContent(url: string): Promise<{
		content: string
		title?: string
		description?: string
		metadata?: Record<string, string>
	}> {
		const response = await fetch(url, {
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; KiroBot/1.0)",
			},
		})

		const html = await response.text()
		const parsed = this.parseHtml(html)

		return {
			content: this.extractTextContent(parsed),
			title: this.extractTitle(parsed),
			description: this.extractDescription(parsed),
			metadata: this.extractMetadata(parsed),
		}
	}
}
```

### Content Processing

- **HTML parsing**: Extract structured content from HTML
- **Text extraction**: Convert HTML to readable text
- **Metadata extraction**: Extract page metadata and structured data
- **Content cleaning**: Remove navigation, ads, and irrelevant content

## Configuration and Settings

### Browser Settings

```typescript
interface BrowserSettings {
	viewportSize: string // "900x600"
	screenshotQuality: number // 75
	remoteBrowserEnabled: boolean // false
	remoteBrowserHost?: string // "http://localhost:9222"
	cachedChromeHostUrl?: string // Cached connection URL
}
```

### Viewport Management

```typescript
private getViewport() {
  const size = this.context.globalState.get("browserViewportSize") || "900x600"
  const [width, height] = size.split("x").map(Number)
  return { width, height }
}
```

## Error Handling

### Connection Errors

```typescript
// Transport error handling
transport.onerror = async (error) => {
	console.error(`Transport error: ${error}`)
	// Attempt reconnection or fallback to local browser
}

transport.onclose = async () => {
	console.log("Browser connection closed")
	// Clean up resources
}
```

### Action Errors

- **Timeout handling**: Graceful handling of page load timeouts
- **Element not found**: Retry mechanisms for missing elements
- **Network errors**: Fallback strategies for network failures
- **Browser crashes**: Automatic browser restart and recovery

## Performance Optimizations

### Resource Management

- **Browser reuse**: Reuse browser instances across actions
- **Tab management**: Efficient tab creation and cleanup
- **Memory monitoring**: Monitor and manage memory usage

### Network Optimization

- **Request filtering**: Block unnecessary resources (ads, analytics)
- **Compression**: Enable response compression
- **Caching**: Cache static resources and content

### Rendering Optimization

- **Lazy loading**: Wait for content to load before interaction
- **Viewport optimization**: Optimize viewport size for performance
- **Image optimization**: Optimize screenshot quality vs. size

## Integration Points

### Task Integration

```typescript
// In Task.ts
this.browserSession = new BrowserSession(provider.context)

// Browser actions are executed through tools
const result = await this.browserSession.navigateToUrl(url)
```

### Tool Integration

Browser actions are exposed as tools:

- `browser_action`: Generic browser action tool
- Navigation, clicking, typing, scrolling actions
- Screenshot capture and content extraction

## Security Considerations

### Sandboxing

- **Process isolation**: Browser runs in separate process
- **Permission control**: Limited file system access
- **Network restrictions**: Configurable network access

### Content Security

- **URL validation**: Validate URLs before navigation
- **Content filtering**: Filter malicious content
- **Privacy protection**: Prevent tracking and fingerprinting

## Testing

### Unit Tests

- **Action testing**: Test individual browser actions
- **Error handling**: Test error scenarios and recovery
- **Configuration**: Test various browser configurations

### Integration Tests

- **End-to-end workflows**: Test complete browser automation flows
- **Cross-platform**: Test on different operating systems
- **Performance**: Test under various load conditions

## Future Enhancements

- **Mobile browser support**: Support for mobile browser automation
- **Advanced interactions**: Support for drag-and-drop, file uploads
- **Performance monitoring**: Real-time performance metrics
- **AI-powered interactions**: Intelligent element detection and interaction
- **Accessibility support**: Better support for accessibility features
