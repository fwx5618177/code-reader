// ================================
// Knowledge Storage Service
// Phase 1: Local storage using file system + JSON
// Future: Migrate to SQLite for better performance
// ================================

import type {
  KnowledgeItem,
  KnowledgeItemType,
  Tag,
  Folder,
  Project,
  AgentTask,
  AppSettings,
  KnowledgeBaseStats,
  SearchOptions,
  SearchResult,
} from '../types/knowledge';

// ================================
// Constants
// ================================

const STORAGE_VERSION = '1.0.0';
const DB_FILENAME = 'knowledge-db.json';
const SETTINGS_FILENAME = 'settings.json';
const ATTACHMENTS_DIR = 'attachments';

// ================================
// Database Schema
// ================================

interface KnowledgeDatabase {
  version: string;
  createdAt: string;
  updatedAt: string;
  items: Record<string, KnowledgeItem>;
  tags: Record<string, Tag>;
  folders: Record<string, Folder>;
  projects: Record<string, Project>;
  tasks: Record<string, AgentTask>;
}

// ================================
// Utility Functions
// ================================

/**
 * Generate a unique ID
 */
const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${randomPart}`;
};

/**
 * Get current timestamp
 */
const now = (): Date => new Date();

/**
 * Create default database
 */
const createDefaultDatabase = (): KnowledgeDatabase => ({
  version: STORAGE_VERSION,
  createdAt: now().toISOString(),
  updatedAt: now().toISOString(),
  items: {},
  tags: {},
  folders: {},
  projects: {},
  tasks: {},
});

/**
 * Create default settings
 */
const createDefaultSettings = (): AppSettings => ({
  language: 'zh-CN',
  theme: 'dark',
  dataPath: '',
  attachmentsPath: '',
  enableAI: true,
  autoTranscribe: true,
  autoSummarize: true,
  autoTag: true,
  quickInputHotkey: 'CommandOrControl+Shift+N',
  defaultInputType: 'text',
  enableSync: false,
});

// ================================
// Knowledge Storage Class
// ================================

class KnowledgeStorageService {
  private dataPath: string = '';
  private database: KnowledgeDatabase | null = null;
  private settings: AppSettings | null = null;
  private isInitialized: boolean = false;

  // ================================
  // Initialization
  // ================================

  /**
   * Initialize the storage service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Get data path from main process
      this.dataPath = (await window.electron.ipcRenderer.invoke('get-data-path')) as string;
      console.log('Knowledge storage path:', this.dataPath);

      // Ensure directories exist
      await this.ensureDirectories();

      // Load or create database
      await this.loadDatabase();

      // Load or create settings
      await this.loadSettings();

      this.isInitialized = true;
      console.log('Knowledge storage initialized');
    } catch (error) {
      console.error('Failed to initialize knowledge storage:', error);
      throw error;
    }
  }

  /**
   * Ensure required directories exist
   */
  private async ensureDirectories(): Promise<void> {
    const attachmentsPath = `${this.dataPath}/${ATTACHMENTS_DIR}`;

    const exists = await window.electron.ipcRenderer.invoke('path-exists', attachmentsPath);
    if (!exists) {
      await window.electron.ipcRenderer.invoke('create-directory', attachmentsPath);
    }
  }

  /**
   * Load database from file
   */
  private async loadDatabase(): Promise<void> {
    const dbPath = `${this.dataPath}/${DB_FILENAME}`;

    try {
      const exists = await window.electron.ipcRenderer.invoke('path-exists', dbPath);

      if (exists) {
        const content = (await window.electron.ipcRenderer.invoke('read-file', dbPath)) as string;
        this.database = JSON.parse(content);

        // Handle version migration if needed
        if (this.database && this.database.version !== STORAGE_VERSION) {
          await this.migrateDatabase();
        }
      } else {
        this.database = createDefaultDatabase();
        await this.saveDatabase();
      }
    } catch (error) {
      console.error('Failed to load database:', error);
      this.database = createDefaultDatabase();
      await this.saveDatabase();
    }
  }

  /**
   * Save database to file
   */
  private async saveDatabase(): Promise<void> {
    if (!this.database) return;

    this.database.updatedAt = now().toISOString();
    const dbPath = `${this.dataPath}/${DB_FILENAME}`;
    const content = JSON.stringify(this.database, null, 2);

    await window.electron.ipcRenderer.invoke('write-file', dbPath, content);
  }

  /**
   * Load settings from file
   */
  private async loadSettings(): Promise<void> {
    const settingsPath = `${this.dataPath}/${SETTINGS_FILENAME}`;

    try {
      const exists = await window.electron.ipcRenderer.invoke('path-exists', settingsPath);

      if (exists) {
        const content = (await window.electron.ipcRenderer.invoke(
          'read-file',
          settingsPath
        )) as string;
        this.settings = JSON.parse(content);
      } else {
        this.settings = createDefaultSettings();
        this.settings.dataPath = this.dataPath;
        this.settings.attachmentsPath = `${this.dataPath}/${ATTACHMENTS_DIR}`;
        await this.saveSettings();
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = createDefaultSettings();
    }
  }

  /**
   * Save settings to file
   */
  private async saveSettings(): Promise<void> {
    if (!this.settings) return;

    const settingsPath = `${this.dataPath}/${SETTINGS_FILENAME}`;
    const content = JSON.stringify(this.settings, null, 2);

    await window.electron.ipcRenderer.invoke('write-file', settingsPath, content);
  }

  /**
   * 数据库迁移
   * 根据版本号进行增量迁移
   */
  private async migrateDatabase(): Promise<void> {
    if (!this.database) return;

    const currentVersion = this.database.version;
    const targetVersion = STORAGE_VERSION;

    // 如果版本相同，无需迁移
    if (currentVersion === targetVersion) {
      console.log('[KnowledgeStorage] 数据库版本一致，无需迁移');
      return;
    }

    console.log(`[KnowledgeStorage] 开始数据库迁移: ${currentVersion} -> ${targetVersion}`);

    // 版本迁移映射
    const migrations: Record<string, () => void> = {
      // 从 0.x 迁移到 1.0.0
      '1.0.0': () => {
        // 确保所有必要的字段存在
        for (const id of Object.keys(this.database!.items)) {
          const item = this.database!.items[id];
          // 添加缺失的字段并设置默认值
          if (item.viewCount === undefined) {
            item.viewCount = 0;
          }
          if (item.isIndexed === undefined) {
            item.isIndexed = false;
          }
          if (item.isFavorite === undefined) {
            item.isFavorite = false;
          }
          if (item.isPinned === undefined) {
            item.isPinned = false;
          }
        }

        // 确保标签有 usageCount 字段
        for (const id of Object.keys(this.database!.tags)) {
          const tag = this.database!.tags[id];
          if (tag.usageCount === undefined) {
            tag.usageCount = 0;
          }
        }

        // 确保文件夹有 itemCount 字段
        for (const id of Object.keys(this.database!.folders)) {
          const folder = this.database!.folders[id];
          if (folder.itemCount === undefined) {
            folder.itemCount = 0;
          }
        }
      },
    };

    // 执行迁移
    const versionOrder = ['1.0.0'];
    let needsSave = false;

    for (const version of versionOrder) {
      // 如果当前版本低于此迁移版本，执行迁移
      if (this.compareVersions(currentVersion, version) < 0) {
        const migration = migrations[version];
        if (migration) {
          console.log(`[KnowledgeStorage] 执行迁移: ${version}`);
          migration();
          needsSave = true;
        }
      }
    }

    // 更新版本号
    this.database.version = targetVersion;
    this.database.updatedAt = now().toISOString();

    // 保存迁移后的数据库
    if (needsSave) {
      await this.saveDatabase();
      console.log('[KnowledgeStorage] 数据库迁移完成');
    }
  }

  /**
   * 比较版本号
   * @returns 负数表示 a < b，0 表示相等，正数表示 a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA !== numB) {
        return numA - numB;
      }
    }
    return 0;
  }

  // ================================
  // Knowledge Items CRUD
  // ================================

  /**
   * Create a new knowledge item
   */
  async createItem(
    data: Partial<KnowledgeItem> & { type: KnowledgeItemType }
  ): Promise<KnowledgeItem> {
    await this.ensureInitialized();

    const id = generateId();
    const timestamp = now();

    const item: KnowledgeItem = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      title: data.title || 'Untitled',
      type: data.type,
      status: 'draft',
      content: data.content,
      filePath: data.filePath,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      sourceUrl: data.sourceUrl,
      tagIds: data.tagIds || [],
      folderId: data.folderId,
      projectId: data.projectId,
      isFavorite: false,
      isPinned: false,
      isIndexed: false,
      viewCount: 0,
      metadata: data.metadata,
    };

    this.database!.items[id] = item;
    await this.saveDatabase();

    // Create processing tasks if AI is enabled
    if (this.settings?.enableAI) {
      await this.createProcessingTasks(item);
    }

    return item;
  }

  /**
   * Get a knowledge item by ID
   */
  async getItem(id: string): Promise<KnowledgeItem | null> {
    await this.ensureInitialized();
    return this.database!.items[id] || null;
  }

  /**
   * Update a knowledge item
   */
  async updateItem(id: string, updates: Partial<KnowledgeItem>): Promise<KnowledgeItem | null> {
    await this.ensureInitialized();

    const item = this.database!.items[id];
    if (!item) return null;

    const updatedItem: KnowledgeItem = {
      ...item,
      ...updates,
      id, // Ensure ID cannot be changed
      createdAt: item.createdAt, // Ensure createdAt cannot be changed
      updatedAt: now(),
    };

    this.database!.items[id] = updatedItem;
    await this.saveDatabase();

    return updatedItem;
  }

  /**
   * Delete a knowledge item (soft delete)
   */
  async deleteItem(id: string, hard: boolean = false): Promise<boolean> {
    await this.ensureInitialized();

    if (hard) {
      delete this.database!.items[id];
    } else {
      const item = this.database!.items[id];
      if (item) {
        item.isDeleted = true;
        item.deletedAt = now();
      }
    }

    await this.saveDatabase();
    return true;
  }

  /**
   * Get all knowledge items
   */
  async getAllItems(includeDeleted: boolean = false): Promise<KnowledgeItem[]> {
    await this.ensureInitialized();

    const items = Object.values(this.database!.items);

    if (includeDeleted) {
      return items;
    }

    return items.filter((item) => !item.isDeleted);
  }

  /**
   * Search knowledge items
   */
  async searchItems(options: SearchOptions): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const items = await this.getAllItems();
    const query = options.query.toLowerCase();

    // Simple text search (to be replaced with full-text search)
    const results: SearchResult[] = items
      .filter((item) => {
        // Type filter
        if (options.types && options.types.length > 0) {
          if (!options.types.includes(item.type)) return false;
        }

        // Tag filter
        if (options.tagIds && options.tagIds.length > 0) {
          if (!options.tagIds.some((tagId) => item.tagIds.includes(tagId))) return false;
        }

        // Folder filter
        if (options.folderIds && options.folderIds.length > 0) {
          if (!item.folderId || !options.folderIds.includes(item.folderId)) return false;
        }

        // Favorites filter
        if (options.favoritesOnly && !item.isFavorite) return false;

        // Date range filter
        if (options.dateRange) {
          const createdAt = new Date(item.createdAt);
          if (createdAt < options.dateRange.start || createdAt > options.dateRange.end) {
            return false;
          }
        }

        // Text search
        if (query) {
          const searchableText = [
            item.title,
            item.content,
            item.summary,
            item.transcript,
            ...(item.keyPoints || []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return searchableText.includes(query);
        }

        return true;
      })
      .map((item) => ({
        item,
        score: 1, // Simple score, to be improved
        matchType: 'fuzzy' as const,
      }));

    // Sort
    results.sort((a, b) => {
      switch (options.sortBy) {
        case 'createdAt':
          return options.sortOrder === 'asc'
            ? new Date(a.item.createdAt).getTime() - new Date(b.item.createdAt).getTime()
            : new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime();
        case 'updatedAt':
          return options.sortOrder === 'asc'
            ? new Date(a.item.updatedAt).getTime() - new Date(b.item.updatedAt).getTime()
            : new Date(b.item.updatedAt).getTime() - new Date(a.item.updatedAt).getTime();
        case 'viewCount':
          return options.sortOrder === 'asc'
            ? a.item.viewCount - b.item.viewCount
            : b.item.viewCount - a.item.viewCount;
        default:
          return b.score - a.score;
      }
    });

    // Pagination
    const offset = options.offset || 0;
    const limit = options.limit || 20;

    return results.slice(offset, offset + limit);
  }

  // ================================
  // Tags CRUD
  // ================================

  /**
   * Create a new tag
   */
  async createTag(name: string, options?: Partial<Tag>): Promise<Tag> {
    await this.ensureInitialized();

    const id = generateId();
    const timestamp = now();

    const tag: Tag = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      name,
      color: options?.color,
      icon: options?.icon,
      parentId: options?.parentId,
      usageCount: 0,
      isAutoGenerated: options?.isAutoGenerated || false,
      aliases: options?.aliases,
    };

    this.database!.tags[id] = tag;
    await this.saveDatabase();

    return tag;
  }

  /**
   * Get all tags
   */
  async getAllTags(): Promise<Tag[]> {
    await this.ensureInitialized();
    return Object.values(this.database!.tags).filter((tag) => !tag.isDeleted);
  }

  /**
   * Find or create tag by name
   */
  async findOrCreateTag(name: string): Promise<Tag> {
    await this.ensureInitialized();

    const existingTag = Object.values(this.database!.tags).find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase() && !tag.isDeleted
    );

    if (existingTag) {
      return existingTag;
    }

    return this.createTag(name);
  }

  // ================================
  // Folders CRUD
  // ================================

  /**
   * Create a new folder
   */
  async createFolder(name: string, options?: Partial<Folder>): Promise<Folder> {
    await this.ensureInitialized();

    const id = generateId();
    const timestamp = now();

    const folder: Folder = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      name,
      type: options?.type || 'manual',
      icon: options?.icon,
      color: options?.color,
      parentId: options?.parentId,
      sortOrder: options?.sortOrder || 0,
      itemCount: 0,
      filterRules: options?.filterRules,
    };

    this.database!.folders[id] = folder;
    await this.saveDatabase();

    return folder;
  }

  /**
   * Get all folders
   */
  async getAllFolders(): Promise<Folder[]> {
    await this.ensureInitialized();
    return Object.values(this.database!.folders).filter((folder) => !folder.isDeleted);
  }

  /**
   * 获取单个文件夹
   */
  async getFolder(id: string): Promise<Folder | null> {
    await this.ensureInitialized();
    const folder = this.database!.folders[id];
    if (!folder || folder.isDeleted) {
      return null;
    }
    return folder;
  }

  /**
   * 更新文件夹
   */
  async updateFolder(
    id: string,
    updates: Partial<Omit<Folder, 'id' | 'createdAt'>>
  ): Promise<Folder | null> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder || folder.isDeleted) {
      return null;
    }

    const updatedFolder: Folder = {
      ...folder,
      ...updates,
      id: folder.id,
      createdAt: folder.createdAt,
      updatedAt: now(),
    };

    this.database!.folders[id] = updatedFolder;
    await this.saveDatabase();

    return updatedFolder;
  }

  /**
   * 删除文件夹（软删除）
   * 删除文件夹时，其中的条目不会被删除，只是取消与该文件夹的关联
   */
  async deleteFolder(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder || folder.isDeleted) {
      return false;
    }

    // 将该文件夹下的所有条目的 folderId 设为 undefined
    const items = Object.values(this.database!.items);
    for (const item of items) {
      if (item.folderId === id && !item.isDeleted) {
        item.folderId = undefined;
        item.updatedAt = now();
      }
    }

    // 将该文件夹下的子文件夹的 parentId 设为 undefined
    const folders = Object.values(this.database!.folders);
    for (const childFolder of folders) {
      if (childFolder.parentId === id && !childFolder.isDeleted) {
        childFolder.parentId = undefined;
        childFolder.updatedAt = now();
      }
    }

    // 软删除文件夹
    folder.isDeleted = true;
    folder.deletedAt = now();
    folder.updatedAt = now();

    await this.saveDatabase();

    return true;
  }

  /**
   * 永久删除文件夹（硬删除）
   * 谨慎使用，此操作不可恢复
   */
  async permanentlyDeleteFolder(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder) {
      return false;
    }

    // 将该文件夹下的所有条目的 folderId 设为 undefined
    const items = Object.values(this.database!.items);
    for (const item of items) {
      if (item.folderId === id) {
        item.folderId = undefined;
        item.updatedAt = now();
      }
    }

    // 将该文件夹下的子文件夹的 parentId 设为 undefined
    const folders = Object.values(this.database!.folders);
    for (const childFolder of folders) {
      if (childFolder.parentId === id) {
        childFolder.parentId = undefined;
        childFolder.updatedAt = now();
      }
    }

    // 永久删除文件夹
    delete this.database!.folders[id];

    await this.saveDatabase();

    return true;
  }

  /**
   * 恢复已删除的文件夹
   */
  async restoreFolder(id: string): Promise<Folder | null> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder || !folder.isDeleted) {
      return null;
    }

    folder.isDeleted = false;
    folder.deletedAt = undefined;
    folder.updatedAt = now();

    await this.saveDatabase();

    return folder;
  }

  /**
   * 移动文件夹到新的父文件夹
   */
  async moveFolder(id: string, newParentId: string | undefined): Promise<Folder | null> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder || folder.isDeleted) {
      return null;
    }

    // 检查是否会造成循环引用
    if (newParentId) {
      let currentParentId: string | undefined = newParentId;
      while (currentParentId) {
        if (currentParentId === id) {
          // 会造成循环引用，拒绝操作
          console.error('无法移动文件夹：会造成循环引用');
          return null;
        }
        const parentFolder: Folder | undefined = this.database!.folders[currentParentId];
        currentParentId = parentFolder?.parentId;
      }
    }

    folder.parentId = newParentId;
    folder.updatedAt = now();

    await this.saveDatabase();

    return folder;
  }

  /**
   * 获取文件夹中的条目数量
   * 对于智能文件夹，根据筛选规则动态计算
   */
  async getFolderItemCount(id: string): Promise<number> {
    await this.ensureInitialized();

    const folder = this.database!.folders[id];
    if (!folder || folder.isDeleted) {
      return 0;
    }

    const items = Object.values(this.database!.items).filter((item) => !item.isDeleted);

    // 对于普通文件夹，计算直接包含的条目数
    if (folder.type === 'manual') {
      return items.filter((item) => item.folderId === id).length;
    }

    // 对于智能文件夹，根据规则筛选
    if (folder.type === 'smart' && folder.filterRules && folder.filterRules.length > 0) {
      return items.filter((item) => this.matchesFilterRules(item, folder.filterRules!)).length;
    }

    return 0;
  }

  /**
   * 检查条目是否匹配筛选规则
   */
  private matchesFilterRules(item: KnowledgeItem, rules: Folder['filterRules']): boolean {
    if (!rules || rules.length === 0) {
      return true;
    }

    // 所有规则都必须匹配（AND 逻辑）
    return rules.every((rule) => this.matchesSingleRule(item, rule));
  }

  /**
   * 检查条目是否匹配单条规则
   */
  private matchesSingleRule(
    item: KnowledgeItem,
    rule: NonNullable<Folder['filterRules']>[number]
  ): boolean {
    const { field, operator, value } = rule;
    const fieldValue = (item as unknown as Record<string, unknown>)[field];

    switch (operator) {
      case 'equals':
        return fieldValue === value;

      case 'notEquals':
        return fieldValue !== value;

      case 'contains':
        if (field === 'tagIds' && Array.isArray(fieldValue)) {
          return fieldValue.includes(value as string);
        }
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          return fieldValue.toLowerCase().includes(value.toLowerCase());
        }
        return false;

      case 'notContains':
        if (field === 'tagIds' && Array.isArray(fieldValue)) {
          return !fieldValue.includes(value as string);
        }
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          return !fieldValue.toLowerCase().includes(value.toLowerCase());
        }
        return true;

      case 'startsWith':
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          return fieldValue.toLowerCase().startsWith(value.toLowerCase());
        }
        return false;

      case 'endsWith':
        if (typeof fieldValue === 'string' && typeof value === 'string') {
          return fieldValue.toLowerCase().endsWith(value.toLowerCase());
        }
        return false;

      case 'greaterThan':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue > value;
        }
        return false;

      case 'lessThan':
        if (typeof fieldValue === 'number' && typeof value === 'number') {
          return fieldValue < value;
        }
        return false;

      case 'in':
        if (Array.isArray(value)) {
          return value.includes(fieldValue);
        }
        return false;

      case 'notIn':
        if (Array.isArray(value)) {
          return !value.includes(fieldValue);
        }
        return true;

      case 'isEmpty':
        if (Array.isArray(fieldValue)) {
          return fieldValue.length === 0;
        }
        return !fieldValue;

      case 'isNotEmpty':
        if (Array.isArray(fieldValue)) {
          return fieldValue.length > 0;
        }
        return !!fieldValue;

      default:
        return false;
    }
  }

  // ================================
  // Agent Tasks
  // ================================

  /**
   * Create processing tasks for an item
   */
  private async createProcessingTasks(item: KnowledgeItem): Promise<void> {
    const tasks: Array<{ type: AgentTask['type']; priority: number }> = [];

    // Transcription for audio
    if (item.type === 'audio' && this.settings?.autoTranscribe) {
      tasks.push({ type: 'transcribe', priority: 10 });
    }

    // Summarization for text content
    if (item.content && this.settings?.autoSummarize) {
      tasks.push({ type: 'summarize', priority: 5 });
    }

    // Auto-tagging
    if (this.settings?.autoTag) {
      tasks.push({ type: 'extract-tags', priority: 3 });
    }

    // Generate embedding for semantic search
    tasks.push({ type: 'generate-embedding', priority: 1 });

    for (const taskInfo of tasks) {
      await this.createTask(item.id, taskInfo.type, taskInfo.priority);
    }
  }

  /**
   * Create an agent task
   */
  async createTask(
    targetItemId: string,
    type: AgentTask['type'],
    priority: number = 5
  ): Promise<AgentTask> {
    await this.ensureInitialized();

    const id = generateId();
    const timestamp = now();

    const task: AgentTask = {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      type,
      status: 'pending',
      targetItemId,
      priority,
      progress: 0,
      retryCount: 0,
    };

    this.database!.tasks[id] = task;
    await this.saveDatabase();

    return task;
  }

  /**
   * Get pending tasks
   */
  async getPendingTasks(): Promise<AgentTask[]> {
    await this.ensureInitialized();

    return Object.values(this.database!.tasks)
      .filter((task) => task.status === 'pending')
      .sort((a, b) => b.priority - a.priority);
  }

  // ================================
  // Settings
  // ================================

  /**
   * Get settings
   */
  async getSettings(): Promise<AppSettings> {
    await this.ensureInitialized();
    return this.settings!;
  }

  /**
   * Update settings
   */
  async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    await this.ensureInitialized();

    this.settings = {
      ...this.settings!,
      ...updates,
    };

    await this.saveSettings();
    return this.settings;
  }

  // ================================
  // Statistics
  // ================================

  /**
   * Get knowledge base statistics
   */
  async getStats(): Promise<KnowledgeBaseStats> {
    await this.ensureInitialized();

    const items = await this.getAllItems();
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Count by type
    const itemsByType: Record<KnowledgeItemType, number> = {
      note: 0,
      audio: 0,
      image: 0,
      video: 0,
      document: 0,
      webpage: 0,
      code: 0,
      bookmark: 0,
      file: 0,
    };

    let totalStorageSize = 0;
    let itemsThisWeek = 0;
    let itemsThisMonth = 0;

    for (const item of items) {
      itemsByType[item.type]++;

      if (item.fileSize) {
        totalStorageSize += item.fileSize;
      }

      const createdAt = new Date(item.createdAt);
      if (createdAt >= oneWeekAgo) itemsThisWeek++;
      if (createdAt >= oneMonthAgo) itemsThisMonth++;
    }

    const pendingTasks = (await this.getPendingTasks()).length;

    return {
      totalItems: items.length,
      itemsByType,
      totalTags: Object.values(this.database!.tags).filter((t) => !t.isDeleted).length,
      totalFolders: Object.values(this.database!.folders).filter((f) => !f.isDeleted).length,
      totalProjects: Object.values(this.database!.projects).filter((p) => !p.isDeleted).length,
      totalStorageSize,
      itemsThisWeek,
      itemsThisMonth,
      pendingTasks,
    };
  }

  // ================================
  // Helpers
  // ================================

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Get attachments directory path
   */
  getAttachmentsPath(): string {
    return `${this.dataPath}/${ATTACHMENTS_DIR}`;
  }

  /**
   * 保存附件文件
   * 使用二进制方式写入文件，避免 base64 编码带来的体积增加
   */
  async saveAttachment(file: File): Promise<string> {
    await this.ensureInitialized();

    const fileName = `${generateId()}-${file.name}`;
    const filePath = `${this.getAttachmentsPath()}/${fileName}`;

    // 读取文件内容为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // 将 ArrayBuffer 转换为数组以便序列化传输
    const uint8Array = new Uint8Array(arrayBuffer);
    const dataArray = Array.from(uint8Array);

    // 使用二进制方式写入文件
    await window.electron.ipcRenderer.invoke('write-binary-file', filePath, dataArray);

    return filePath;
  }
}

// ================================
// Export Singleton
// ================================

export const knowledgeStorage = new KnowledgeStorageService();

export default knowledgeStorage;
