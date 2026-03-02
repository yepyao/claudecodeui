# Plan: Unread Messages Indicator for Sessions

## Objective
Replace the current "active within 10 minutes" green pulsing dot with a proper **unread messages indicator**, similar to chat apps. A session should show an unread dot when there are new messages after the user last viewed the session.

## Current State
- `isActive` in `createSessionViewModel()` is `true` when `lastActivity < 10 minutes ago` — purely time-based
- No concept of "last read" time exists anywhere in the codebase
- The green pulsing dot (`animate-pulse`) is shown in `SidebarSessionItem.tsx` based on `sessionView.isActive`

## Proposed Changes

### 1. Server: Store `lastReadAt` per session in project config (`~/.cloudcli/project-config.json`)

**File: `server/projects.js`**
- Add a new function `markSessionRead(projectName, sessionId)` that stores `lastReadAt` timestamp in the project config under `readTimestamps` (keyed by `sessionId`)
- Add a new function `getReadTimestamps(projectName)` to retrieve all read timestamps for a project
- Include `readTimestamps` in the project data returned by `getClaudeProjects()`, `getManualProjects()`, and `getCursorProjects()`
- Export the new functions

Config structure:
```json
{
  "projectName": {
    "starred": true,
    "starredSessions": ["id1"],
    "readTimestamps": {
      "session-id-1": "2026-03-01T10:00:00.000Z",
      "session-id-2": "2026-02-28T15:30:00.000Z"
    }
  }
}
```

### 2. Server: Add API endpoint to mark session as read

**File: `server/index.js`**
- Add `PUT /api/projects/:projectName/sessions/:sessionId/read` endpoint that calls `markSessionRead()` and returns success
- Export `markSessionRead` from `projects.js`

### 3. Client: Add `readTimestamps` to the `Project` type

**File: `src/types/app.ts`**
- Add `readTimestamps?: Record<string, string>` to the `Project` interface

### 4. Client: Add API method to mark a session as read

**File: `src/utils/api.js`**
- Add `markSessionRead(projectName, sessionId)` method that calls the new endpoint

### 5. Client: Replace `isActive` with `hasUnread` logic

**File: `src/components/sidebar/utils/utils.ts`**
- In `createSessionViewModel()`, replace the `isActive: diffInMinutes < 10` logic with:
  - Accept `readTimestamps` (from project data) as a parameter
  - Compare session's `lastActivity` against `readTimestamps[session.id]`
  - `hasUnread = true` if `lastActivity > lastReadAt` (or if no `lastReadAt` exists and session has messages)

**File: `src/components/sidebar/types/types.ts`**
- Rename `isActive` to `hasUnread` in `SessionViewModel`

### 6. Client: Mark session as read on select + auto-read when scrolled to bottom

**File: `src/components/sidebar/hooks/useSidebarController.ts`**
- In `handleSessionClick()`, call `api.markSessionRead(projectName, session.id)` (fire-and-forget)
- Also update a local `readTimestamps` state so the UI updates immediately without waiting for server round-trip

**File: `src/hooks/useProjectsState.ts`** (or wherever `projects_updated` is processed)
- When a `projects_updated` WebSocket message arrives and the changed session is the **currently selected session**:
  - Check if the user is scrolled to the bottom (using the existing `isNearBottom()` / `isUserScrolledUp` state from `useChatSessionState`)
  - **If scrolled to bottom** → auto-mark as read (user can see the new message)
  - **If scrolled up** → do NOT mark as read → unread dot appears in sidebar, signaling new content below
- When user scrolls back to bottom → mark as read → unread dot disappears
- The existing `isUserScrolledUp` state in `useChatSessionState.ts` already tracks this; we just need to plumb it through

### 7. Client: Update `SidebarSessionItem.tsx` to use `hasUnread`

**File: `src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`**
- Replace `sessionView.isActive` references with `sessionView.hasUnread`
- Show unread dot when `hasUnread && !(isSelected && userIsAtBottom)` — i.e., hide it only when the user is on the session AND scrolled to the bottom
- Change the pulsing dot style: solid dot (no pulse animation) to match chat app convention — or keep pulse, up to preference

### 8. Callers of `createSessionViewModel`

All callers need to pass the new `readTimestamps` parameter:
- `SidebarSessionItem.tsx` (receives it via props from project data)
- Any other caller of `createSessionViewModel`

## Tasks
- [x] 1. Add `markSessionRead` to `server/projects.js` + include `readTimestamps` in all project builders
- [x] 2. Add `PUT .../read` API endpoint to `server/index.js`
- [x] 3. Add `readTimestamps` to `Project` type in `src/types/app.ts`
- [x] 4. Add `markSessionRead` to `src/utils/api.js`
- [x] 5. Rename `isActive` → `hasUnread` in `SessionViewModel` type and update `createSessionViewModel` logic
- [x] 6. Add `markSessionAsRead` to `useProjectsState` + call on session select
- [x] 6b. Wire to chat: mark as read when user scrolls to bottom (via `handleScroll` in `useChatSessionState`)
- [x] 7. Update `SidebarSessionItem.tsx` — `showUnread = hasUnread && !isSelected`
- [x] 8. Thread `readTimestamps` through sidebar: ProjectItem reads from `project.readTimestamps` → ProjectSessions → SessionItem

## Data Flow Summary

```
User clicks session → handleSessionClick()
  → api.markSessionRead(projectName, sessionId)  [fire-and-forget to server]
  → update local readTimestamps state             [instant UI update]
  → unread dot disappears

Agent replies while user is on the session AND scrolled to bottom:
  → projects_updated WebSocket fires with new lastActivity
  → session is selected + user is at bottom → auto-mark as read
  → unread dot does NOT appear (user can see the message)

Agent replies while user is on the session BUT scrolled up:
  → projects_updated WebSocket fires with new lastActivity
  → session is selected but user is scrolled up → do NOT mark as read
  → lastActivity > lastReadAt → unread dot APPEARS in sidebar
  → user scrolls down to bottom → mark as read → dot disappears

Agent replies while user is on a DIFFERENT session/page:
  → projects_updated WebSocket fires with new lastActivity
  → session is NOT selected → no auto-read
  → lastActivity > lastReadAt → unread dot APPEARS

User navigates back to the session → handleSessionClick()
  → markSessionRead → dot disappears
```

## Risk Assessment
- **Low risk**: The `readTimestamps` field is additive to the existing config — no existing data is modified
- **Backward compatible**: If `readTimestamps` is missing, all sessions with messages will appear as unread (reasonable first-time behavior)
- **No performance concern**: Read timestamps are small and loaded with project data already in memory
