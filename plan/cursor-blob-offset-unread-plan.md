# Plan: Cursor Blob-Offset Based Read/Unread Detection

## Objective

Replace the time-based read/unread logic for Cursor sessions with blob-offset-based logic. Also replace chokidar file watching for Cursor with a 30-second polling loop that detects blob count changes.

## Problem

Cursor sessions don't have a reliable `lastActivity` timestamp — currently it's set to `createdAt`, which never updates. This means the time-based comparison (`lastActivity > lastReadAt`) doesn't work properly for detecting new messages in Cursor sessions.

## Current State

### Server
- **`server/projects.js` ~L1552**: `getCursorSessions()` sets `lastActivity: session.createdAt` — always the creation time
- **`server/projects.js` ~L1200-1208**: `markSessionRead()` stores an ISO timestamp in `~/.cloudcli/project-config.json` under `readTimestamps[sessionId]`
- **`server/projects.js` ~L1499**: Blob count is already read (`SELECT COUNT(*) as count FROM blobs`) but only used for `messageCount`
- **`server/index.js` ~L72-78**: Chokidar watches `~/.cursor/chats/` alongside Claude/Codex/Gemini paths

### UI — Read/Unread Logic
- **`src/components/sidebar/utils/utils.ts` L73-75**: `hasUnread = sessionDate > lastReadAt` (time comparison)
- **`src/hooks/useProjectsState.ts` L414-433**: `markSessionAsRead()` sends ISO timestamp to server
- **`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx` L58-60**: Blue dot rendering based on `hasUnread`

### UI — `externalMessageUpdate` (Chat Auto-Refresh)
When a `projects_updated` WebSocket message arrives, the UI checks if the `changedFile` matches the currently selected session (`useProjectsState.ts` L238-262):
1. Splits `changedFile` path and checks if any part matches `selectedSession.id`
2. If matched AND session is not actively streaming → increments `externalMessageUpdate` counter
3. `useChatSessionState.ts` L461-511 watches this counter — when it changes, reloads messages for the current session (calls `loadCursorSessionMessages` for cursor, `loadSessionMessages` for others)

**Problem for cursor polling**: The polling loop won't have a `changedFile` path. We need an alternative way to tell the UI which session(s) changed.

### Data Flow
```
File change → chokidar → getProjects() → WebSocket broadcast (with changedFile)
  → UI merges readTimestamps → time comparison → blue dot
  → UI matches changedFile to selected session → externalMessageUpdate → reload chat messages
```

## Proposed Changes

### 1. Server: Add `lastBlobOffset` to Cursor Session Data

**File: `server/projects.js`**

In `getCursorSessions()`, include the blob count as `lastBlobOffset` in the session object:
```js
sessions.push({
  id: session.id,
  name: session.name,
  // ...
  lastBlobOffset: blobCount?.count || 0,  // NEW
  messageCount: blobCount?.count || 0,
});
```

Also in `server/routes/cursor.js` session listing, add `lastBlobOffset`.

### 2. Server: Store `readBlobOffset` Instead of Timestamp for Cursor

**File: `server/projects.js`**

Extend `markSessionRead()` to accept an optional `blobOffset` parameter:

```js
async function markSessionRead(projectName, sessionId, readAt, readBlobOffset) {
  const config = await loadProjectConfig();
  config[projectName] = config[projectName] || {};

  if (readBlobOffset !== undefined) {
    config[projectName].readBlobOffsets = config[projectName].readBlobOffsets || {};
    config[projectName].readBlobOffsets[sessionId] = readBlobOffset;
  } else {
    config[projectName].readTimestamps = config[projectName].readTimestamps || {};
    config[projectName].readTimestamps[sessionId] = readAt || new Date().toISOString();
  }

  await saveProjectConfig(config);
}
```

**File: `server/index.js`**

Update `PUT /api/projects/:projectName/sessions/:sessionId/read` to accept optional `readBlobOffset`:
```js
// Request body: { readAt?: string, readBlobOffset?: number }
const readAt = await markSessionRead(
  req.params.projectName, req.params.sessionId,
  req.body?.readAt, req.body?.readBlobOffset
);
```

Include `readBlobOffsets` in project data sent to UI (in `getCursorProjects` / project builders).

