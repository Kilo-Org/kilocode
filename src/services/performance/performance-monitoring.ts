/**
 * Performance Monitoring Service
 * 
 * Collects and analyzes performance metrics for diff operations
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';

export interface PerformanceMetrics {
  operationId: string;
  operationType: 'diff_processing' | 'file_operation' | 'memory_operation' | 'ui_rendering';
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryUsageBefore?: number;
  memoryUsageAfter?: number;
  fileSize?: number;
  chunksProcessed?: number;
  success: boolean;
  error?: string;
}

export interface PerformanceReport {
  timeRange: { start: Date; end: Date };
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageProcessingTime: number;
  averageMemoryUsage: number;
  peakMemoryUsage: number;
  operationsByType: Map<string, number>;
  slowestOperations: PerformanceMetrics[];
  fastestOperations: PerformanceMetrics[];
  memoryIntensiveOperations: PerformanceMetrics[];
}

export interface PerformanceThresholds {
  maxProcessingTime: number; // ms
  maxMemoryUsage: number; // bytes
  maxFileSize: number; // bytes
  warningThresholds: {
    processingTime: number;
    memoryUsage: number;
    fileSize: number;
  };
}

/**
 * Performance monitoring service
 */
export class PerformanceMonitoringService {
  private static readonly DEFAULT_THRESHOLDS: PerformanceThresholds = {
    maxProcessingTime: 10000, // 10 seconds
    maxMemoryUsage: 100 * 1024 * 1024, // 100MB
    maxFileSize: 10 * 1024 * 1024, // 10MB
    warningThresholds: {
      processingTime: 5000, // 5 seconds
      memoryUsage: 50 * 1024 * 1024, // 50MB
      fileSize: 5 * 1024 * 1024 // 5MB
    }
  };

  private static instance: PerformanceMonitoringService;
  private metrics: PerformanceMetrics[] = [];
  private thresholds: PerformanceThresholds;
  private activeOperations: Map<string, PerformanceMetrics> = new Map();
  private eventListeners: Array<(event: PerformanceEvent) => void> = [];
  private monitoringTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.thresholds = { ...PerformanceMonitoringService.DEFAULT_THRESHOLDS };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PerformanceMonitoringService {
    if (!PerformanceMonitoringService.instance) {
      PerformanceMonitoringService.instance = new PerformanceMonitoringService();
    }
    return PerformanceMonitoringService.instance;
  }

  /**
   * Initialize performance monitoring
   */
  async initialize(): Promise<void> {
    try {
      // Start periodic cleanup
      this.startPeriodicCleanup();

      Logger.info('PerformanceMonitoringService.initialize', 'Performance monitoring service initialized');
    } catch (error) {
      Logger.error('PerformanceMonitoringService.initialize', 'Failed to initialize performance monitoring', error);
    }
  }

  /**
   * Start monitoring an operation
   */
  startMonitoring(
    operationId: string,
    operationType: PerformanceMetrics['operationType'],
    fileSize?: number
  ): void {
    try {
      const metric: PerformanceMetrics = {
        operationId,
        operationType,
        startTime: Date.now(),
        memoryUsageBefore: this.getCurrentMemoryUsage(),
        fileSize,
        success: false
      };

      this.activeOperations.set(operationId, metric);

      Logger.debug('PerformanceMonitoringService.startMonitoring', 
        `Started monitoring ${operationType} operation ${operationId}`);
    } catch (error) {
      Logger.error('PerformanceMonitoringService.startMonitoring', 
        `Failed to start monitoring for operation ${operationId}`, error);
    }
  }

