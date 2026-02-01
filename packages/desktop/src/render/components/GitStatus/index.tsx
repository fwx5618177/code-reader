// ================================
// Git Status 组件
// 在 code-reader 模式下显示 Git 信息
// ================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitCommit as GitCommitIcon,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  ExternalLink,
  FileCode,
  FilePlus,
  FileX,
  FileEdit,
  AlertTriangle,
  Check,
} from 'lucide-react';
import {
  gitService,
  GitFileStatus,
  GitCommit,
  GitBranch as GitBranchType,
  GitRepository,
  FileStatus,
} from '../../services/gitService';
import styles from './GitStatus.module.scss';

// ================================
// 类型定义
// ================================

export interface GitStatusProps {
  folderPath: string | null;
  onFileSelect?: (filePath: string) => void;
  className?: string;
}

interface GitStatusBadgeProps {
  status: FileStatus;
  size?: 'sm' | 'md';
}

// ================================
// Git 状态徽章组件
// ================================

export function GitStatusBadge({ status, size = 'sm' }: GitStatusBadgeProps) {
  const getIcon = () => {
    switch (status) {
      case 'modified':
        return <FileEdit size={size === 'sm' ? 12 : 14} />;
      case 'added':
        return <FilePlus size={size === 'sm' ? 12 : 14} />;
      case 'deleted':
        return <FileX size={size === 'sm' ? 12 : 14} />;
      case 'conflicted':
        return <AlertTriangle size={size === 'sm' ? 12 : 14} />;
      default:
        return <FileCode size={size === 'sm' ? 12 : 14} />;
    }
  };

  if (status === 'unmodified' || status === 'ignored') {
    return null;
  }

  const badgeClasses = [styles.statusBadge, styles[status], styles[size]].filter(Boolean).join(' ');

  return (
    <span className={badgeClasses} title={gitService.getStatusLabel(status)}>
      {getIcon()}
    </span>
  );
}

// ================================
// 分支选择器组件
// ================================

interface BranchSelectorProps {
  currentBranch: string | null;
  branches: GitBranchType[];
  isLoading: boolean;
}

