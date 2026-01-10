/**
 * Memory Management Service
 * 
 * Manages memory usage for large file operations and diff processing
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  percentage: number;
}

export interface MemoryThresholds {
  warningThreshold: number; // percentage
  criticalThreshold: number; // percentage
  maxFileSize: number; // bytes
  maxConcurrentOperations: number;
}

export interface MemoryStats {
  current: MemoryUsage;
  peak: MemoryUsage;
  operationsActive: number;
  operationsCompleted: number;
  averageOperationMemory: number;
}

/**
 * Memory management service for large file operations
 */
export class MemoryManagementService {
  private static readonly DEFAULT_THRESHOLDS: MemoryThresholds = {
    warningThreshold: 70, // 70%
    criticalThreshold: 85, // 85%
    maxFileSize: 50 * 1024 * 1024, // 50MB
    maxConcurrentOperations: 4
  };

  private static instance: MemoryManagementService;
  private thresholds: MemoryThresholds;
  private stats: MemoryStats;
  private activeOperations: Map<string, { startTime: number; memoryUsage: number }> = new Map();
  private memoryMonitorTimer: NodeJS.Timeout | null = null;
  private eventListeners: Array<(event: MemoryEvent) => void> = [];

  private constructor() {
    this.thresholds = { ...MemoryManagementService.DEFAULT_THRESHOLDS };
    this.stats = {
      current: this.getCurrentMemoryUsage(),
      peak: this.getCurrentMemoryUsage(),
      operationsActive: 0,
      operationsCompleted: 0,
      averageOperationMemory: 0
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MemoryManagementService {
    if (!MemoryManagementService.instance) {
      MemoryManagementService.instance = new MemoryManagementService();
    }
    return MemoryManagementService.instance;
  }

  /**
   * Initialize memory management
   */
  async initialize(): Promise<void> {
    try {
      // Start memory monitoring
      this.startMemoryMonitoring();

      Logger.info('MemoryManagementService.initialize', 'Memory management service initialized');
    } catch (error) {
      Logger.error('MemoryManagementService.initialize', 'Failed to initialize memory management', error);
    }
  }

  /**
   * Start tracking a memory-intensive operation
   */
  startOperation(operationId: string, estimatedMemoryUsage?: number): boolean {
    try {
      const currentMemory = this.getCurrentMemoryUsage();
      
      // Check if we can start a new operation
      if (this.stats.operationsActive >= this.thresholds.maxConcurrentOperations) {
        Logger.warn('MemoryManagementService.startOperation', 
          `Cannot start operation ${operationId}: too many active operations`);
        return false;
      }

      // Check memory thresholds
      if (currentMemory.percentage >= this.thresholds.criticalThreshold) {
        Logger.warn('MemoryManagementService.startOperation', 
          `Cannot start operation ${operationId}: critical memory threshold reached`);
        this.emitEvent({
          type: 'memory_critical',
          operationId,
          memoryUsage: currentMemory,
          message: 'Critical memory threshold reached - cannot start new operations'
        });
        return false;
      }

      // Start operation tracking
      this.activeOperations.set(operationId, {
        startTime: Date.now(),
        memoryUsage: estimatedMemoryUsage || 0
      });

      this.stats.operationsActive++;
      this.stats.current = currentMemory;

      Logger.debug('MemoryManagementService.startOperation', 
        `Started operation ${operationId} (${this.stats.operationsActive} active)`);

      return true;
    } catch (error) {
      Logger.error('MemoryManagementService.startOperation', 
        `Failed to start operation ${operationId}`, error);
      return false;
    }
  }

  /**
   * End tracking a memory-intensive operation
   */
  endOperation(operationId: string, actualMemoryUsage?: number): void {
    try {
      const operation = this.activeOperations.get(operationId);
      if (!operation) {
        Logger.warn('MemoryManagementService.endOperation', 
          `Operation ${operationId} not found in active operations`);
        return;
      }

      const duration = Date.now() - operation.startTime;
      const memoryUsed = actualMemoryUsage || operation.memoryUsage;

      // Update stats
      this.stats.operationsActive--;
      this.stats.operationsCompleted++;
      
      // Update average operation memory
      const totalMemory = this.stats.averageOperationMemory * (this.stats.operationsCompleted - 1) + memoryUsed;
      this.stats.averageOperationMemory = totalMemory / this.stats.operationsCompleted;

      // Remove from active operations
      this.activeOperations.delete(operationId);

      // Update current memory usage
      this.stats.current = this.getCurrentMemoryUsage();

      Logger.debug('MemoryManagementService.endOperation', 
        `Ended operation ${operationId} in ${duration}ms, used ${memoryUsed} bytes`);

    } catch (error) {
      Logger.error('MemoryManagementService.endOperation', 
        `Failed to end operation ${operationId}`, error);
    }
  }

  /**
   * Check if file size is within limits
   */
  isFileSizeAcceptable(fileSize: number): boolean {
    return fileSize <= this.thresholds.maxFileSize;
  }

  /**
   * Get recommended chunk size based on current memory usage
   */
  getRecommendedChunkSize(baseChunkSize: number = 65536): number {
    const currentMemory = this.getCurrentMemoryUsage();
    
    // Reduce chunk size if memory usage is high
    if (currentMemory.percentage > this.thresholds.warningThreshold) {
      const reductionFactor = (this.thresholds.criticalThreshold - currentMemory.percentage) / 
                           (this.thresholds.criticalThreshold - this.thresholds.warningThreshold);
      return Math.max(16384, Math.floor(baseChunkSize * reductionFactor)); // Min 16KB
    }
    
    return baseChunkSize;
  }

  /**
   * Get current memory usage
   */
  getCurrentMemoryUsage(): MemoryUsage {
    try {
      const usage = process.memoryUsage();
      const percentage = (usage.heapUsed / usage.heapTotal) * 100;

      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        rss: usage.rss,
        percentage
      };
    } catch (error) {
      Logger.error('MemoryManagementService.getCurrentMemoryUsage', 'Failed to get memory usage', error);
      return {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        percentage: 0
      };
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    return { ...this.stats };
  }

  /**
   * Force garbage collection
   */
  forceGarbageCollection(): boolean {
    try {
      if (global.gc) {
        global.gc();
        Logger.info('MemoryManagementService.forceGarbageCollection', 'Forced garbage collection');
        return true;
      } else {
        Logger.warn('MemoryManagementService.forceGarbageCollection', 
          'Garbage collection not available - run with --expose-gc');
        return false;
      }
    } catch (error) {
      Logger.error('MemoryManagementService.forceGarbageCollection', 'Failed to force garbage collection', error);
      return false;
    }
  }

  /**
   * Set memory thresholds
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    Logger.info('MemoryManagementService.setThresholds', 'Updated memory thresholds', this.thresholds);
  }

  /**
   * Get memory thresholds
   */
  getThresholds(): MemoryThresholds {
    return { ...this.thresholds };
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: MemoryEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: MemoryEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Dispose memory management service
   */
  dispose(): void {
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }
    this.eventListeners = [];
    Logger.info('MemoryManagementService.dispose', 'Memory management service disposed');
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    this.memoryMonitorTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, 5000); // Check every 5 seconds
  }

  /**
   * Check memory usage and emit warnings if necessary
   */
  private checkMemoryUsage(): void {
    try {
      const currentMemory = this.getCurrentMemoryUsage();
      this.stats.current = currentMemory;

      // Update peak usage
      if (currentMemory.percentage > this.stats.peak.percentage) {
        this.stats.peak = currentMemory;
      }

      // Check warning threshold
      if (currentMemory.percentage >= this.thresholds.warningThreshold && 
          currentMemory.percentage < this.thresholds.criticalThreshold) {
        this.emitEvent({
          type: 'memory_warning',
          memoryUsage: currentMemory,
          message: `Memory usage at ${currentMemory.percentage.toFixed(1)}%`
        });
      }

      // Check critical threshold
      if (currentMemory.percentage >= this.thresholds.criticalThreshold) {
        this.emitEvent({
          type: 'memory_critical',
          memoryUsage: currentMemory,
          message: `Critical memory usage at ${currentMemory.percentage.toFixed(1)}%`
        });

        // Force garbage collection
        this.forceGarbageCollection();
      }

    } catch (error) {
      Logger.error('MemoryManagementService.checkMemoryUsage', 'Error checking memory usage', error);
    }
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: MemoryEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        Logger.error('MemoryManagementService.emitEvent', 'Error in memory event listener', error);
      }
    });
  }
}

export interface MemoryEvent {
  type: 'memory_warning' | 'memory_critical' | 'operation_started' | 'operation_ended';
  operationId?: string;
  memoryUsage: MemoryUsage;
  message: string;
}
