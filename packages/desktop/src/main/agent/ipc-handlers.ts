// ================================
// Agent IPC Handlers
// Bridge between renderer and main process agent executor
// ================================

import { ipcMain, BrowserWindow } from 'electron';
import { getAgentExecutor, type TaskType, type AgentTask } from './agent-executor';

/**
 * Register all agent-related IPC handlers
 */
export function registerAgentHandlers(mainWindow: BrowserWindow | null): void {
  const executor = getAgentExecutor();

  // Set main window for progress updates
  executor.setMainWindow(mainWindow);

  // ================================
  // Lifecycle Handlers
  // ================================

  /**
   * Start the agent executor
   */
  ipcMain.handle('agent:start', async () => {
    try {
      executor.start();
      return { success: true };
    } catch (error) {
      console.error('[Agent:IPC] Start error:', error);
      throw error;
    }
  });

  /**
   * Stop the agent executor
   */
  ipcMain.handle('agent:stop', async () => {
    try {
      await executor.stop();
      return { success: true };
    } catch (error) {
      console.error('[Agent:IPC] Stop error:', error);
      throw error;
    }
  });

  /**
   * Check if agent is running
   */
  ipcMain.handle('agent:isActive', async (): Promise<boolean> => {
    return executor.isActive();
  });

  // ================================
  // Task Management Handlers
  // ================================

  /**
   * Create a new task
   */
  ipcMain.handle(
    'agent:createTask',
    async (
      _event,
      type: TaskType,
      targetItemId: string,
      options?: { priority?: number; maxRetries?: number }
    ): Promise<string> => {
      try {
        return await executor.createTask(type, targetItemId, options);
      } catch (error) {
        console.error('[Agent:IPC] Create task error:', error);
        throw error;
      }
    }
  );

  /**
   * Cancel a task
   */
  ipcMain.handle('agent:cancelTask', async (_event, taskId: string): Promise<boolean> => {
    try {
      return await executor.cancelTask(taskId);
    } catch (error) {
      console.error('[Agent:IPC] Cancel task error:', error);
      throw error;
    }
  });

  /**
   * Get a specific task
   */
  ipcMain.handle('agent:getTask', async (_event, taskId: string): Promise<AgentTask | undefined> => {
    try {
      return executor.getTask(taskId);
    } catch (error) {
      console.error('[Agent:IPC] Get task error:', error);
      throw error;
    }
  });

  /**
   * Get pending tasks count
   */
  ipcMain.handle('agent:getPendingCount', async (): Promise<number> => {
    try {
      return executor.getPendingCount();
    } catch (error) {
      console.error('[Agent:IPC] Get pending count error:', error);
      throw error;
    }
  });

  /**
   * Get all tasks for an item
   */
  ipcMain.handle(
    'agent:getTasksForItem',
    async (_event, itemId: string): Promise<AgentTask[]> => {
      try {
        return executor.getTasksForItem(itemId);
      } catch (error) {
        console.error('[Agent:IPC] Get tasks for item error:', error);
        throw error;
      }
    }
  );

  /**
   * Create multiple tasks for an item (batch processing)
   */
  ipcMain.handle(
    'agent:processItem',
    async (
      _event,
      targetItemId: string,
      options?: {
        transcribe?: boolean;
        summarize?: boolean;
        extractTags?: boolean;
        generateEmbedding?: boolean;
        findRelated?: boolean;
      }
    ): Promise<string[]> => {
      try {
        const taskIds: string[] = [];

        if (options?.transcribe) {
          const id = await executor.createTask('transcribe', targetItemId, { priority: 10 });
          taskIds.push(id);
        }

        if (options?.summarize) {
          const id = await executor.createTask('summarize', targetItemId, { priority: 8 });
          taskIds.push(id);
        }

        if (options?.extractTags) {
          const id = await executor.createTask('extract-tags', targetItemId, { priority: 7 });
          taskIds.push(id);
        }

        if (options?.generateEmbedding) {
          const id = await executor.createTask('generate-embedding', targetItemId, { priority: 6 });
          taskIds.push(id);
        }

        if (options?.findRelated) {
          const id = await executor.createTask('find-related', targetItemId, { priority: 5 });
          taskIds.push(id);
        }

        return taskIds;
      } catch (error) {
        console.error('[Agent:IPC] Process item error:', error);
        throw error;
      }
    }
  );

  console.log('[Agent:IPC] Agent handlers registered');
}

/**
 * Update main window reference (e.g., after window recreation)
 */
export function updateAgentMainWindow(mainWindow: BrowserWindow | null): void {
  const executor = getAgentExecutor();
  executor.setMainWindow(mainWindow);
}

/**
 * Cleanup agent handlers and stop executor
 */
export async function cleanupAgentHandlers(): Promise<void> {
  const executor = getAgentExecutor();
  await executor.stop();

  const handlers = [
    'agent:start',
    'agent:stop',
    'agent:isActive',
    'agent:createTask',
    'agent:cancelTask',
    'agent:getTask',
    'agent:getPendingCount',
    'agent:getTasksForItem',
    'agent:processItem',
  ];

  handlers.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  console.log('[Agent:IPC] Agent handlers cleaned up');
}

export default registerAgentHandlers;