### 3. Server: Replace Chokidar for Cursor with Polling Loop

**File: `server/index.js`**

- Remove `cursor` from `PROVIDER_WATCH_PATHS` (keep Claude, Codex, Gemini watchers)
- Add a new `setupCursorPollingLoop()` function:

```js
let cursorBlobCache = new Map(); // sessionId -> lastBlobOffset

async function setupCursorPollingLoop() {
  setInterval(async () => {
    if (isGetProjectsRunning || connectedClients.size === 0) return;

    try {
      isGetProjectsRunning = true;
      clearProjectDirectoryCache();

      const updatedProjects = await getProjects();

      // Detect which cursor sessions had blob count changes
      const changedSessionIds = [];
      for (const project of updatedProjects) {
        for (const session of (project.cursorSessions || [])) {
          const cached = cursorBlobCache.get(session.id);
          if (cached !== undefined && cached !== session.lastBlobOffset) {
            changedSessionIds.push(session.id);
          }
          cursorBlobCache.set(session.id, session.lastBlobOffset);
        }
      }

      if (changedSessionIds.length === 0) return;

      // Broadcast FULL project list (same format as chokidar),
      // with changedSessionIds instead of changedFile
      const updateMessage = JSON.stringify({
        type: 'projects_updated',
        projects: updatedProjects,
        timestamp: new Date().toISOString(),
        changeType: 'change',
        changedSessionIds,        // NEW — array of session IDs that changed
        watchProvider: 'cursor'
      });

      connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(updateMessage);
        }
      });
    } catch (error) {
      console.error('[ERROR] Cursor polling error:', error);
    } finally {
      isGetProjectsRunning = false;
    }
  }, 30_000);
}
```

**Key design decisions:**
- **Full project list**: `getProjects()` returns ALL providers. The broadcast sends the full list, same as chokidar. UI replaces its entire `projects` state. No filtering needed, no UI breakage.
- **`changedSessionIds` instead of `changedFile`**: Since polling doesn't have a file path, we pass the actual session IDs that changed. The UI can use this directly.
- **Skip if no clients**: Don't poll if nobody is connected.
- **Fixed 30s interval**: Not configurable for now.

### 4. WAL File Handling for Accurate Blob Counts

SQLite WAL (Write-Ahead Log) mode means Cursor writes new data to `store.db-wal` before checkpointing it back to `store.db`. When reading with `OPEN_READONLY`:

- SQLite **can read WAL data** transparently — `SELECT COUNT(*) FROM blobs` includes uncommitted-to-main-db rows
- The `-shm` file provides a shared-memory index for efficient WAL lookups
- This is by design: WAL mode supports concurrent readers + single writer

**No special handling needed** — the current `sqlite3.OPEN_READONLY` approach already reads through the WAL correctly.

### 5. UI: Update `externalMessageUpdate` Trigger for Cursor

**File: `src/hooks/useProjectsState.ts`**

The current `changedFile` matching logic (L238-262) only works for file-path-based providers. For cursor polling, we need to also check `changedSessionIds`:

```ts
// Existing changedFile logic (for claude/codex/gemini via chokidar)
if (projectsMessage.changedFile && selectedSession && selectedProject) {
  // ... existing path-part matching ...
}

// NEW: changedSessionIds logic (for cursor via polling loop)
if (projectsMessage.changedSessionIds?.length && selectedSession && selectedProject) {
  const matchesSession = projectsMessage.changedSessionIds.includes(selectedSession.id);
  if (matchesSession) {
    const isSessionActive = activeSessions.has(selectedSession.id);
    console.log(
      `[WS] Cursor session blob update detected: session=${selectedSession.id}, active=${isSessionActive}`,
    );
    if (!isSessionActive) {
      setExternalMessageUpdate((prev) => prev + 1);
    }
  }
}
```

This ensures that when the cursor polling detects new blobs for the currently viewed session, the chat reloads messages automatically (via `reloadExternalMessages` in `useChatSessionState.ts`).

**File: `src/types/app.ts`**

Update `ProjectsUpdatedMessage` to include the new field:
```ts
export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  changedSessionIds?: string[];  // NEW
  [key: string]: unknown;
}
```

