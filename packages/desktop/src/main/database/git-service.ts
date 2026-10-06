// ================================
// Git Integration Service
// 为文档版本历史提供 Git 状态与提交记录
// ================================

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { getSQLiteService } from './sqlite';
import { randomUUID } from 'crypto';

const execAsync = promisify(exec);

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
  oldPath?: string; // For renames
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

export interface GitDiffLine {
  type: 'add' | 'remove' | 'context';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
}

export interface GitFileDiff {
  filePath: string;
  oldPath?: string;
  changeType: 'add' | 'modify' | 'delete' | 'rename' | 'copy';
  additions: number;
  deletions: number;
  isBinary: boolean;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: GitDiffLine[];
  }>;
}

// ================================
// Helper Functions
// ================================

/**
 * 检查目录是否为 Git 仓库
 */
export async function isGitRepository(dirPath: string): Promise<boolean> {
  try {
    const gitDir = join(dirPath, '.git');
    return existsSync(gitDir) && statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Find the git root directory from a given path
 */
async function findGitRoot(startPath: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: startPath,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Execute a git command and return stdout
 */
async function gitCommand(
  args: string[],
  cwd: string,
  options: { timeout?: number } = {}
): Promise<string> {
  const { timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('git', args, {
      cwd,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Git command failed: ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse git status porcelain output
 */
function parseGitStatus(output: string): GitFileStatus[] {
  const files: GitFileStatus[] = [];
  const lines = output.split('\n').filter((line) => line.length > 0);

  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    let filePath = line.substring(3);

    // Handle renames (format: "R  old -> new")
    let oldPath: string | undefined;
    if (filePath.includes(' -> ')) {
      const parts = filePath.split(' -> ');
      oldPath = parts[0];
      filePath = parts[1];
    }

    let status: FileStatus = 'unmodified';
    let staged = false;

    // Check index status (staged)
    if (indexStatus === 'M') {
      status = 'modified';
      staged = true;
    } else if (indexStatus === 'A') {
      status = 'added';
      staged = true;
    } else if (indexStatus === 'D') {
      status = 'deleted';
      staged = true;
    } else if (indexStatus === 'R') {
      status = 'renamed';
      staged = true;
    } else if (indexStatus === 'C') {
      status = 'copied';
      staged = true;
    }

    // Check work tree status (unstaged)
    if (workTreeStatus === 'M') {
      status = 'modified';
    } else if (workTreeStatus === 'D') {
      status = 'deleted';
    } else if (workTreeStatus === '?') {
      status = 'untracked';
    } else if (workTreeStatus === '!') {
      status = 'ignored';
    } else if (workTreeStatus === 'U' || indexStatus === 'U') {
      status = 'conflicted';
    }

    files.push({
      path: filePath,
      status,
      staged,
      oldPath,
    });
  }

  return files;
}

/**
 * Parse git log output
 */
function parseGitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const entries = output.split('\x00').filter((entry) => entry.trim());

  for (const entry of entries) {
    const lines = entry.split('\n');
    if (lines.length < 8) continue;

    const [
      hash,
      shortHash,
      parentHash,
      authorName,
      authorEmail,
      authorDate,
      committerName,
      committerEmail,
      commitDate,
      ...messageParts
    ] = lines;

    const message = messageParts[0] || '';
    const messageBody = messageParts.slice(1).join('\n').trim();

    commits.push({
      hash,
      shortHash,
      parentHash: parentHash || null,
      authorName,
      authorEmail,
      authorDate: new Date(authorDate),
      committerName,
      committerEmail,
      commitDate: new Date(commitDate),
      message,
      messageBody,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    });
  }

  return commits;
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
    const root = await findGitRoot(path);
    return root !== null;
  }

  /**
   * Get or create repository record
   */
  async getOrCreateRepository(path: string): Promise<GitRepository | null> {
    const gitRoot = await findGitRoot(path);
    if (!gitRoot) return null;

    const db = getSQLiteService();

    // Check if already exists
    let repo = db.get<{
      id: string;
      path: string;
      name: string;
      remote_url: string | null;
      current_branch: string | null;
      last_commit_hash: string | null;
      last_synced_at: string | null;
      is_active: number;
      settings: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM git_repositories WHERE path = ?', [gitRoot]);

    if (repo) {
      return {
        id: repo.id,
        path: repo.path,
        name: repo.name,
        remoteUrl: repo.remote_url,
        currentBranch: repo.current_branch,
        lastCommitHash: repo.last_commit_hash,
        lastSyncedAt: repo.last_synced_at,
        isActive: repo.is_active === 1,
        settings: repo.settings ? JSON.parse(repo.settings) : null,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
      };
    }

    // Create new repository record
    const id = randomUUID();
    const name = basename(gitRoot);
    const remoteUrl = await this.getRemoteUrl(gitRoot);
    const currentBranch = await this.getCurrentBranch(gitRoot);
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO git_repositories (
        id, path, name, remote_url, current_branch, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, gitRoot, name, remoteUrl, currentBranch, now, now]
    );

    return {
      id,
      path: gitRoot,
      name,
      remoteUrl,
      currentBranch,
      lastCommitHash: null,
      lastSyncedAt: null,
      isActive: true,
      settings: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Update repository info
   */
  async syncRepository(path: string): Promise<GitRepository | null> {
    const gitRoot = await findGitRoot(path);
    if (!gitRoot) return null;

    const db = getSQLiteService();
    const currentBranch = await this.getCurrentBranch(gitRoot);
    const remoteUrl = await this.getRemoteUrl(gitRoot);
    const lastCommitHash = await this.getHeadCommit(gitRoot);
    const now = new Date().toISOString();

    db.run(
      `UPDATE git_repositories
       SET current_branch = ?, remote_url = ?, last_commit_hash = ?,
           last_synced_at = ?, updated_at = ?
       WHERE path = ?`,
      [currentBranch, remoteUrl, lastCommitHash, now, now, gitRoot]
    );

    return this.getOrCreateRepository(path);
  }

  // ================================
  // Branch Operations
  // ================================

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const output = await gitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get all branches
   */
  async getBranches(repoPath: string): Promise<GitBranch[]> {
    try {
      const output = await gitCommand(
        ['branch', '-a', '--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(upstream:track)'],
        repoPath
      );

      const branches: GitBranch[] = [];
      const lines = output.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        const [name, isHead, upstream, track] = line.split('|');

        // Parse ahead/behind from track info like "[ahead 2, behind 1]"
        let ahead = 0;
        let behind = 0;
        if (track) {
          const aheadMatch = track.match(/ahead (\d+)/);
          const behindMatch = track.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        }

        branches.push({
          name,
          isHead: isHead === '*',
          isRemote: name.startsWith('origin/') || name.startsWith('remotes/'),
          upstream: upstream || undefined,
          ahead,
          behind,
        });
      }

      return branches;
    } catch {
      return [];
    }
  }

  // ================================
  // Remote Operations
  // ================================

  /**
   * Get remote URL (origin)
   */
  async getRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const output = await gitCommand(['remote', 'get-url', 'origin'], repoPath);
      return output.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get all remotes
   */
  async getRemotes(repoPath: string): Promise<GitRemote[]> {
    try {
      const output = await gitCommand(['remote', '-v'], repoPath);
      const remotes: Map<string, GitRemote> = new Map();

      const lines = output.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (match) {
          const [, name, url, type] = match;
          const existing = remotes.get(name) || { name, fetchUrl: '', pushUrl: '' };
          if (type === 'fetch') existing.fetchUrl = url;
          if (type === 'push') existing.pushUrl = url;
          remotes.set(name, existing);
        }
      }

      return Array.from(remotes.values());
    } catch {
      return [];
    }
  }

  // ================================
  // Status Operations
  // ================================

  /**
   * Get file status for repository
   */
  async getStatus(repoPath: string): Promise<GitFileStatus[]> {
    try {
      const output = await gitCommand(['status', '--porcelain=v1'], repoPath);
      return parseGitStatus(output);
    } catch {
      return [];
    }
  }

  /**
   * Get status for a specific file
   */
  async getFileStatus(repoPath: string, filePath: string): Promise<FileStatus> {
    try {
      const relativePath = relative(repoPath, filePath);
      const output = await gitCommand(['status', '--porcelain=v1', '--', relativePath], repoPath);
      const statuses = parseGitStatus(output);
      return statuses.length > 0 ? statuses[0].status : 'unmodified';
    } catch {
      return 'unmodified';
    }
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    try {
      const output = await gitCommand(['status', '--porcelain'], repoPath);
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  // ================================
  // Commit Operations
  // ================================

  /**
   * Get HEAD commit hash
   */
  async getHeadCommit(repoPath: string): Promise<string | null> {
    try {
      const output = await gitCommand(['rev-parse', 'HEAD'], repoPath);
      return output.trim();
    } catch {
      return null;
    }
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
    const { limit = 50, skip = 0, branch, filePath } = options;

    try {
      const args = [
        'log',
        `--max-count=${limit}`,
        `--skip=${skip}`,
        '--format=%H%n%h%n%P%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%s%n%b%x00',
      ];

      if (branch) {
        args.push(branch);
      }

      if (filePath) {
        args.push('--', filePath);
      }

      const output = await gitCommand(args, repoPath);
      return parseGitLog(output);
    } catch {
      return [];
    }
  }

  /**
   * Get commit details
   */
  async getCommit(repoPath: string, commitHash: string): Promise<GitCommit | null> {
    try {
      const output = await gitCommand(
        [
          'show',
          '--format=%H%n%h%n%P%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%s%n%b%x00',
          '--stat',
          commitHash,
        ],
        repoPath
      );

      const commits = parseGitLog(output);
      if (commits.length === 0) return null;

      const commit = commits[0];

      // Parse stat info from the output
      const statMatch = output.match(
        /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
      );
      if (statMatch) {
        commit.filesChanged = parseInt(statMatch[1], 10) || 0;
        commit.insertions = parseInt(statMatch[2], 10) || 0;
        commit.deletions = parseInt(statMatch[3], 10) || 0;
      }

      return commit;
    } catch {
      return null;
    }
  }

  /**
   * Get file history
   */
  async getFileHistory(repoPath: string, filePath: string, limit = 50): Promise<GitCommit[]> {
    return this.getCommitHistory(repoPath, { limit, filePath });
  }

  // ================================
  // Diff Operations
  // ================================

  /**
   * Get diff for working directory changes
   */
  async getWorkingDiff(repoPath: string, filePath?: string): Promise<string> {
    try {
      const args = ['diff'];
      if (filePath) {
        args.push('--', filePath);
      }
      return await gitCommand(args, repoPath);
    } catch {
      return '';
    }
  }

  /**
   * Get diff for staged changes
   */
  async getStagedDiff(repoPath: string, filePath?: string): Promise<string> {
    try {
      const args = ['diff', '--cached'];
      if (filePath) {
        args.push('--', filePath);
      }
      return await gitCommand(args, repoPath);
    } catch {
      return '';
    }
  }

  /**
   * Get diff between two commits
   */
  async getCommitDiff(
    repoPath: string,
    fromCommit: string,
    toCommit: string = 'HEAD',
    filePath?: string
  ): Promise<string> {
    try {
      const args = ['diff', fromCommit, toCommit];
      if (filePath) {
        args.push('--', filePath);
      }
      return await gitCommand(args, repoPath);
    } catch {
      return '';
    }
  }

  /**
   * Get file content at a specific commit
   */
  async getFileAtCommit(
    repoPath: string,
    filePath: string,
    commitHash: string
  ): Promise<string | null> {
    try {
      const relativePath = relative(repoPath, filePath);
      return await gitCommand(['show', `${commitHash}:${relativePath}`], repoPath);
    } catch {
      return null;
    }
  }

  // ================================
  // Blame Operations
  // ================================

  /**
   * Get blame information for a file
   */
  async getBlame(repoPath: string, filePath: string): Promise<GitBlame[]> {
    try {
      const relativePath = relative(repoPath, filePath);
      const output = await gitCommand(['blame', '--porcelain', relativePath], repoPath);

      const blameLines: GitBlame[] = [];
      const lines = output.split('\n');
      let currentBlame: Partial<GitBlame> = {};
      let lineNumber = 0;

      for (const line of lines) {
        if (line.startsWith('\t')) {
          // Content line
          lineNumber++;
          blameLines.push({
            lineNumber,
            commitHash: currentBlame.commitHash || '',
            authorName: currentBlame.authorName || '',
            authorDate: currentBlame.authorDate || new Date(),
            content: line.substring(1),
          });
        } else if (line.match(/^[a-f0-9]{40}/)) {
          // Commit hash line
          currentBlame = {
            commitHash: line.substring(0, 40),
          };
        } else if (line.startsWith('author ')) {
          currentBlame.authorName = line.substring(7);
        } else if (line.startsWith('author-time ')) {
          currentBlame.authorDate = new Date(parseInt(line.substring(12), 10) * 1000);
        }
      }

      return blameLines;
    } catch {
      return [];
    }
  }

  // ================================
  // Stash Operations
  // ================================

  /**
   * List stashes
   */
  async listStashes(repoPath: string): Promise<Array<{ index: number; message: string }>> {
    try {
      const output = await gitCommand(['stash', 'list'], repoPath);
      const stashes: Array<{ index: number; message: string }> = [];

      const lines = output.split('\n').filter((l) => l.trim());
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^stash@\{(\d+)\}: (.+)$/);
        if (match) {
          stashes.push({
            index: parseInt(match[1], 10),
            message: match[2],
          });
        }
      }

      return stashes;
    } catch {
      return [];
    }
  }
}

// ================================
// Singleton Export
// ================================

let gitService: GitService | null = null;

export function getGitService(): GitService {
  if (!gitService) {
    gitService = new GitService();
  }
  return gitService;
}

export default GitService;
