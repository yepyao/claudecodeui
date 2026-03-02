# Plan: Fix Excessive API Calls on Session Load

## Objective
Stop redundant API calls to `/api/taskmaster/tasks/...`, `/api/commands/list`, and `/api/cursor/sessions/...` that fire repeatedly when selecting a session.

## Root Cause
Three `useEffect` hooks depend on **object references** (`selectedProject`, `currentProject`) instead of stable primitive identifiers. Any state update that creates a new object reference causes all three to re-fire, even when the relevant data hasn't changed.

### Cascade:
1. `markSessionAsRead` → `setSelectedProject({...prev, readTimestamps: ...})` → new reference
2. `selectedProject` reference changes →
   - `useSlashCommands` effect refires → `/api/commands/list`
   - `loadMessages` effect refires → `/api/cursor/sessions/...` or Claude messages
   - `MainContent` → `setCurrentProject(selectedProject)` → `currentProject` reference changes → `refreshTasks` callback recreated → effect refires → `/api/taskmaster/tasks/...`

## Proposed Changes

### 1. `markSessionAsRead` — Stop updating `selectedProject`
**File: `src/hooks/useProjectsState.ts`**
- Remove `setSelectedProject` call from `markSessionAsRead` — only update `projects` array (sidebar reads from there)

### 2. `useSlashCommands` — Stabilize dependency
**File: `src/components/chat/hooks/useSlashCommands.ts`**
- Change `useEffect` dependency from `[selectedProject]` to `[selectedProject?.name, selectedProject?.path]` (the only fields it uses)

### 3. `loadMessages` effect — Stabilize dependency
**File: `src/components/chat/hooks/useChatSessionState.ts`**
- Change dependency from `selectedProject` to `selectedProject?.name` (and extract needed fields via ref)
- The effect only uses `selectedProject.name`, `.fullPath`, `.path`

### 4. TaskMaster `refreshTasks` — Stabilize dependency
**File: `src/contexts/TaskMasterContext.jsx`**
- Change `refreshTasks` `useCallback` dependency from `[currentProject, ...]` to `[currentProject?.name, ...]`
- This prevents the callback identity from changing when the object reference changes but the name stays the same

## Tasks
- [ ] 1. Remove `setSelectedProject` from `markSessionAsRead`
- [ ] 2. Stabilize `useSlashCommands` effect dependency
- [ ] 3. Stabilize `loadMessages` effect dependency
- [ ] 4. Stabilize `refreshTasks` callback dependency
