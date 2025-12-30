import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { CodeStyleExtractor } from '../CodeStyleExtractor.js'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock dependencies
vi.mock('glob')
vi.mock('node:fs/promises')

// ...existing code...