  /**
   * End monitoring an operation
   */
  endMonitoring(
    operationId: string,
    success: boolean = true,
    error?: string,
    additionalData?: {
      chunksProcessed?: number;
      memoryUsageAfter?: number;
    }
  ): void {
    try {
      const metric = this.activeOperations.get(operationId);
      if (!metric) {
        Logger.warn('PerformanceMonitoringService.endMonitoring', 
          `No active monitoring found for operation ${operationId}`);
        return;
      }

      // Complete the metric
      metric.endTime = Date.now();
      metric.duration = metric.endTime - metric.startTime;
      metric.success = success;
      metric.error = error;
      metric.memoryUsageAfter = additionalData?.memoryUsageAfter || this.getCurrentMemoryUsage();
      metric.chunksProcessed = additionalData?.chunksProcessed;

      // Move to completed metrics
      this.metrics.push(metric);
      this.activeOperations.delete(operationId);

      // Check thresholds and emit warnings
      this.checkPerformanceThresholds(metric);

      Logger.debug('PerformanceMonitoringService.endMonitoring', 
        `Ended monitoring for operation ${operationId} in ${metric.duration}ms`);

    } catch (error) {
      Logger.error('PerformanceMonitoringService.endMonitoring', 
        `Failed to end monitoring for operation ${operationId}`, error);
    }
  }

  /**
   * Get performance report for time range
   */
  getPerformanceReport(
    startTime: Date,
    endTime: Date
  ): PerformanceReport {
    const filteredMetrics = this.metrics.filter(metric => 
      metric.startTime >= startTime.getTime() && 
      metric.endTime && 
      metric.endTime <= endTime.getTime()
    );

    const successfulOperations = filteredMetrics.filter(m => m.success);
    const failedOperations = filteredMetrics.filter(m => !m.success);

    // Calculate averages
    const averageProcessingTime = successfulOperations.length > 0
      ? successfulOperations.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulOperations.length
      : 0;

    const averageMemoryUsage = filteredMetrics.length > 0
      ? filteredMetrics.reduce((sum, m) => sum + (m.memoryUsageAfter || 0), 0) / filteredMetrics.length
      : 0;

    const peakMemoryUsage = filteredMetrics.reduce((max, m) => 
      Math.max(max, m.memoryUsageAfter || 0), 0);

    // Group by operation type
    const operationsByType = new Map<string, number>();
    filteredMetrics.forEach(metric => {
      const count = operationsByType.get(metric.operationType) || 0;
      operationsByType.set(metric.operationType, count + 1);
    });

    // Sort operations
    const slowestOperations = successfulOperations
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 10);

    const fastestOperations = successfulOperations
      .sort((a, b) => (a.duration || 0) - (b.duration || 0))
      .slice(0, 10);

    const memoryIntensiveOperations = filteredMetrics
      .sort((a, b) => (b.memoryUsageAfter || 0) - (a.memoryUsageAfter || 0))
      .slice(0, 10);

