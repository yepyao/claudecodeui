import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import type {
  AppSocketMessage,
  AppTab,
  BatchSessionRequest,
  BatchSessionResponse,
  LoadingProgress,
  Project,
  ProjectSession,
  ProjectsUpdatedMessage,
  SessionProvider,
  SessionsUpdatedMessage,
} from '../types/app';

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<string>;
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.taskmaster) !== serialize(prevProject.taskmaster);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.cursorSessions) !== serialize(prevProject.cursorSessions) ||
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.geminiSessions) !== serialize(prevProject.geminiSessions)
    );
  });
};

const getProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

const isUpdateAdditive = (
  currentProjects: Project[],
  updatedProjects: Project[],
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): boolean => {
  if (!selectedProject || !selectedSession) {
    return true;
  }

  const currentSelectedProject = currentProjects.find((project) => project.name === selectedProject.name);
  const updatedSelectedProject = updatedProjects.find((project) => project.name === selectedProject.name);

  if (!currentSelectedProject || !updatedSelectedProject) {
    return false;
  }

  const currentSelectedSession = getProjectSessions(currentSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );
  const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
    (session) => session.id === selectedSession.id,
  );

  if (!currentSelectedSession || !updatedSelectedSession) {
    return false;
  }

  return (
    currentSelectedSession.id === updatedSelectedSession.id &&
    currentSelectedSession.title === updatedSelectedSession.title &&
    currentSelectedSession.created_at === updatedSelectedSession.created_at &&
    currentSelectedSession.updated_at === updatedSelectedSession.updated_at
  );
};

const VALID_TABS: Set<string> = new Set(['chat', 'files', 'shell', 'git', 'tasks', 'preview']);

