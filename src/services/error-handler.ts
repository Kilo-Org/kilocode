/**
 * Error Handling and Logging Infrastructure
 * 
 * Centralized error handling and structured logging for the diff system
 */

import * as vscode from 'vscode';

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  component: string;
  message: string;
  data?: any;
  error?: Error;
}

export interface DiffSystemError extends Error {
  code: string;
  component: string;
  context?: any;
}

/**
 * Centralized logger for the diff system
 */
export class Logger {
  private static readonly LOG_PREFIX = '[DiffSystem]';
  private static outputChannel: vscode.OutputChannel;

  /**
   * Initialize logger
   */
  static initialize(context: vscode.ExtensionContext): void {
    Logger.outputChannel = vscode.window.createOutputChannel('Diff System');
    context.subscriptions.push(Logger.outputChannel);
  }

  /**
   * Log debug message
   */
  static debug(component: string, message: string, data?: any): void {
    Logger.log('debug', component, message, data);
  }

  /**
   * Log info message
   */
  static info(component: string, message: string, data?: any): void {
    Logger.log('info', component, message, data);
  }

  /**
   * Log warning message
   */
  static warn(component: string, message: string, data?: any): void {
    Logger.log('warn', component, message, data);
  }

  /**
   * Log error message
   */
  static error(component: string, message: string, error?: Error, data?: any): void {
    Logger.log('error', component, message, data, error);
  }

  /**
   * Create and log diff system error
   */
  static createError(
    code: string,
    component: string,
    message: string,
    context?: any
  ): DiffSystemError {
    const error = Object.assign(new Error(message), {
      code,
      component,
      context
    }) as DiffSystemError;
    
    Logger.error(component, message, error, context);
    return error;
  }

  /**
   * Handle and log error from try-catch
   */
  static handleError(
    component: string,
    error: unknown,
    context?: any
  ): DiffSystemError | null {
    if (error instanceof Error) {
      const diffError = Logger.createError(
        'UNKNOWN_ERROR',
        component,
        error.message,
        context
      );
      diffError.stack = error.stack;
      return diffError;
    } else if (typeof error === 'string') {
      return Logger.createError('UNKNOWN_ERROR', component, error, context);
    } else {
      return Logger.createError(
        'UNKNOWN_ERROR',
        component,
        'Unknown error occurred',
        context
      );
    }
  }

  /**
   * Show error to user and log
   */
  static showUserError(error: DiffSystemError): void {
    vscode.window.showErrorMessage(`Diff System Error: ${error.message}`);
    Logger.error(error.component, 'User error displayed', error);
  }

  /**
   * Show warning to user and log
   */
  static showUserWarning(message: string, component?: string): void {
    vscode.window.showWarningMessage(`Diff System: ${message}`);
    Logger.warn(component || 'Unknown', 'User warning displayed', { message });
  }

  /**
   * Show info to user and log
   */
  static showUserInfo(message: string, component?: string): void {
    vscode.window.showInformationMessage(`Diff System: ${message}`);
    Logger.info(component || 'Unknown', 'User info displayed', { message });
  }

  /**
   * Internal logging method
   */
  private static log(
    level: LogEntry['level'],
    component: string,
    message: string,
    data?: any,
    error?: Error
  ): void {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      data,
      error
    };

    // Format log message
    const formattedMessage = Logger.formatLogMessage(logEntry);
    
    // Output to VSCode channel
    if (Logger.outputChannel) {
      Logger.outputChannel.appendLine(formattedMessage);
    }

    // Also output to console for development
    if (process.env.NODE_ENV === 'development') {
      console.log(formattedMessage);
    }
  }

  /**
   * Format log message consistently
   */
  private static formatLogMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = entry.level.toUpperCase().padEnd(5, ' ');
    const component = entry.component.padEnd(20, ' ');
    
    let message = `${timestamp} ${level} ${component} ${entry.message}`;
    
    if (entry.data) {
      message += ` | Data: ${JSON.stringify(entry.data)}`;
    }
    
    if (entry.error) {
      message += ` | Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\nStack: ${entry.error.stack}`;
      }
    }
    
    return message;
  }

  /**
   * Get recent logs for debugging
   */
  static getRecentLogs(count: number = 100): LogEntry[] {
    // This would require storing logs in memory
    // For now, return empty array
    return [];
  }

  /**
   * Clear log output
   */
  static clear(): void {
    if (Logger.outputChannel) {
      Logger.outputChannel.clear();
    }
  }

  /**
   * Show log output channel
   */
  static show(): void {
    if (Logger.outputChannel) {
      Logger.outputChannel.show();
    }
  }
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  /**
   * Safe execution with error handling
   */
  static async safeExecute<T>(
    operation: () => Promise<T>,
    component: string,
    errorMessage?: string
  ): Promise<{ success: boolean; result?: T; error?: DiffSystemError }> {
    try {
      const result = await operation();
      return { success: true, result };
    } catch (error) {
      const diffError = Logger.handleError(component, error);
      if (errorMessage && diffError) {
        Logger.showUserError(diffError);
      }
      return { success: false, error: diffError || undefined };
    }
  }

  /**
   * Safe synchronous execution with error handling
   */
  static safeExecuteSync<T>(
    operation: () => T,
    component: string,
    errorMessage?: string
  ): { success: boolean; result?: T; error?: DiffSystemError } {
    try {
      const result = operation();
      return { success: true, result };
    } catch (error) {
      const diffError = Logger.handleError(component, error);
      if (errorMessage && diffError) {
        Logger.showUserError(diffError);
      }
      return { success: false, error: diffError || undefined };
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retry<T>(
    operation: () => Promise<T>,
    component: string,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<{ success: boolean; result?: T; error?: DiffSystemError }> {
    let lastError: DiffSystemError | undefined;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 0) {
          Logger.info(component, `Operation succeeded on attempt ${attempt + 1}`);
        }
        return { success: true, result };
      } catch (error) {
        lastError = Logger.handleError(component, error);
        
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          Logger.warn(component, `Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    Logger.error(component, `All ${maxRetries + 1} attempts failed`, lastError);
    return { success: false, error: lastError };
  }
}
