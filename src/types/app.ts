export type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview';

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  lastBlobOffset?: number;
  displayName?: string | null;
  starred?: boolean;
  readAt?: string | null;
  readBlobOffset?: number | null;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;                       // Canonical name (Claude format: -foo-bar)
  cursorName?: string;                // Cursor format name (foo-bar) for internal lookups
  displayName: string;
  fullPath: string;
  path?: string;
  starred?: boolean;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  cursorSessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  changedSessionIds?: string[];
  [key: string]: unknown;
}

export interface SessionUpdateInfo {
  sessionIds: string[];
  provider: SessionProvider;
}

export interface SessionsUpdatedMessage {
  type: 'sessions_updated';
  updates: Record<string, SessionUpdateInfo>;
  timestamp?: string;
  [key: string]: unknown;
}

export interface BatchSessionRequest {
  projectName: string;
  sessionId: string;
  provider: SessionProvider;
}

export interface BatchSessionResponse {
  projectName: string;
  sessionId: string;
  provider: SessionProvider;
  session: ProjectSession | null;
  error?: string;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | SessionsUpdatedMessage
  | { type?: string;[key: string]: unknown };
