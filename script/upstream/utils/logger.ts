#!/usr/bin/env bun
/**
 * Logger utilities for upstream merge automation
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "success"

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
}

const levelColors: Record<LogLevel, string> = {
  debug: colors.dim,
  info: colors.blue,
  warn: colors.yellow,
  error: colors.red,
  success: colors.green,
}

const levelPrefixes: Record<LogLevel, string> = {
  debug: "[DEBUG]",
  info: "[INFO]",
  warn: "[WARN]",
  error: "[ERROR]",
  success: "[OK]",
}

let verbose = false

export function setVerbose(value: boolean): void {
  verbose = value
}

export function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (level === "debug" && !verbose) return

  const color = levelColors[level]
  const prefix = levelPrefixes[level]

  console.log(`${color}${prefix}${colors.reset} ${message}`, ...args)
}

export function debug(message: string, ...args: unknown[]): void {
  log("debug", message, ...args)
}

export function info(message: string, ...args: unknown[]): void {
  log("info", message, ...args)
}

export function warn(message: string, ...args: unknown[]): void {
  log("warn", message, ...args)
}

export function error(message: string, ...args: unknown[]): void {
  log("error", message, ...args)
}

export function success(message: string, ...args: unknown[]): void {
  log("success", message, ...args)
}

export function header(title: string): void {
  console.log()
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`)
  console.log(`${colors.cyan}  ${title}${colors.reset}`)
  console.log(`${colors.cyan}${"=".repeat(60)}${colors.reset}`)
  console.log()
}

export function step(number: number, total: number, description: string): void {
  console.log(`${colors.magenta}[${number}/${total}]${colors.reset} ${description}`)
}

export function list(items: string[], indent = 2): void {
  const spaces = " ".repeat(indent)
  for (const item of items) {
    console.log(`${spaces}${colors.dim}-${colors.reset} ${item}`)
  }
}

export function divider(): void {
  console.log(`${colors.dim}${"-".repeat(60)}${colors.reset}`)
}
