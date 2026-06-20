import type { WorkspaceTreeEntry } from '@/lib/tauri';
import {
  normalizeWorkspacePath,
  workspacePathKey,
} from '@/lib/workspaceHistory';

const MAX_FILE_MENTION_SUGGESTIONS = 12;

export interface FileMentionTrigger {
  start: number;
  end: number;
  directory: string;
  query: string;
}

export type FileMentionListing =
  | {
      status: 'idle';
      rootPath: string;
      directory: string;
      entries: WorkspaceTreeEntry[];
      message?: undefined;
    }
  | {
      status: 'loading';
      rootPath: string;
      directory: string;
      entries: WorkspaceTreeEntry[];
      message?: undefined;
    }
  | {
      status: 'ready';
      rootPath: string;
      directory: string;
      entries: WorkspaceTreeEntry[];
      message?: undefined;
    }
  | {
      status: 'error';
      rootPath: string;
      directory: string;
      entries: WorkspaceTreeEntry[];
      message: string;
    };

export interface FileMentionListTarget {
  rootPath: string;
  relativePath: string;
  insertAbsolute: boolean;
}

export function normalizeFileMentionPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '');
}

function normalizeFileMentionAbsolutePath(value: string): string {
  return normalizeWorkspacePath(value).replace(/\\/g, '/');
}

function joinFileMentionPath(rootPath: string, relativePath: string): string {
  const root = normalizeFileMentionAbsolutePath(rootPath);
  const relative = normalizeFileMentionPath(relativePath).replace(/^\/+|\/+$/g, '');
  return relative ? `${root}/${relative}` : root;
}

export function fileMentionListTargets(
  directory: string,
  rootFolders: string[],
): FileMentionListTarget[] {
  const [primaryRoot] = rootFolders;
  if (!primaryRoot) return [];
  const primaryKey = workspacePathKey(primaryRoot);
  const normalizedDirectory = normalizeFileMentionAbsolutePath(directory);

  if (!normalizedDirectory) {
    return rootFolders.map((rootPath) => ({
      rootPath,
      relativePath: '',
      insertAbsolute: workspacePathKey(rootPath) !== primaryKey,
    }));
  }

  const directoryKey = workspacePathKey(normalizedDirectory);
  const matchedRoot = [...rootFolders]
    .sort((a, b) => normalizeFileMentionAbsolutePath(b).length - normalizeFileMentionAbsolutePath(a).length)
    .find((rootPath) => {
      const rootKey = workspacePathKey(rootPath);
      return directoryKey === rootKey || directoryKey.startsWith(`${rootKey}/`);
    });

  if (matchedRoot) {
    const root = normalizeFileMentionAbsolutePath(matchedRoot);
    const relativePath =
      directoryKey === workspacePathKey(matchedRoot)
        ? ''
        : normalizedDirectory.slice(root.length + 1);
    return [
      {
        rootPath: matchedRoot,
        relativePath: normalizeFileMentionPath(relativePath),
        insertAbsolute: true,
      },
    ];
  }

  return [
    {
      rootPath: primaryRoot,
      relativePath: normalizeFileMentionPath(directory),
      insertAbsolute: false,
    },
  ];
}

export function fileMentionEntryForTarget(
  entry: WorkspaceTreeEntry,
  target: FileMentionListTarget,
): WorkspaceTreeEntry {
  if (!target.insertAbsolute) return entry;
  return {
    ...entry,
    relativePath: joinFileMentionPath(target.rootPath, entry.relativePath),
  };
}

export function fileMentionListingKey(targets: FileMentionListTarget[]): string {
  return targets
    .map((target) => `${workspacePathKey(target.rootPath)}::${target.relativePath}::${target.insertAbsolute}`)
    .join('|');
}

export function uniqueFileMentionEntries(entries: WorkspaceTreeEntry[]): WorkspaceTreeEntry[] {
  const seen = new Set<string>();
  const out: WorkspaceTreeEntry[] = [];
  for (const entry of entries) {
    const key = workspacePathKey(entry.path || entry.relativePath);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function splitFileMentionPath(value: string): {
  directory: string;
  query: string;
} {
  const normalized = normalizeFileMentionPath(value);
  const slash = normalized.lastIndexOf('/');
  if (slash === -1) return { directory: '', query: normalized };
  return {
    directory: normalized.slice(0, slash).replace(/^\/+|\/+$/g, ''),
    query: normalized.slice(slash + 1),
  };
}

export function findFileMentionTrigger(
  text: string,
  caret: number,
): FileMentionTrigger | null {
  if (caret < 1) return null;

  const beforeCaret = text.slice(0, caret);
  const match = /(^|\s)@([^\s]*)$/.exec(beforeCaret);
  if (!match) return null;

  const rawPath = match[2] ?? '';
  const start = beforeCaret.length - rawPath.length - 1;
  const { directory, query } = splitFileMentionPath(rawPath);
  return { start, end: caret, directory, query };
}

export function filterFileMentionEntries(
  entries: WorkspaceTreeEntry[],
  query: string,
): WorkspaceTreeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, MAX_FILE_MENTION_SUGGESTIONS);

  const starts: WorkspaceTreeEntry[] = [];
  const contains: WorkspaceTreeEntry[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const path = entry.relativePath.toLowerCase();
    if (name.startsWith(q) || path.startsWith(q)) {
      starts.push(entry);
      continue;
    }
    if (name.includes(q) || path.includes(q)) contains.push(entry);
  }

  return [...starts, ...contains].slice(0, MAX_FILE_MENTION_SUGGESTIONS);
}

export function fileMentionInsertText(entry: WorkspaceTreeEntry): string {
  const relativePath = normalizeFileMentionPath(entry.relativePath);
  return `@${relativePath}${entry.kind === 'directory' ? '/' : ''}`;
}

export function fileMentionErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'NO_BACKEND') {
    return '当前浏览器模式不能读取本机文件。请使用桌面端。';
  }
  return err instanceof Error ? err.message : String(err);
}