### 6. UI: Update Unread Logic for Cursor Sessions

**File: `src/types/app.ts`**

Add to `ProjectSession` interface:
```ts
lastBlobOffset?: number;
```

Add to `Project` type:
```ts
readBlobOffsets?: Record<string, number>;
```

**File: `src/components/sidebar/utils/utils.ts`**

Update `createSessionViewModel()` to accept and use `readBlobOffsets`:
```ts
export const createSessionViewModel = (
  session: SessionWithProvider,
  currentTime: Date,
  t: TFunction,
  readTimestamps?: Record<string, string>,
  readBlobOffsets?: Record<string, number>,  // NEW parameter
): SessionViewModel => {
  const sessionDate = getSessionDate(session);
  const lastReadAt = readTimestamps?.[session.id];

  const hasUnread = (() => {
    if (session.__provider === 'cursor') {
      const lastBlob = session.lastBlobOffset ?? 0;
      const readBlob = readBlobOffsets?.[session.id] ?? 0;
      return lastBlob > readBlob;
    }
    // Existing time-based logic for claude/codex/gemini
    return lastReadAt
      ? sessionDate.getTime() > new Date(lastReadAt).getTime()
      : Number(session.messageCount || 0) > 0;
  })();

  return { /* ... */ hasUnread, /* ... */ };
};
```

- 0 blobs and no readBlobOffset → `0 > 0` → **read** (no false positives)

### 7. UI: Update `markSessionAsRead` for Cursor

**File: `src/hooks/useProjectsState.ts`**

Update `markSessionAsRead()` to send blob offset for cursor sessions:
```ts
const markSessionAsRead = useCallback(
  (projectName: string, sessionId: string) => {
    const key = `${projectName}:${sessionId}`;
    const now = Date.now();
    const last = lastReadMarkRef.current;
    if (last && last.key === key && now - last.time < 10_000) return;
    lastReadMarkRef.current = { key, time: now };

    // Find the session to check provider and get lastBlobOffset
    const project = projects.find(p => p.name === projectName);
    const session = getProjectSessions(project).find(s => s.id === sessionId);

    if (session?.__provider === 'cursor') {
      const blobOffset = session.lastBlobOffset ?? 0;
      setProjects((prev) =>
        prev.map((p) =>
          p.name === projectName
            ? { ...p, readBlobOffsets: { ...p.readBlobOffsets, [sessionId]: blobOffset } }
            : p,
        ),
      );
      void api.markSessionRead(projectName, sessionId, undefined, blobOffset);
    } else {
      setProjects((prev) =>
        prev.map((p) =>
          p.name === projectName
            ? { ...p, readTimestamps: { ...p.readTimestamps, [sessionId]: new Date(now).toISOString() } }
            : p,
        ),
      );
      void api.markSessionRead(projectName, sessionId, new Date(now).toISOString());
    }
  },
  [projects],
);
```

**File: `src/utils/api.js`**

Update `markSessionRead` to accept `readBlobOffset`:
```js
markSessionRead: (projectName, sessionId, readAt, readBlobOffset) =>
  authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/read`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readAt, readBlobOffset }),
  }),
