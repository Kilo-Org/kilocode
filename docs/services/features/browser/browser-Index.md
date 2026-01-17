# Services - Browser Feature

**Quick Navigation for AI Agents**

---

## Overview

Browser automation service. Manages browser sessions for web interaction and URL content fetching.

**Source Location**: `src/services/browser/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| BrowserSession | Class | `BrowserSession.ts` |
| UrlContentFetcher | Class | `UrlContentFetcher.ts` |
| browserDiscovery | Functions | `browserDiscovery.ts` |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Launch browser | `launch()` | `BrowserSession.ts` |
| Navigate | `navigate()` | `BrowserSession.ts` |
| Click element | `click()` | `BrowserSession.ts` |
| Take screenshot | `screenshot()` | `BrowserSession.ts` |
| Fetch URL content | `fetch()` | `UrlContentFetcher.ts` |
| Close browser | `close()` | `BrowserSession.ts` |

---

## BrowserSession

Manages headless browser instance for automation.

**Features**:
- Launch/close browser
- Navigate to URLs
- Click, type, scroll
- Take screenshots
- Execute JavaScript

---

## UrlContentFetcher

Fetches and processes web page content.

**Features**:
- Fetch URL content
- Extract text from HTML
- Handle redirects
- Cache responses

---

## Related

- [Browser Tools](../../../core/features/tools/browser-tools/) - BrowserActionTool

---

[← Back to Services](../../Feature-Index.md)