const readPersistedTab = (): AppTab => {
  try {
    const stored = localStorage.getItem('activeTab');
    if (stored && VALID_TABS.has(stored)) {
      return stored as AppTab;
    }
  } catch {
    // localStorage unavailable
  }
  return 'chat';
};

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
}: UseProjectsStateArgs) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(readPersistedTab);

  useEffect(() => {
    try {
      localStorage.setItem('activeTab', activeTab);
    } catch {
      // Silently ignore storage errors
    }
  }, [activeTab]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('agents');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReadMarkRef = useRef<{ key: string; time: number } | null>(null);
  const lastProcessedMessageRef = useRef<AppSocketMessage | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setIsLoadingProjects(true);
      const response = await api.projects();
      const projectData = (await response.json()) as Project[];

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  const openSettings = useCallback((tab = 'tools') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  // Auto-select the project when there is only one, so the user lands on the new session page
  useEffect(() => {
    if (!isLoadingProjects && projects.length === 1 && !selectedProject && !sessionId) {
      setSelectedProject(projects[0]);
    }
  }, [isLoadingProjects, projects, selectedProject, sessionId]);

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    // Handle lightweight sessions_updated messages
    if (latestMessage.type === 'sessions_updated') {
      if (latestMessage === lastProcessedMessageRef.current) {
        return;
      }
      lastProcessedMessageRef.current = latestMessage;

      const sessionsMessage = latestMessage as SessionsUpdatedMessage;
      const { updates, watchProvider } = sessionsMessage;

      // Build batch request for updated sessions
      const requests: BatchSessionRequest[] = [];
      
      // The backend now sends project names (not hashes) for all providers
      for (const [projectName, updateInfo] of Object.entries(updates)) {
        for (const sessionId of updateInfo.sessionIds) {
          requests.push({
            projectName,
            sessionId,
            provider: updateInfo.provider as SessionProvider,
          });
        }
      }

      if (requests.length === 0) {
        return;
      }

      // Batch fetch updated sessions
      api.fetchSessionsBatch(requests).then(async (response) => {
        if (!response.ok) return;
        
        const data = await response.json() as { results: BatchSessionResponse[] };
        const updatedSessions = data.results.filter((r) => r.session !== null);
        
        if (updatedSessions.length === 0) return;

        // Check if selected session was updated
        if (selectedSession && selectedProject) {
          const updatedSelectedSession = updatedSessions.find(
            (r) => r.sessionId === selectedSession.id && r.projectName === selectedProject.name
          );
          if (updatedSelectedSession && !activeSessions.has(selectedSession.id)) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }

        // Update sessions in projects state
        setProjects((prevProjects) => {
          return prevProjects.map((project) => {
            // Project names now use Claude format consistently (e.g., -foo-bar)
            const projectUpdates = updatedSessions.filter((r) => r.projectName === project.name);
            if (projectUpdates.length === 0) return project;

            const updateSessionInArray = (
              sessions: ProjectSession[] | undefined,
              provider: SessionProvider
            ): ProjectSession[] | undefined => {
              if (!sessions) sessions = [];
              
              // Update existing sessions
              const updatedSessions = sessions.map((s) => {
                const update = projectUpdates.find(
                  (u) => u.sessionId === s.id && u.provider === provider
                );
                if (update?.session) {
                  return { ...s, ...update.session };
                }
                return s;
              });
              
              // Add sessions that were updated but not in the array (loaded via "Load More")
              const existingIds = new Set(sessions.map((s) => s.id));
              const newSessions = projectUpdates
                .filter((u) => u.provider === provider && !existingIds.has(u.sessionId) && u.session)
                .map((u) => u.session as ProjectSession);
              
              if (newSessions.length > 0) {
                return [...updatedSessions, ...newSessions];
              }
              
              return updatedSessions;
            };

            return {
              ...project,
              sessions: updateSessionInArray(project.sessions, 'claude'),
              cursorSessions: updateSessionInArray(project.cursorSessions, 'cursor'),
              codexSessions: updateSessionInArray(project.codexSessions, 'codex'),
              geminiSessions: updateSessionInArray(project.geminiSessions, 'gemini'),
            };
          });
        });
      }).catch((error) => {
        console.error('[WS] Error fetching updated sessions:', error);
      });

      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    if (latestMessage === lastProcessedMessageRef.current) {
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    const projectsMessage = latestMessage as ProjectsUpdatedMessage;

    const hasActiveSession =
      (selectedSession && activeSessions.has(selectedSession.id)) ||
      (activeSessions.size > 0 && Array.from(activeSessions).some((id) => id.startsWith('new-session-')));

    const updatedProjects = projectsMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(projects, updatedProjects, selectedProject, selectedSession)
    ) {
      return;
    }

    if (projectsMessage.changedFile && selectedSession && selectedProject) {
      const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');
        const matchesFilename = changedSessionId === selectedSession.id;

        const matchesParentDir = changedFileParts.some((part) => part === selectedSession.id);

        const matchesSession = matchesFilename || matchesParentDir;

        if (matchesSession) {
          const isSessionActive = activeSessions.has(selectedSession.id);
          console.log(
            `[WS] Session file update detected: ${normalized} → session=${selectedSession.id}, active=${isSessionActive}`,
          );

          if (!isSessionActive) {
            setExternalMessageUpdate((prev) => prev + 1);
          }
        }
      }
    }

    if (projectsMessage.changedSessionIds?.length && selectedSession && selectedProject) {
      if (projectsMessage.changedSessionIds.includes(selectedSession.id)) {
        const isSessionActive = activeSessions.has(selectedSession.id);
        console.log(
          `[WS] Cursor session blob update detected: session=${selectedSession.id}, active=${isSessionActive}`,
        );

        if (!isSessionActive) {
          setExternalMessageUpdate((prev) => prev + 1);
        }
      }
    }

    setProjects((prevProjects) => {
      if (prevProjects.length === 0) {
        return updatedProjects;
      }

      // Build map of local session read states (session-level)
      // This preserves local optimistic updates when server sends stale data
      const prevSessionStates = new Map<string, { readAt?: string | null; readBlobOffset?: number | null }>();
      for (const p of prevProjects) {
        const allSessions = [
          ...(p.sessions ?? []),
          ...(p.cursorSessions ?? []),
          ...(p.codexSessions ?? []),
          ...(p.geminiSessions ?? []),
        ];
        for (const s of allSessions) {
          const key = `${p.name}:${s.id}`;
          if (s.readAt || s.readBlobOffset !== undefined) {
            prevSessionStates.set(key, { readAt: s.readAt, readBlobOffset: s.readBlobOffset });
          }
        }
      }

      if (prevSessionStates.size === 0) {
        return updatedProjects;
      }

      // Helper to merge session read state
      const mergeSessionReadState = (
        projectName: string,
        sessions: ProjectSession[] | undefined,
      ): ProjectSession[] | undefined => {
        if (!sessions) return sessions;
        return sessions.map((s) => {
          const key = `${projectName}:${s.id}`;
          const prevState = prevSessionStates.get(key);
          if (!prevState) return s;

          let merged = s;
          // Preserve local readAt if it's newer
          if (prevState.readAt && (!s.readAt || new Date(prevState.readAt) > new Date(s.readAt))) {
            merged = { ...merged, readAt: prevState.readAt };
          }
          // Preserve local readBlobOffset if it's higher
          if (prevState.readBlobOffset !== undefined && prevState.readBlobOffset !== null) {
            if (s.readBlobOffset === undefined || s.readBlobOffset === null || prevState.readBlobOffset > s.readBlobOffset) {
              merged = { ...merged, readBlobOffset: prevState.readBlobOffset };
            }
          }
          return merged;
        });
      };

      return updatedProjects.map((project) => ({
        ...project,
        sessions: mergeSessionReadState(project.name, project.sessions),
        cursorSessions: mergeSessionReadState(project.name, project.cursorSessions),
        codexSessions: mergeSessionReadState(project.name, project.codexSessions),
        geminiSessions: mergeSessionReadState(project.name, project.geminiSessions),
      }));
    });

    if (!selectedProject) {
      return;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === selectedProject.name,
    );

    if (!updatedSelectedProject) {
      return;
    }

    if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
      setSelectedProject(updatedSelectedProject);
    }

    if (!selectedSession) {
      return;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === selectedSession.id,
    );

    if (!updatedSelectedSession) {
      setSelectedSession(null);
    }
  }, [latestMessage, selectedProject, selectedSession, activeSessions, projects]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionId || projects.length === 0) {
      return;
    }

    for (const project of projects) {
      const claudeSession = project.sessions?.find((session) => session.id === sessionId);
      if (claudeSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'claude';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...claudeSession, __provider: 'claude' });
        }
        return;
      }

      const cursorSession = project.cursorSessions?.find((session) => session.id === sessionId);
      if (cursorSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'cursor';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...cursorSession, __provider: 'cursor' });
        }
        return;
      }

      const codexSession = project.codexSessions?.find((session) => session.id === sessionId);
      if (codexSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'codex';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...codexSession, __provider: 'codex' });
        }
        return;
      }

      const geminiSession = project.geminiSessions?.find((session) => session.id === sessionId);
      if (geminiSession) {
        const shouldUpdateProject = selectedProject?.name !== project.name;
        const shouldUpdateSession =
          selectedSession?.id !== sessionId || selectedSession.__provider !== 'gemini';

        if (shouldUpdateProject) {
          setSelectedProject(project);
        }
        if (shouldUpdateSession) {
          setSelectedSession({ ...geminiSession, __provider: 'gemini' });
        }
        return;
      }
    }
  }, [sessionId, projects, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const markSessionAsRead = useCallback(
    (projectName: string, sessionId: string, provider?: SessionProvider, lastBlobOffset?: number) => {
      const key = `${projectName}:${sessionId}`;
      const now = Date.now();
      const last = lastReadMarkRef.current;
      if (last && last.key === key && now - last.time < 10_000) {
        return;
      }
      lastReadMarkRef.current = { key, time: now };

      setProjects((prev) => {
        let isCursorSession = provider === 'cursor';
        let blobOffset = lastBlobOffset ?? 0;

        const targetProject = prev.find((p) => p.name === projectName);
        if (targetProject) {
          const cursorSession = targetProject.cursorSessions?.find((s) => s.id === sessionId);
          if (cursorSession) {
            isCursorSession = true;
            blobOffset = cursorSession.lastBlobOffset ?? blobOffset;
          }
        }

        // Helper to update session in an array
        const updateSessionInArray = (sessions: ProjectSession[] | undefined): ProjectSession[] | undefined => {
          if (!sessions) return sessions;
          return sessions.map((s) => {
            if (s.id !== sessionId) return s;
            if (isCursorSession) {
              return { ...s, readBlobOffset: blobOffset };
            }
            return { ...s, readAt: new Date(now).toISOString() };
          });
        };

        if (isCursorSession) {
          void api.markSessionRead(projectName, sessionId, undefined, blobOffset);
        } else {
          void api.markSessionRead(projectName, sessionId, new Date(now).toISOString());
        }

        return prev.map((project) => {
          if (project.name !== projectName) return project;
          return {
            ...project,
            sessions: updateSessionInArray(project.sessions),
            cursorSessions: updateSessionInArray(project.cursorSessions),
            codexSessions: updateSessionInArray(project.codexSessions),
            geminiSessions: updateSessionInArray(project.geminiSessions),
          };
        });
      });
    },
    [],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      setSelectedSession(session);

      if (activeTab === 'tasks' || activeTab === 'preview') {
        setActiveTab('chat');
      }

      const provider = localStorage.getItem('selected-provider') || 'claude';
      if (provider === 'cursor') {
        sessionStorage.setItem('cursorSessionId', session.id);
      }

      const projectName = session.__projectName || selectedProject?.name;
      if (projectName) {
        markSessionAsRead(projectName, session.id, session.__provider, session.lastBlobOffset as number | undefined);
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, markSessionAsRead, navigate, selectedProject?.name],
  );

  const handleNewSession = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab('chat');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate],
  );

  const handleSessionDelete = useCallback(
    (sessionIdToDelete: string) => {
      if (selectedSession?.id === sessionIdToDelete) {
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) =>
        prevProjects.map((project) => ({
          ...project,
          sessions: project.sessions?.filter((session) => session.id !== sessionIdToDelete) ?? [],
          sessionMeta: {
            ...project.sessionMeta,
            total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
          },
        })),
      );
    },
    [navigate, selectedSession?.id],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      const response = await api.projects();
      const freshProjects = (await response.json()) as Project[];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id,
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => setShowSettings(true),
      showSettings,
      settingsInitialTab,
      onCloseSettings: () => setShowSettings(false),
      isMobile,
    }),
    [
      handleNewSession,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      isLoadingProjects,
      isMobile,
      loadingProgress,
      projects,
      settingsInitialTab,
      selectedProject,
      selectedSession,
      showSettings,
    ],
  );

  return {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    loadingProgress,
    isInputFocused,
    showSettings,
    settingsInitialTab,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    fetchProjects,
    sidebarSharedProps,
    markSessionAsRead,
    handleProjectSelect,
    handleSessionSelect,
    handleNewSession,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
  };
}
