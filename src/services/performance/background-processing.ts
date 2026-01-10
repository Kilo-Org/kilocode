/**
 * Background Processing Service
 * 
 * Handles non-blocking operations for diff processing and file management
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';
import { MemoryManagementService } from './memory-management';

export interface BackgroundTask {
  id: string;
  type: 'diff_processing' | 'file_operation' | 'memory_cleanup';
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: any;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  result?: any;
}

export interface BackgroundTaskOptions {
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  onProgress?: (task: BackgroundTask) => void;
  onComplete?: (task: BackgroundTask) => void;
  onError?: (task: BackgroundTask) => void;
}

export interface ProcessingQueueStats {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageProcessingTime: number;
}

/**
 * Background processing service for non-blocking operations
 */
export class BackgroundProcessingService {
  private static readonly DEFAULT_TIMEOUT = 300000; // 5 minutes
  private static readonly DEFAULT_RETRY_ATTEMPTS = 3;
  private static readonly DEFAULT_RETRY_DELAY = 1000; // 1 second
  private static readonly MAX_CONCURRENT_TASKS = 4;

  private static instance: BackgroundProcessingService;
  private taskQueue: BackgroundTask[] = [];
  private runningTasks: Map<string, BackgroundTask> = new Map();
  private completedTasks: BackgroundTask[] = [];
  private isProcessing: boolean = false;
  private processingTimer: NodeJS.Timeout | null = null;
  private memoryManager: MemoryManagementService;
  private eventListeners: Array<(event: ProcessingEvent) => void> = [];

  private constructor() {
    this.memoryManager = MemoryManagementService.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): BackgroundProcessingService {
    if (!BackgroundProcessingService.instance) {
      BackgroundProcessingService.instance = new BackgroundProcessingService();
    }
    return BackgroundProcessingService.instance;
  }

  /**
   * Initialize background processing service
   */
  async initialize(): Promise<void> {
    try {
      // Start processing queue
      this.startProcessing();

      Logger.info('BackgroundProcessingService.initialize', 'Background processing service initialized');
    } catch (error) {
      Logger.error('BackgroundProcessingService.initialize', 'Failed to initialize background processing', error);
    }
  }

  /**
   * Add task to processing queue
   */
  addTask(
    taskType: BackgroundTask['type'],
    taskData: any,
    priority: BackgroundTask['priority'] = 'medium',
    options: BackgroundTaskOptions = {}
  ): string {
    const taskId = this.generateTaskId();
    
    const task: BackgroundTask = {
      id: taskId,
      type: taskType,
      priority,
      data: taskData,
      createdAt: new Date(),
      progress: 0,
      status: 'pending'
    };

    // Add to queue with priority ordering
    this.insertTaskByPriority(task);

    Logger.debug('BackgroundProcessingService.addTask', 
      `Added task ${taskId} (${taskType}, ${priority} priority)`);

    // Trigger processing if not already running
    if (!this.isProcessing) {
      this.startProcessing();
    }

    return taskId;
  }

  /**
   * Add diff processing task
   */
  addDiffProcessingTask(
    filePath: string,
    originalContent: string,
    modifiedContent: string,
    options: BackgroundTaskOptions = {}
  ): string {
    return this.addTask('diff_processing', {
      filePath,
      originalContent,
      modifiedContent
    }, 'medium', options);
  }

  /**
   * Add file operation task
   */
  addFileOperationTask(
    operation: 'open' | 'close' | 'save' | 'delete',
    filePath: string,
    options: BackgroundTaskOptions = {}
  ): string {
    return this.addTask('file_operation', {
      operation,
      filePath
    }, 'low', options);
  }