```

### 8. UI: Merge `readBlobOffsets` on WebSocket Updates

**File: `src/hooks/useProjectsState.ts`**

In the `setProjects` callback within the `projects_updated` handler (L264-293), add merging for `readBlobOffsets` alongside the existing `readTimestamps` merge:

```ts
setProjects((prevProjects) => {
  if (prevProjects.length === 0) return updatedProjects;

  const prevTimestampsMap = new Map<string, Record<string, string>>();
  const prevBlobOffsetsMap = new Map<string, Record<string, number>>();  // NEW

  for (const p of prevProjects) {
    if (p.readTimestamps && Object.keys(p.readTimestamps).length > 0) {
      prevTimestampsMap.set(p.name, p.readTimestamps);
    }
    if (p.readBlobOffsets && Object.keys(p.readBlobOffsets).length > 0) {
      prevBlobOffsetsMap.set(p.name, p.readBlobOffsets);  // NEW
    }
  }

  return updatedProjects.map((project) => {
    // Existing readTimestamps merge
    const localTimestamps = prevTimestampsMap.get(project.name);
    let result = project;
    if (localTimestamps) {
      const merged = { ...project.readTimestamps };
      for (const [sid, ts] of Object.entries(localTimestamps)) {
        if (!merged[sid] || new Date(ts) > new Date(merged[sid])) {
          merged[sid] = ts;
        }
      }
      result = { ...result, readTimestamps: merged };
    }

    // NEW: readBlobOffsets merge (keep the higher value)
    const localBlobOffsets = prevBlobOffsetsMap.get(project.name);
    if (localBlobOffsets) {
      const merged = { ...project.readBlobOffsets };
      for (const [sid, offset] of Object.entries(localBlobOffsets)) {
        if (merged[sid] === undefined || offset > merged[sid]) {
          merged[sid] = offset;
        }
      }
      result = { ...result, readBlobOffsets: merged };
    }

    return result;
  });
});
```

### 9. UI: Pass `readBlobOffsets` Through Component Chain

Update the prop chain that passes `readTimestamps` to also pass `readBlobOffsets`:

- **`SidebarProjectItem`**: Pass `project.readBlobOffsets || {}`
- **`SidebarProjectSessions`**: Forward `readBlobOffsets` prop
- **`SidebarSessionItem`**: Pass to `createSessionViewModel(..., readBlobOffsets)`

## Tasks

- [ ] 1. Add `lastBlobOffset` field to cursor session data in `server/projects.js` and `server/routes/cursor.js`
- [ ] 2. Extend `markSessionRead()` and `PUT /read` endpoint to accept `readBlobOffset` in `server/projects.js` and `server/index.js`
- [ ] 3. Include `readBlobOffsets` in project data sent to UI (in `getCursorProjects`)
- [ ] 4. Remove `cursor` from chokidar `PROVIDER_WATCH_PATHS` in `server/index.js`
- [ ] 5. Add `setupCursorPollingLoop()` in `server/index.js` — 30s interval, blob count cache, `changedSessionIds` in broadcast
- [ ] 6. Update `ProjectSession`, `Project`, `ProjectsUpdatedMessage` types in `src/types/app.ts`
- [ ] 7. Update `createSessionViewModel()` in `src/components/sidebar/utils/utils.ts` for blob-offset comparison
- [ ] 8. Pass `readBlobOffsets` through sidebar component chain (`SidebarProjectItem` → `SidebarProjectSessions` → `SidebarSessionItem`)
- [ ] 9. Update `markSessionAsRead()` in `src/hooks/useProjectsState.ts` to send `readBlobOffset` for cursor
- [ ] 10. Update `api.markSessionRead()` in `src/utils/api.js` to pass `readBlobOffset`
- [ ] 11. Add `readBlobOffsets` merge logic alongside `readTimestamps` merge in `useProjectsState.ts`
- [ ] 12. Add `changedSessionIds` handling for `externalMessageUpdate` in `useProjectsState.ts`
- [ ] 13. Verify WAL read-through works correctly with `OPEN_READONLY`

## Architecture Diagram (After Change)

```
Claude/Codex/Gemini sessions (unchanged):
  .jsonl file change → chokidar → getProjects() → WebSocket (changedFile) → UI
    → time comparison for unread dot
    → changedFile match → externalMessageUpdate → reload chat

Cursor sessions (new):
  30s poll → getProjects() → compare blob cache → if any changed:
    → WebSocket (changedSessionIds) → UI
    → blobOffset comparison for unread dot
    → changedSessionIds match → externalMessageUpdate → reload chat

Mark read:
  Claude/others: UI sends readAt timestamp → stored in readTimestamps
  Cursor:        UI sends readBlobOffset    → stored in readBlobOffsets
```

## Risk Assessment

- **Low risk**: WAL read-through is a well-documented SQLite feature; `OPEN_READONLY` should work
- **Medium risk**: 30s polling interval means up to 30s delay before unread indicator appears (acceptable trade-off vs chokidar stability on .db files)
- **Low risk**: Backward compatibility — existing `readTimestamps` for Claude/Codex/Gemini are unchanged
- **Migration**: Existing cursor `readTimestamps` will be ignored; all cursor sessions may briefly show as unread after deploy (one-time reset, since `0 > 0` = read, this only affects sessions that had messages)