function BranchSelector({ currentBranch, branches, isLoading }: BranchSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  const currentBranchInfo = branches.find((b) => b.isHead);

  return (
    <div className={styles.branchSelector}>
      <button
        className={styles.branchButton}
        onClick={() => setExpanded(!expanded)}
        disabled={isLoading}
      >
        <GitBranch size={14} />
        <span className={styles.branchName}>{currentBranch || '无分支'}</span>
        {currentBranchInfo?.ahead !== undefined && currentBranchInfo.ahead > 0 && (
          <span
            className={`${styles.syncIndicator} ${styles.ahead}`}
            title={`领先 ${currentBranchInfo.ahead} 个提交`}
          >
            ↑{currentBranchInfo.ahead}
          </span>
        )}
        {currentBranchInfo?.behind !== undefined && currentBranchInfo.behind > 0 && (
          <span
            className={`${styles.syncIndicator} ${styles.behind}`}
            title={`落后 ${currentBranchInfo.behind} 个提交`}
          >
            ↓{currentBranchInfo.behind}
          </span>
        )}
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {expanded && (
        <div className={styles.branchDropdown}>
          <div className={styles.branchSection}>
            <div className={styles.sectionTitle}>本地分支</div>
            {branches
              .filter((b) => !b.isRemote)
              .map((branch) => (
                <div
                  key={branch.name}
                  className={`${styles.branchItem} ${branch.isHead ? styles.current : ''}`}
                >
                  {branch.isHead && <Check size={12} />}
                  <span>{branch.name}</span>
                </div>
              ))}
          </div>
          {branches.some((b) => b.isRemote) && (
            <div className={styles.branchSection}>
              <div className={styles.sectionTitle}>远程分支</div>
              {branches
                .filter((b) => b.isRemote)
                .slice(0, 10)
                .map((branch) => (
                  <div key={branch.name} className={`${styles.branchItem} ${styles.remote}`}>
                    <span>{branch.name.replace(/^origin\//, '')}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================
// 更改的文件列表组件
// ================================

interface ChangedFilesListProps {
  files: GitFileStatus[];
  onFileSelect?: (filePath: string) => void;
  repoPath: string;
}

function ChangedFilesList({ files, onFileSelect, repoPath }: ChangedFilesListProps) {
  const [expanded, setExpanded] = useState(true);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  if (files.length === 0) {
    return (
      <div className={styles.noChanges}>
        <Check size={16} />
        <span>工作区干净</span>
      </div>
    );
  }

  return (
    <div className={styles.changedFiles}>
      <div className={styles.sectionHeader} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>更改的文件</span>
        <span className={styles.count}>{files.length}</span>
      </div>

      {expanded && (
        <div className={styles.filesList}>
          {stagedFiles.length > 0 && (
            <div className={styles.fileGroup}>
              <div className={styles.groupTitle}>已暂存</div>
              {stagedFiles.map((file) => (
                <div
                  key={file.path}
                  className={styles.fileItem}
                  onClick={() => onFileSelect?.(`${repoPath}/${file.path}`)}
                >
                  <GitStatusBadge status={file.status} />
                  <span className={styles.fileName} title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                  <span className={styles.filePath}>{file.path}</span>
                </div>
              ))}
            </div>
          )}

          {unstagedFiles.length > 0 && (
            <div className={styles.fileGroup}>
              <div className={styles.groupTitle}>未暂存</div>
              {unstagedFiles.map((file) => (
                <div
                  key={file.path}
                  className={styles.fileItem}
                  onClick={() => onFileSelect?.(`${repoPath}/${file.path}`)}
                >
                  <GitStatusBadge status={file.status} />
                  <span className={styles.fileName} title={file.path}>
                    {file.path.split('/').pop()}
                  </span>
                  <span className={styles.filePath}>{file.path}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ================================
// 最近提交组件
// ================================

interface RecentCommitsProps {
  commits: GitCommit[];
  remoteUrl: string | null;
  isLoading: boolean;
}

function RecentCommits({ commits, remoteUrl, isLoading }: RecentCommitsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.recentCommits}>
      <div className={styles.sectionHeader} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <GitCommitIcon size={14} />
        <span>最近提交</span>
        <span className={styles.count}>{commits.length}</span>
      </div>

      {expanded && (
        <div className={styles.commitsList}>
          {isLoading ? (
            <div className={styles.loading}>加载中...</div>
          ) : commits.length === 0 ? (
            <div className={styles.empty}>暂无提交记录</div>
          ) : (
            commits.slice(0, 10).map((commit) => (
              <div key={commit.hash} className={styles.commitItem}>
                <div className={styles.commitHeader}>
                  <span className={styles.commitHash}>{commit.shortHash}</span>
                  <span className={styles.commitDate}>
                    <Clock size={10} />
                    {gitService.formatCommitDate(commit)}
                  </span>
                </div>
                <div className={styles.commitMessage} title={commit.message}>
                  {gitService.getCommitTitle(commit)}
                </div>
                <div className={styles.commitAuthor}>
                  <User size={10} />
                  <span>{commit.authorName}</span>
                </div>
                {remoteUrl && gitService.isGitHubUrl(remoteUrl) && (
                  <a
                    className={styles.commitLink}
                    href={gitService.getGitHubCommitUrl(remoteUrl, commit.hash) || '#'}
                    onClick={(e) => {
                      e.preventDefault();
                      const url = gitService.getGitHubCommitUrl(remoteUrl, commit.hash);
                      if (url) {
                        window.electron.ipcRenderer.invoke('open-external', url);
                      }
                    }}
                    title="在 GitHub 上查看"
                  >
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ================================
// 主组件
// ================================

export function GitStatus({ folderPath, onFileSelect, className }: GitStatusProps) {
  const [repository, setRepository] = useState<GitRepository | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [changedFiles, setChangedFiles] = useState<GitFileStatus[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(false);

  // 检查文件夹是否为 git 仓库并加载数据
  const loadGitData = useCallback(async () => {
    if (!folderPath) {
      setIsGitRepo(false);
      return;
    }

    setIsLoading(true);

    try {
      // 检查是否为 git 仓库
      const inRepo = await gitService.isInRepository(folderPath);
      setIsGitRepo(inRepo);

      if (!inRepo) {
        setRepository(null);
        setBranches([]);
        setChangedFiles([]);
        setCommits([]);
        return;
      }

      // 获取仓库信息
      const repo = await gitService.getRepository(folderPath);
      setRepository(repo);

      // 获取分支列表
      const branchList = await gitService.getBranches(folderPath);
      setBranches(branchList);

      // 获取更改的文件
      const status = await gitService.getStatus(folderPath);
      setChangedFiles(status);

      // 获取最近提交
      const commitHistory = await gitService.getCommitHistory(folderPath, { limit: 20 });
      setCommits(commitHistory);
    } catch (error) {
      console.error('加载 git 数据失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [folderPath]);

  // 当文件夹变化时加载数据
  useEffect(() => {
    loadGitData();
  }, [loadGitData]);

  // 刷新处理
  const handleRefresh = useCallback(() => {
    loadGitData();
  }, [loadGitData]);

  if (!folderPath) {
    return null;
  }

  if (!isGitRepo) {
    return (
      <div className={`${styles.gitStatus} ${styles.notRepo} ${className || ''}`}>
        <div className={styles.notRepoMessage}>
          <GitBranch size={16} />
          <span>非 Git 仓库</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.gitStatus} ${className || ''}`}>
      {/* 头部 */}
      <div className={styles.header}>
        <div className={styles.repoName}>
          <GitBranch size={14} />
          <span>{repository?.name || '仓库'}</span>
        </div>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={isLoading}
          title="刷新"
        >
          <RefreshCw size={14} className={isLoading ? styles.spinning : ''} />
        </button>
      </div>

      {/* 分支选择器 */}
      <BranchSelector
        currentBranch={repository?.currentBranch || null}
        branches={branches}
        isLoading={isLoading}
      />

      {/* 更改的文件 */}
      <ChangedFilesList files={changedFiles} onFileSelect={onFileSelect} repoPath={folderPath} />

      {/* 最近提交 */}
      <RecentCommits
        commits={commits}
        remoteUrl={repository?.remoteUrl || null}
        isLoading={isLoading}
      />
    </div>
  );
}

export default GitStatus;