  /**
   * Add memory cleanup task
   */
  addMemoryCleanupTask(options: BackgroundTaskOptions = {}): string {
    return this.addTask('memory_cleanup', {}, 'critical', options);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): BackgroundTask | undefined {
    // Check running tasks
    const runningTask = this.runningTasks.get(taskId);
    if (runningTask) {
      return runningTask;
    }

    // Check queue
    const queuedTask = this.taskQueue.find(task => task.id === taskId);
    if (queuedTask) {
      return queuedTask;
    }

    // Check completed tasks
    const completedTask = this.completedTasks.find(task => task.id === taskId);
    if (completedTask) {
      return completedTask;
    }

    return undefined;
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string): boolean {
    try {
      // Check if task is running
      const runningTask = this.runningTasks.get(taskId);
      if (runningTask) {
        runningTask.status = 'cancelled';
        this.runningTasks.delete(taskId);
        this.emitEvent({
          type: 'task_cancelled',
          task: runningTask,
          message: `Task ${taskId} was cancelled`
        });
        return true;
      }

      // Check if task is in queue
      const queueIndex = this.taskQueue.findIndex(task => task.id === taskId);
      if (queueIndex !== -1) {
        const task = this.taskQueue.splice(queueIndex, 1)[0];
        task.status = 'cancelled';
        this.completedTasks.push(task);
        this.emitEvent({
          type: 'task_cancelled',
          task,
          message: `Task ${taskId} was cancelled`
        });
        return true;
      }

      return false;
    } catch (error) {
      Logger.error('BackgroundProcessingService.cancelTask', `Failed to cancel task ${taskId}`, error);
      return false;
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): ProcessingQueueStats {
    const totalTasks = this.taskQueue.length + this.runningTasks.size + this.completedTasks.length;
    const completedTasks = this.completedTasks.filter(task => task.status === 'completed');
    const failedTasks = this.completedTasks.filter(task => task.status === 'failed');
    
    // Calculate average processing time
    const completedWithTime = completedTasks.filter(task => task.startedAt && task.completedAt);
    const averageProcessingTime = completedWithTime.length > 0 
      ? completedWithTime.reduce((sum, task) => 
          sum + (task.completedAt!.getTime() - task.startedAt!.getTime()), 0) / completedWithTime.length
      : 0;

    return {
      totalTasks,
      pendingTasks: this.taskQueue.length,
      runningTasks: this.runningTasks.size,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      averageProcessingTime
    };
  }

  /**
   * Clear completed tasks
   */
  clearCompletedTasks(olderThan: number = 3600000): number { // Default 1 hour
    const cutoffTime = Date.now() - olderThan;
    const initialCount = this.completedTasks.length;
    
    this.completedTasks = this.completedTasks.filter(task => 
      task.completedAt && task.completedAt.getTime() > cutoffTime);
    
    const clearedCount = initialCount - this.completedTasks.length;
    Logger.debug('BackgroundProcessingService.clearCompletedTasks', 
      `Cleared ${clearedCount} completed tasks`);
    
    return clearedCount;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: ProcessingEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: ProcessingEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Dispose background processing service
   */
  dispose(): void {
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }
    
    // Cancel all running tasks
    for (const [taskId, task] of this.runningTasks.entries()) {
      this.cancelTask(taskId);
    }
    
    this.eventListeners = [];
    Logger.info('BackgroundProcessingService.dispose', 'Background processing service disposed');
  }

  /**
   * Start processing queue
   */
  private startProcessing(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    this.processNextTasks();
  }

  /**
   * Process next tasks in queue
   */
  private async processNextTasks(): Promise<void> {
    try {
      // Process as many tasks as we can concurrently
      while (this.runningTasks.size < BackgroundProcessingService.MAX_CONCURRENT_TASKS && 
             this.taskQueue.length > 0) {
        
        const task = this.taskQueue.shift();
        if (!task) {
          break;
        }

        // Check memory availability
        const operationId = `bg_${task.id}`;
        if (!this.memoryManager.startOperation(operationId)) {
          // Put task back at front of queue and try again later
          this.taskQueue.unshift(task);
          break;
        }

        // Start task
        this.runningTasks.set(task.id, task);
        task.status = 'running';
        task.startedAt = new Date();

        this.emitEvent({
          type: 'task_started',
          task,
          message: `Started processing task ${task.id}`
        });

        // Process task asynchronously
        this.processTask(task, operationId);
      }

      // Schedule next processing cycle
      if (this.taskQueue.length > 0 || this.runningTasks.size > 0) {
        this.processingTimer = setTimeout(() => {
          this.processNextTasks();
        }, 100);
      } else {
        this.isProcessing = false;
      }

    } catch (error) {
      Logger.error('BackgroundProcessingService.processNextTasks', 'Error processing tasks', error);
    }
  }

  /**
   * Process individual task
   */
  private async processTask(task: BackgroundTask, operationId: string): Promise<void> {
    try {
      let result: any;
      
      switch (task.type) {
        case 'diff_processing':
          result = await this.processDiffTask(task);
          break;
        case 'file_operation':
          result = await this.processFileOperationTask(task);
          break;
        case 'memory_cleanup':
          result = await this.processMemoryCleanupTask(task);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      // Task completed successfully
      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
      task.progress = 100;

      this.emitEvent({
        type: 'task_completed',
        task,
        message: `Task ${task.id} completed successfully`
      });

    } catch (error) {
      // Task failed
      task.status = 'failed';
      task.completedAt = new Date();
      task.error = error instanceof Error ? error.message : String(error);

      this.emitEvent({
        type: 'task_failed',
        task,
        message: `Task ${task.id} failed: ${task.error}`
      });

    } finally {
      // Clean up
      this.runningTasks.delete(task.id);
      this.completedTasks.push(task);
      this.memoryManager.endOperation(operationId);
    }
  }

  /**
   * Process diff task
   */
  private async processDiffTask(task: BackgroundTask): Promise<any> {
    const { filePath, originalContent, modifiedContent } = task.data;
    
    // Simulate diff processing (in real implementation, use StreamingDiffProcessor)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Update progress
    task.progress = 50;
    this.emitEvent({
      type: 'task_progress',
      task,
      message: `Processing diff for ${filePath}`
    });

    // Continue processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      filePath,
      changesDetected: originalContent !== modifiedContent,
      processedAt: new Date()
    };
  }

  /**
   * Process file operation task
   */
  private async processFileOperationTask(task: BackgroundTask): Promise<any> {
    const { operation, filePath } = task.data;
    
    // Simulate file operation
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      operation,
      filePath,
      completedAt: new Date()
    };
  }

  /**
   * Process memory cleanup task
   */
  private async processMemoryCleanupTask(task: BackgroundTask): Promise<any> {
    // Force garbage collection
    const success = this.memoryManager.forceGarbageCollection();
    
    // Clear old completed tasks
    const clearedCount = this.clearCompletedTasks();
    
    return {
      garbageCollectionForced: success,
      tasksCleared: clearedCount,
      memoryStats: this.memoryManager.getMemoryStats()
    };
  }

  /**
   * Insert task into queue by priority
   */
  private insertTaskByPriority(task: BackgroundTask): void {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const taskPriority = priorityOrder[task.priority];
    
    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      const queueTaskPriority = priorityOrder[this.taskQueue[i].priority];
      if (taskPriority < queueTaskPriority) {
        insertIndex = i;
        break;
      }
    }
    
    this.taskQueue.splice(insertIndex, 0, task);
  }

  /**
   * Generate task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: ProcessingEvent): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        Logger.error('BackgroundProcessingService.emitEvent', 'Error in processing event listener', error);
      }
    });
  }
}

export interface ProcessingEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'task_cancelled' | 'task_progress';
  task: BackgroundTask;
  message: string;
}