    return {
      timeRange: { start: startTime, end: endTime },
      totalOperations: filteredMetrics.length,
      successfulOperations: successfulOperations.length,
      failedOperations: failedOperations.length,
      averageProcessingTime,
      averageMemoryUsage,
      peakMemoryUsage,
      operationsByType,
      slowestOperations,
      fastestOperations,
      memoryIntensiveOperations
    };
  }

  /**
   * Get recent performance metrics
   */
  getRecentMetrics(count: number = 100): PerformanceMetrics[] {
    return this.metrics
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, count);
  }

  /**
   * Get metrics by operation type
   */
  getMetricsByType(operationType: PerformanceMetrics['operationType']): PerformanceMetrics[] {
    return this.metrics.filter(metric => metric.operationType === operationType);
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    totalOperations: number;
    successRate: number;
    averageProcessingTime: number;
    averageMemoryUsage: number;
    currentActiveOperations: number;
  } {
    const totalOperations = this.metrics.length;
    const successfulOperations = this.metrics.filter(m => m.success);
    const successRate = totalOperations > 0 ? (successfulOperations.length / totalOperations) * 100 : 0;

    const averageProcessingTime = successfulOperations.length > 0
      ? successfulOperations.reduce((sum, m) => sum + (m.duration || 0), 0) / successfulOperations.length
      : 0;

    const averageMemoryUsage = this.metrics.length > 0
      ? this.metrics.reduce((sum, m) => sum + (m.memoryUsageAfter || 0), 0) / this.metrics.length
      : 0;

    return {
      totalOperations,
      successRate,
      averageProcessingTime,
      averageMemoryUsage,
      currentActiveOperations: this.activeOperations.size
    };
  }

  /**
   * Clear old metrics
   */
  clearMetrics(olderThan: number = 24 * 60 * 60 * 1000): number { // Default 24 hours
    const cutoffTime = Date.now() - olderThan;
    const initialCount = this.metrics.length;
    
    this.metrics = this.metrics.filter(metric => metric.startTime > cutoffTime);
    
    const clearedCount = initialCount - this.metrics.length;
    Logger.debug('PerformanceMonitoringService.clearMetrics', 
      `Cleared ${clearedCount} old performance metrics`);
    
    return clearedCount;
  }

  /**
   * Set performance thresholds
   */
  setThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    Logger.info('PerformanceMonitoringService.setThresholds', 'Updated performance thresholds', this.thresholds);
  }

  /**
   * Get performance thresholds
   */
  getThresholds(): PerformanceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: PerformanceEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: PerformanceEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Dispose performance monitoring service
   */
  dispose(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    this.eventListeners = [];
    Logger.info('PerformanceMonitoringService.dispose', 'Performance monitoring service disposed');
  }

  /**
   * Check performance thresholds and emit warnings
   */
  private checkPerformanceThresholds(metric: PerformanceMetrics): void {
    if (!metric.duration || !metric.success) {
      return;
    }

    // Check processing time
    if (metric.duration > this.thresholds.maxProcessingTime) {
      this.emitEvent({
        type: 'performance_warning',
        metric,
        message: `Processing time ${metric.duration}ms exceeds threshold of ${this.thresholds.maxProcessingTime}ms`,
        threshold: 'processing_time',
        value: metric.duration,
        limit: this.thresholds.maxProcessingTime
      });
    } else if (metric.duration > this.thresholds.warningThresholds.processingTime) {
      this.emitEvent({
        type: 'performance_warning',
        metric,
        message: `Processing time ${metric.duration}ms approaching warning threshold`,
        threshold: 'processing_time_warning',
        value: metric.duration,
        limit: this.thresholds.warningThresholds.processingTime
      });
    }

    // Check memory usage
    if (metric.memoryUsageAfter && metric.memoryUsageAfter > this.thresholds.maxMemoryUsage) {
      this.emitEvent({
        type: 'performance_warning',
        metric,
        message: `Memory usage ${metric.memoryUsageAfter} bytes exceeds threshold of ${this.thresholds.maxMemoryUsage} bytes`,
        threshold: 'memory_usage',
        value: metric.memoryUsageAfter,
        limit: this.thresholds.maxMemoryUsage
      });
    }

    // Check file size
    if (metric.fileSize && metric.fileSize > this.thresholds.maxFileSize) {
      this.emitEvent({
        type: 'performance_warning',
        metric,
        message: `File size ${metric.fileSize} bytes exceeds threshold of ${this.thresholds.maxFileSize} bytes`,
        threshold: 'file_size',
        value: metric.fileSize,
        limit: this.thresholds.maxFileSize
      });
    }
  }

  /**
   * Get current memory usage
   */
  private getCurrentMemoryUsage(): number {
    try {
      const usage = process.memoryUsage();
      return usage.heapUsed;
    } catch (error) {
      Logger.error('PerformanceMonitoringService.getCurrentMemoryUsage', 'Failed to get memory usage', error);
      return 0;
    }
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    this.monitoringTimer = setInterval(() => {
      this.clearMetrics();
    }, 60 * 60 * 1000); // Clean up every hour
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: PerformanceEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        Logger.error('PerformanceMonitoringService.emitEvent', 'Error in performance event listener', error);
      }
    });
  }
}

export interface PerformanceEvent {
  type: 'performance_warning' | 'performance_critical' | 'operation_completed' | 'operation_failed';
  metric: PerformanceMetrics;
  message: string;
  threshold?: string;
  value?: number;
  limit?: number;
}
