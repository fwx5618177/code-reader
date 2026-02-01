// ================================
// Git Service
// Renderer process service for Git integration (code-reader mode)
// ================================

// ================================
// Types
// ================================

export type FileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'unmodified'
  | 'conflicted';

export interface GitFileStatus {
  path: string;
  status: FileStatus;
  staged: boolean;
  oldPath?: string;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  parentHash: string | null;
  authorName: string;
  authorEmail: string;
  authorDate: Date;
  committerName: string;
  committerEmail: string;
  commitDate: Date;
  message: string;
  messageBody: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitBranch {
  name: string;
  isHead: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitRepository {
  id: string;
  path: string;
  name: string;
  remoteUrl: string | null;
  currentBranch: string | null;
  lastCommitHash: string | null;
  lastSyncedAt: string | null;
  isActive: boolean;
  settings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitBlame {
  lineNumber: number;
  commitHash: string;
  authorName: string;
  authorDate: Date;
  content: string;
}

export interface GitStash {
  index: number;
  message: string;
}

// ================================
// Git Service Class
// ================================

class GitService {
  // ================================
  // Repository Management
  // ================================

  /**
   * Check if a path is inside a git repository
   */
  async isInRepository(path: string): Promise<boolean> {
    return window.electron.git.isInRepository(path);
  }

  /**
   * Get or create repository record
   */
  async getRepository(path: string): Promise<GitRepository | null> {
    return window.electron.git.getRepository(path);
  }

  /**
   * Sync repository info (update branch, remote, etc.)
   */
  async syncRepository(path: string): Promise<GitRepository | null> {
    return window.electron.git.syncRepository(path);
  }

  // ================================
  // Branch Operations
  // ================================

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    return window.electron.git.getCurrentBranch(repoPath);
  }

  /**
   * Get all branches
   */
  async getBranches(repoPath: string): Promise<GitBranch[]> {
    return window.electron.git.getBranches(repoPath);
  }

  /**
   * Get local branches only
   */
  async getLocalBranches(repoPath: string): Promise<GitBranch[]> {
    const branches = await this.getBranches(repoPath);
    return branches.filter((b) => !b.isRemote);
  }

  /**
   * Get remote branches only
   */
  async getRemoteBranches(repoPath: string): Promise<GitBranch[]> {
    const branches = await this.getBranches(repoPath);
    return branches.filter((b) => b.isRemote);
  }

  // ================================
  // Remote Operations
  // ================================

  /**
   * Get remote URL (origin)
   */
  async getRemoteUrl(repoPath: string): Promise<string | null> {
    return window.electron.git.getRemoteUrl(repoPath);
  }

  /**
   * Get all remotes
   */
  async getRemotes(repoPath: string): Promise<GitRemote[]> {
    return window.electron.git.getRemotes(repoPath);
  }

  // ================================
  // Status Operations
  // ================================

  /**
   * Get file status for repository
   */
  async getStatus(repoPath: string): Promise<GitFileStatus[]> {
    return window.electron.git.getStatus(repoPath);
  }

  /**
   * Get status for a specific file
   */
  async getFileStatus(repoPath: string, filePath: string): Promise<FileStatus> {
    return window.electron.git.getFileStatus(repoPath, filePath);
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    return window.electron.git.hasUncommittedChanges(repoPath);
  }

  /**
   * Get modified files only
   */
  async getModifiedFiles(repoPath: string): Promise<GitFileStatus[]> {
    const status = await this.getStatus(repoPath);
    return status.filter((f) => f.status === 'modified');
  }

  /**
   * Get staged files only
   */
  async getStagedFiles(repoPath: string): Promise<GitFileStatus[]> {
    const status = await this.getStatus(repoPath);
    return status.filter((f) => f.staged);
  }

  /**
   * Get untracked files only
   */
  async getUntrackedFiles(repoPath: string): Promise<GitFileStatus[]> {
    const status = await this.getStatus(repoPath);
    return status.filter((f) => f.status === 'untracked');
  }

  // ================================
  // Commit Operations
  // ================================

  /**
   * Get HEAD commit hash
   */
  async getHeadCommit(repoPath: string): Promise<string | null> {
    return window.electron.git.getHeadCommit(repoPath);
  }

  /**
   * Get commit history
   */
  async getCommitHistory(
    repoPath: string,
    options: {
      limit?: number;
      skip?: number;
      branch?: string;
      filePath?: string;
    } = {}
  ): Promise<GitCommit[]> {
    const commits = await window.electron.git.getCommitHistory(repoPath, options);
    // Convert date strings to Date objects
    return commits.map((c: GitCommit) => ({
      ...c,
      authorDate: new Date(c.authorDate),
      commitDate: new Date(c.commitDate),
    }));
  }

  /**
   * Get commit details
   */
  async getCommit(repoPath: string, commitHash: string): Promise<GitCommit | null> {
    const commit = await window.electron.git.getCommit(repoPath, commitHash);
    if (!commit) return null;
    return {
      ...commit,
      authorDate: new Date(commit.authorDate),
      commitDate: new Date(commit.commitDate),
    };
  }

  /**
   * Get file history (commits that modified a specific file)
   */
  async getFileHistory(
    repoPath: string,
    filePath: string,
    limit = 50
  ): Promise<GitCommit[]> {
    const commits = await window.electron.git.getFileHistory(repoPath, filePath, limit);
    return commits.map((c: GitCommit) => ({
      ...c,
      authorDate: new Date(c.authorDate),
      commitDate: new Date(c.commitDate),
    }));
  }

  // ================================
  // Diff Operations
  // ================================

  /**
   * Get diff for working directory changes
   */
  async getWorkingDiff(repoPath: string, filePath?: string): Promise<string> {
    return window.electron.git.getWorkingDiff(repoPath, filePath);
  }

  /**
   * Get diff for staged changes
   */
  async getStagedDiff(repoPath: string, filePath?: string): Promise<string> {
    return window.electron.git.getStagedDiff(repoPath, filePath);
  }

  /**
   * Get diff between two commits
   */
  async getCommitDiff(
    repoPath: string,
    fromCommit: string,
    toCommit = 'HEAD',
    filePath?: string
  ): Promise<string> {
    return window.electron.git.getCommitDiff(repoPath, fromCommit, toCommit, filePath);
  }

  /**
   * Get file content at a specific commit
   */
  async getFileAtCommit(
    repoPath: string,
    filePath: string,
    commitHash: string
  ): Promise<string | null> {
    return window.electron.git.getFileAtCommit(repoPath, filePath, commitHash);
  }

  // ================================
  // Blame Operations
  // ================================

  /**
   * Get blame information for a file
   */
  async getBlame(repoPath: string, filePath: string): Promise<GitBlame[]> {
    const blameLines = await window.electron.git.getBlame(repoPath, filePath);
    return blameLines.map((line: GitBlame) => ({
      ...line,
      authorDate: new Date(line.authorDate),
    }));
  }

  // ================================
  // Stash Operations
  // ================================

  /**
   * List stashes
   */
  async listStashes(repoPath: string): Promise<GitStash[]> {
    return window.electron.git.listStashes(repoPath);
  }

  // ================================
  // Formatting Helpers
  // ================================

  /**
   * Get status icon for a file status
   */
  getStatusIcon(status: FileStatus): string {
    const icons: Record<FileStatus, string> = {
      modified: 'M',
      added: 'A',
      deleted: 'D',
      renamed: 'R',
      copied: 'C',
      untracked: 'U',
      ignored: 'I',
      unmodified: ' ',
      conflicted: '!',
    };
    return icons[status] || '?';
  }

  /**
   * Get status color for a file status
   */
  getStatusColor(status: FileStatus): string {
    const colors: Record<FileStatus, string> = {
      modified: '#e0a84c', // Yellow/Orange
      added: '#22c55e', // Green
      deleted: '#ef4444', // Red
      renamed: '#3b82f6', // Blue
      copied: '#3b82f6', // Blue
      untracked: '#6b7280', // Gray
      ignored: '#4b5563', // Dark gray
      unmodified: '#9ca3af', // Light gray
      conflicted: '#f59e0b', // Amber
    };
    return colors[status] || '#9ca3af';
  }

  /**
   * Get status label for a file status
   */
  getStatusLabel(status: FileStatus): string {
    const labels: Record<FileStatus, string> = {
      modified: '已修改',
      added: '已添加',
      deleted: '已删除',
      renamed: '已重命名',
      copied: '已复制',
      untracked: '未跟踪',
      ignored: '已忽略',
      unmodified: '未修改',
      conflicted: '冲突',
    };
    return labels[status] || status;
  }

  /**
   * Format commit date for display
   */
  formatCommitDate(commit: GitCommit): string {
    const date = new Date(commit.commitDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
      return '刚刚';
    } else if (diffMins < 60) {
      return `${diffMins} 分钟前`;
    } else if (diffHours < 24) {
      return `${diffHours} 小时前`;
    } else if (diffDays < 7) {
      return `${diffDays} 天前`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} 周前`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} 个月前`;
    } else {
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  }

  /**
   * Get abbreviated commit hash
   */
  getShortHash(hash: string): string {
    return hash.substring(0, 7);
  }

  /**
   * Format commit message (first line only)
   */
  getCommitTitle(commit: GitCommit): string {
    const firstLine = commit.message.split('\n')[0];
    return firstLine.length > 72 ? firstLine.substring(0, 69) + '...' : firstLine;
  }

  /**
   * Check if a URL is a GitHub URL
   */
  isGitHubUrl(url: string | null): boolean {
    if (!url) return false;
    return url.includes('github.com');
  }

  /**
   * Get GitHub commit URL
   */
  getGitHubCommitUrl(remoteUrl: string | null, commitHash: string): string | null {
    if (!remoteUrl || !this.isGitHubUrl(remoteUrl)) return null;

    // Convert SSH URL to HTTPS
    let httpsUrl = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '');

    return `${httpsUrl}/commit/${commitHash}`;
  }

  /**
   * Get GitHub file URL at specific commit
   */
  getGitHubFileUrl(
    remoteUrl: string | null,
    filePath: string,
    commitHash: string
  ): string | null {
    if (!remoteUrl || !this.isGitHubUrl(remoteUrl)) return null;

    let httpsUrl = remoteUrl
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/\.git$/, '');

    return `${httpsUrl}/blob/${commitHash}/${filePath}`;
  }
}

// ================================
// Singleton Export
// ================================

export const gitService = new GitService();

export default gitService;
