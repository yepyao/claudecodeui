import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type {
  DeleteProjectConfirmation,
  LoadingSessionsByProject,
  ProjectSortOrder,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  filterProjects,
  getAllSessions,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  isMobile: boolean;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (sessionId: string) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
  onAppendSessions: (projectName: string, provider: SessionProvider, sessions: ProjectSession[], hasMore: boolean) => void;
  onUpdateSessionDisplayName: (projectName: string, sessionId: string, displayName: string | null) => void;
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession,
  isLoading,
  isMobile,
  t,
  onRefresh,
  onProjectSelect,
  onSessionSelect,
  onSessionDelete,
  onProjectDelete,
  setCurrentProject,
  setSidebarVisible,
  sidebarVisible,
  onAppendSessions,
  onUpdateSessionDisplayName,
}: UseSidebarControllerArgs) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [loadingSessions, setLoadingSessions] = useState<LoadingSessionsByProject>({});
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(new Date());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>('name');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [starredProjects, setStarredProjects] = useState<Set<string>>(new Set());
  const starredInitialized = useRef(false);

  const isSidebarCollapsed = !isMobile && !sidebarVisible;

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const projectNames = new Set(projects.map((p) => p.name));
    
    setInitialSessionsLoaded((prev) => {
      const filtered = new Set([...prev].filter((name) => projectNames.has(name)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [projects]);

  // Initialize starred state from server data once on first load
  // After that, local state is the source of truth (synced to server via API calls)
  useEffect(() => {
    if (starredInitialized.current || projects.length === 0) {
      return;
    }

    starredInitialized.current = true;

    const newStarredProjects = new Set<string>();

    for (const project of projects) {
      if (project.starred) {
        newStarredProjects.add(project.name);
      }
    }

    // One-time migration from localStorage to server
    try {
      const saved = localStorage.getItem('starredProjects');
      if (saved) {
        const localStarred = JSON.parse(saved) as string[];
        for (const projectName of localStarred) {
          if (!newStarredProjects.has(projectName)) {
            newStarredProjects.add(projectName);
            void api.starProject(projectName);
          }
        }
        localStorage.removeItem('starredProjects');
      }
    } catch {
      // Ignore migration errors
    }

    setStarredProjects(newStarredProjects);
  }, [projects]);

  useEffect(() => {
    if (selectedProject?.name) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProject.name)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(selectedProject.name);
        return next;
      });
    }
  }, [selectedSession?.id, selectedProject?.name]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.name);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadSortOrder = () => {
      setProjectSortOrder(readProjectSortOrder());
    };

    loadSortOrder();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings') {
        loadSortOrder();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadSortOrder();
      }
    }, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  const toggleProject = useCallback((projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set<string>();
      if (!prev.has(projectName)) {
        next.add(projectName);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectName: string) => {
      onSessionSelect({ ...session, __projectName: projectName });
    },
    [onSessionSelect],
  );

  const toggleStarProject = useCallback((projectName: string) => {
    setStarredProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
    void api.starProject(projectName);
  }, []);

  const isProjectStarred = useCallback(
    (projectName: string) => starredProjects.has(projectName),
    [starredProjects],
  );

  const toggleStarSession = useCallback((projectName: string, sessionId: string) => {
    // Call API to toggle star status
    // The session's starred field will be updated when projects refresh or via WS update
    void api.starSession(projectName, sessionId).then(() => {
      // Trigger a refresh to update the UI with the new starred status
      void onRefresh();
    });
  }, [onRefresh]);

  const isSessionStarred = useCallback(
    (projectName: string, sessionId: string) => {
      const project = projects.find((p) => p.name === projectName);
      if (!project) return false;
      const allSessions = [
        ...(project.sessions ?? []),
        ...(project.cursorSessions ?? []),
        ...(project.codexSessions ?? []),
        ...(project.geminiSessions ?? []),
      ];
      const session = allSessions.find((s) => s.id === sessionId);
      return session?.starred ?? false;
    },
    [projects],
  );

  const getProjectSessions = useCallback(
    (project: Project) => getAllSessions(project),
    [],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projects, projectSortOrder, starredProjects),
    [projectSortOrder, projects, starredProjects],
  );

  const filteredProjects = useMemo(
    () => filterProjects(sortedProjects, searchFilter),
    [searchFilter, sortedProjects],
  );

  const startEditing = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    async (projectName: string) => {
      try {
        const response = await api.renameProject(projectName, editingName);
        if (response.ok) {
          if (window.refreshProjects) {
            await window.refreshProjects();
          } else {
            window.location.reload();
          }
        } else {
          console.error('Failed to rename project');
        }
      } catch (error) {
        console.error('Error renaming project:', error);
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName],
  );

  const showDeleteSessionConfirmation = useCallback(
    (
      projectName: string,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
    ) => {
      setSessionDeleteConfirmation({ projectName, sessionId, sessionTitle, provider });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async () => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { projectName, sessionId, provider } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    try {
      let response;
      if (provider === 'codex') {
        response = await api.deleteCodexSession(sessionId);
      } else if (provider === 'gemini') {
        response = await api.deleteGeminiSession(sessionId);
      } else if (provider === 'cursor') {
        response = await api.deleteCursorSession(sessionId);
      } else {
        response = await api.deleteSession(projectName, sessionId);
      }

      if (response.ok) {
        onSessionDelete?.(sessionId);
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [onSessionDelete, sessionDeleteConfirmation, t]);

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation) {
      return;
    }

    const { project, sessionCount } = deleteConfirmation;
    const isEmpty = sessionCount === 0;

    setDeleteConfirmation(null);
    setDeletingProjects((prev) => new Set([...prev, project.name]));

    try {
      const response = await api.deleteProject(project.name, !isEmpty);

      if (response.ok) {
        onProjectDelete?.(project.name);
      } else {
        const error = (await response.json()) as { error?: string };
        alert(error.error || t('messages.deleteProjectFailed'));
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert(t('messages.deleteProjectError'));
    } finally {
      setDeletingProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.name);
        return next;
      });
    }
  }, [deleteConfirmation, onProjectDelete, t]);

  const loadMoreSessions = useCallback(
    async (project: Project) => {
      if (loadingSessions[project.name]) {
        return;
      }

      const claudeCanLoadMore = project.sessionMeta?.hasMore === true;
      const cursorCanLoadMore = project.cursorSessionMeta?.hasMore === true;

      if (!claudeCanLoadMore && !cursorCanLoadMore) {
        return;
      }

      setLoadingSessions((prev) => ({ ...prev, [project.name]: true }));

      try {
        const loadPromises: Promise<void>[] = [];

        if (claudeCanLoadMore) {
          const nonStarredOffset = (project.sessions || []).filter((s) => !s.starred).length;

          loadPromises.push(
            api.sessions(project.name, 5, nonStarredOffset, 'claude').then(async (response) => {
              if (!response.ok) return;
              const result = (await response.json()) as {
                sessions?: ProjectSession[];
                hasMore?: boolean;
              };
              onAppendSessions(project.name, 'claude', result.sessions || [], result.hasMore ?? false);
            })
          );
        }

        if (cursorCanLoadMore) {
          const cursorNonStarredOffset = (project.cursorSessions || []).filter((s) => !s.starred).length;

          loadPromises.push(
            api.sessions(project.name, 5, cursorNonStarredOffset, 'cursor').then(async (response) => {
              if (!response.ok) return;
              const result = (await response.json()) as {
                sessions?: ProjectSession[];
                hasMore?: boolean;
              };
              onAppendSessions(project.name, 'cursor', result.sessions || [], result.hasMore ?? false);
            })
          );
        }

        await Promise.all(loadPromises);
      } catch (error) {
        console.error('Error loading more sessions:', error);
      } finally {
        setLoadingSessions((prev) => ({ ...prev, [project.name]: false }));
      }
    },
    [loadingSessions, onAppendSessions],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const updateSessionSummary = useCallback(
    async (projectName: string, sessionId: string, displayName: string) => {
      try {
        const trimmed = displayName.trim() || null;
        const response = await api.renameSession(projectName, sessionId, trimmed);
        if (response.ok) {
          onUpdateSessionDisplayName(projectName, sessionId, trimmed);
        } else {
          console.error('Failed to rename session');
        }
      } catch (error) {
        console.error('Error renaming session:', error);
      } finally {
        setEditingSession(null);
        setEditingSessionName('');
      }
    },
    [onUpdateSessionDisplayName],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    currentTime,
    projectSortOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    searchFilter,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    starredProjects,
    filteredProjects,
    handleTouchClick,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    toggleStarSession,
    isSessionStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setSearchFilter,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
