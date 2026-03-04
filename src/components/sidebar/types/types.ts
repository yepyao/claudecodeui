import type React from 'react';
import type { LoadingProgress, Project, ProjectSession, SessionProvider } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date';

export type SessionWithProvider = ProjectSession & {
  __provider: SessionProvider;
};

export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: SessionProvider;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
  onAppendSessions: (projectName: string, provider: SessionProvider, sessions: ProjectSession[], hasMore: boolean) => void;
  onUpdateSessionDisplayName: (projectName: string, sessionId: string, displayName: string | null) => void;
};

export type SessionViewModel = {
  isCursorSession: boolean;
  isCodexSession: boolean;
  isGeminiSession: boolean;
  hasUnread: boolean;
  sessionName: string;
  sessionTime: string;
  messageCount: number;
};

export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

export type TouchHandlerFactory = (
  callback: () => void,
) => (event: React.TouchEvent<HTMLElement>) => void;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
