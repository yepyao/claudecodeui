# Plan: Lightweight WebSocket Updates for Session Changes

## Objective
1. Fix the bug where `setupCursorPollingLoop` only checks sessions from `getProjects()` (initial 5 per project), missing sessions loaded via "Load More"
2. Optimize WebSocket payload by sending only change indicators instead of full project data
3. **Unify both watchers** (file watcher for Claude/Codex/Gemini AND polling for Cursor) to use the same lightweight format

## Current State

### The Bug
1. `setupCursorPollingLoop()` in `server/index.js` calls `getProjects()` every 30 seconds
2. `getProjects()` only returns the first 5 sessions per project (initial page)
3. Sessions loaded via "Load More" are stored in frontend state (`additionalCursorSessions`) but **not tracked by polling**
4. When a session loaded via "Load More" gets updated, the UI never knows

### Current WebSocket Payload (Heavy)
```js
{
  type: 'projects_updated',
  projects: [/* FULL project objects with ALL session data */],
  timestamp: '...',
  changeType: 'change',
  changedSessionIds: ['session-id-1'],
  watchProvider: 'cursor'
}
```

This sends the entire project list even when only one session changed.

## Proposed Solution

### Phase 1: Unified Lightweight WebSocket Notification

**New WebSocket message format (for ALL providers):**
```js
{
  type: 'sessions_updated',
  updates: {
    'project-name-1': {
      sessionIds: ['session-id-a', 'session-id-b'],
      provider: 'cursor'  // or 'claude', 'codex', 'gemini'
    },
    'project-name-2': {
      sessionIds: ['session-id-c'],
      provider: 'claude'
    }
  },
  timestamp: '...'
}
```

This only sends which sessions in which projects have updates - no full data. Works for all providers.

### Phase 2: Batch Session Fetch Endpoint

**New HTTP endpoint:** `POST /api/sessions/batch`

Request body:
```js
{
  requests: [
    { projectName: 'project-1', sessionId: 'session-a', provider: 'cursor' },
    { projectName: 'project-1', sessionId: 'session-b', provider: 'cursor' },
    { projectName: 'project-2', sessionId: 'session-c', provider: 'claude' }
  ]
}
```

Response (session objects now include starred/read status):
```js
{
  sessions: [
    {
      projectName: 'project-1',
      sessionId: 'session-a',
      provider: 'cursor',
      session: {
        id: 'session-a',
        title: 'Fix login bug',
        lastBlobOffset: 123,
        updated_at: '2024-01-15T10:30:00Z',
        starred: true,           // From session config
        readBlobOffset: 100      // From session config
      }
    },
    {
      projectName: 'project-1', 
      sessionId: 'session-b',
      provider: 'cursor',
      session: {
        id: 'session-b',
        title: 'Add dark mode',
        lastBlobOffset: 456,
        starred: false,
        readBlobOffset: 456      // Already read (matches lastBlobOffset)
      }
    },
    {
      projectName: 'project-2',
      sessionId: 'session-c',
      provider: 'claude',
      session: null,  // null if session not found (deleted)
      error: 'Session not found'
    }
  ]
}
```

### Phase 3: Unified Frontend Handler

Frontend receives `sessions_updated`:
1. Compare `updates` map with current state (all session arrays + additional sessions)
2. Build list of sessions that exist in current state
3. Batch fetch all updated sessions via single HTTP call
4. Update local state with new session data
5. Mark sessions as unread if `lastBlobOffset` or `updated_at` changed

## Tasks

### Phase 0: Session Config Refactoring (Pre-requisite)

#### Backend: New Session Config Structure
- [ ] Create session config directory structure:
  ```
  ~/.cloudcli/
    sessions/
      {project-name}/
        {session-id}.json      # Per-session config (starred, readAt, readBlobOffset)
    project-config.json        # Project-level config (displayName, starred, manuallyAdded)
  ```
- [ ] Session config file format (`{session-id}.json`):
  ```json
  {
    "starred": true,
    "readAt": "2024-01-15T10:30:00Z",      // For Claude/Codex/Gemini
    "readBlobOffset": 12345,                // For Cursor
    "customName": "My custom session name"  // Optional user override
  }
  ```
- [ ] Create `server/session-config.js` with functions:
  - `getSessionConfig(projectName, sessionId)` - read config, return defaults if not exists
  - `updateSessionConfig(projectName, sessionId, updates)` - merge updates into config
  - `deleteSessionConfig(projectName, sessionId)` - remove config file
- [ ] Migrate existing data:
  - Read `starredSessions` from old project config → create session configs
  - Read `readTimestamps` / `readBlobOffsets` → populate session configs
  - Keep old format readable for backward compatibility during transition

#### Backend: Update Session Objects
- [ ] Modify `getClaudeSessions()`, `getCursorSessions()`, `getCodexSessions()`, `getGeminiSessions()` to:
  - Load session config for each session
  - Include `starred`, `readAt`, `readBlobOffset` directly in session object
- [ ] Update `toggleStarSession()` to use new session config
- [ ] Update `markSessionRead()` to use new session config
- [ ] Remove `readTimestamps`, `readBlobOffsets`, `starredSessions` from project-level response

#### Frontend: Update Types and State
- [ ] Update `ProjectSession` type to include:
  ```typescript
  interface ProjectSession {
    id: string;
    title: string;
    // ... existing fields
    starred?: boolean;
    readAt?: string;
    readBlobOffset?: number;
  }
  ```
- [ ] Remove `readTimestamps` and `readBlobOffsets` from `Project` type
- [ ] Update `useProjectsState.ts`:
  - Remove project-level read tracking logic
  - Update `markSessionAsRead()` to update session object directly
- [ ] Update sidebar components to read `session.starred`, `session.readAt` instead of project-level maps

### Phase 1: Lightweight WebSocket Notification

#### Backend Changes
- [ ] Create helper function to get single session by ID for each provider
- [ ] Add batch endpoint `POST /api/sessions/batch`
- [ ] Modify `setupCursorPollingLoop()` to:
  - Track ALL Cursor sessions (scan all project folders, not just getProjects)
  - Send lightweight `sessions_updated` message
- [ ] Modify `setupProjectsWatcher()` to:
  - Send lightweight `sessions_updated` message instead of full projects
  - Extract session ID from changed file path
- [ ] Remove full `projects_updated` message (or keep as fallback for initial load)

### Phase 2: Frontend Handler

#### Frontend Changes
- [ ] Add handler for new `sessions_updated` message type in `useProjectsState.ts`
- [ ] Create `api.fetchSessionsBatch()` function
- [ ] Implement unified logic to:
  - Compare updates with local state
  - Batch fetch changed sessions
  - Update both main sessions and additionalSessions states
- [ ] Remove old `projects_updated` handler (or keep for backward compatibility during rollout)

## Architecture Diagram

```
Current Flow (BOTH watchers):
  Server → getProjects() → Full projects_updated → Frontend replaces all projects

New Flow (UNIFIED):
  File Watcher (Claude/Codex/Gemini)  ─┐
                                       ├→ sessions_updated (IDs only) → Frontend
  Cursor Polling ─────────────────────┘                                    │
                                                                           ▼
                                                     Compare with local state (all sessions)
                                                                           │
                                                                           ▼
                                                     POST /api/sessions/batch (changed only)
                                                                           │
                                                                           ▼
                                                     Update specific sessions in state
```

## Implementation Details

### Backend: Session Config Module (`server/session-config.js`)

```javascript
const SESSION_CONFIG_ROOT = path.join(os.homedir(), '.cloudcli', 'sessions');

// Get session config, returns defaults if file doesn't exist
async function getSessionConfig(projectName, sessionId) {
  const configPath = path.join(SESSION_CONFIG_ROOT, projectName, `${sessionId}.json`);
  try {
    const content = await fs.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { starred: false, readAt: null, readBlobOffset: null };
    }
    throw err;
  }
}

// Update session config (merge with existing)
async function updateSessionConfig(projectName, sessionId, updates) {
  const configDir = path.join(SESSION_CONFIG_ROOT, projectName);
  await fs.mkdir(configDir, { recursive: true });
  
  const existing = await getSessionConfig(projectName, sessionId);
  const merged = { ...existing, ...updates };
  
  const configPath = path.join(configDir, `${sessionId}.json`);
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));
  return merged;
}

// Delete session config
async function deleteSessionConfig(projectName, sessionId) {
  const configPath = path.join(SESSION_CONFIG_ROOT, projectName, `${sessionId}.json`);
  try {
    await fs.unlink(configPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Batch get configs for multiple sessions (efficient for getProjects)
async function getSessionConfigs(projectName, sessionIds) {
  const configs = {};
  await Promise.all(sessionIds.map(async (sessionId) => {
    configs[sessionId] = await getSessionConfig(projectName, sessionId);
  }));
  return configs;
}
```

### Backend: Getting Session by ID

Need to add functions to fetch a single session (with config merged):
- `getClaudeSessionById(projectName, sessionId)` - parse JSONL file header + merge config
- `getCursorSessionById(projectPath, sessionId)` - query SQLite + merge config
- `getCodexSessionById(projectName, sessionId)` - parse JSONL file header + merge config
- `getGeminiSessionById(projectName, sessionId)` - parse session file + merge config

Each function should:
1. Get the raw session data from provider storage
2. Load session config via `getSessionConfig()`
3. Merge and return: `{ ...rawSession, ...config }`

### Backend: Cursor Polling Changes

Instead of calling `getProjects()`, the polling loop should:
1. Scan `~/.cursor/projects/` for all project folders
2. For each project, query SQLite for session IDs and their `lastBlobOffset`
3. Compare with cache, collect changed session IDs
4. Send lightweight notification

### Backend: Migration Script

On first run (or via explicit migration command):
```javascript
async function migrateToSessionConfigs() {
  const oldConfigPath = path.join(os.homedir(), '.cloudcli', 'project-config.json');
  
  let oldConfig;
  try {
    oldConfig = JSON.parse(await fs.readFile(oldConfigPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No existing config to migrate');
      return;
    }
    throw err;
  }
  
  for (const [projectName, projectConfig] of Object.entries(oldConfig)) {
    // Migrate starred sessions
    for (const sessionId of (projectConfig.starredSessions || [])) {
      await updateSessionConfig(projectName, sessionId, { starred: true });
    }
    
    // Migrate read timestamps (Claude/Codex/Gemini)
    for (const [sessionId, readAt] of Object.entries(projectConfig.readTimestamps || {})) {
      await updateSessionConfig(projectName, sessionId, { readAt });
    }
    
    // Migrate read blob offsets (Cursor)
    for (const [sessionId, offset] of Object.entries(projectConfig.readBlobOffsets || {})) {
      await updateSessionConfig(projectName, sessionId, { readBlobOffset: offset });
    }
    
    // Clean up old fields from project config
    delete projectConfig.starredSessions;
    delete projectConfig.readTimestamps;
    delete projectConfig.readBlobOffsets;
  }
  
  // Save cleaned project config
  await fs.writeFile(oldConfigPath, JSON.stringify(oldConfig, null, 2));
  console.log('Migration complete');
}
```

### Frontend: State Update Logic

```typescript
// Pseudo-code for handling sessions_updated
function handleSessionsUpdated(updates: Record<string, { sessionIds: string[], provider: string }>) {
  const sessionsToFetch: FetchRequest[] = [];
  
  for (const [projectName, { sessionIds, provider }] of Object.entries(updates)) {
    for (const sessionId of sessionIds) {
      // Check if we have this session in our state
      const inMainSessions = findInMainSessions(projectName, sessionId, provider);
      const inAdditionalSessions = findInAdditionalSessions(projectName, sessionId, provider);
      
      if (inMainSessions || inAdditionalSessions) {
        sessionsToFetch.push({ projectName, sessionId, provider });
      }
    }
  }
  
  if (sessionsToFetch.length > 0) {
    const results = await api.fetchSessionsBatch(sessionsToFetch);
    updateLocalState(results);
  }
}
```

### Frontend: Unread Detection (Simplified)

With session-level read tracking, unread detection becomes simpler:

```typescript
// For Cursor sessions
const isUnread = session.lastBlobOffset > (session.readBlobOffset ?? 0);

// For Claude/Codex/Gemini sessions  
const isUnread = !session.readAt || new Date(session.updated_at) > new Date(session.readAt);
```

No more looking up project-level maps!

## Risk Assessment

- **Low Risk**: Batch endpoint is additive, doesn't break existing functionality
- **Medium Risk**: Need to handle deleted sessions (return null, frontend removes from state)
- **Medium Risk**: Race condition between notification and fetch - mitigated by graceful 404 handling
- **Medium Risk**: Session config migration - need to handle partial migration gracefully
- **Mitigation**: Read from both old and new locations during transition period
- **Rollout**: Can keep old `projects_updated` as fallback during transition

## Migration Strategy

### Phase 0: Session Config Refactoring
1. Add new `session-config.js` module
2. Backend reads from BOTH old project-level config AND new session-level config (prefer new)
3. Backend writes to new session-level config only
4. Run migration script to copy existing data to new format
5. Frontend updated to use session-level fields
6. After verification, remove old config reading code

### Phase 1-2: Lightweight WebSocket
1. Add batch endpoint and new `sessions_updated` message type
2. Frontend adds handler for new message, keeps old handler
3. Switch backend to send new format
4. Remove old handler from frontend after verification

## File Structure After Migration

**Current structure** (`~/.cloudcli/project-config.json`):
```json
{
  "-localhome-user-myproject": {
    "displayName": "My Project",
    "starred": true,
    "starredSessions": ["session-1", "session-2"],
    "readTimestamps": { "session-1": "2024-01-15T10:30:00Z" },
    "readBlobOffsets": { "cursor-session-1": 12345 }
  }
}
```

**New structure** (`~/.cloudcli/`):
```
~/.cloudcli/
├── project-config.json               # Project-level only (displayName, starred, manuallyAdded)
└── sessions/
    ├── -localhome-user-myproject/
    │   ├── session-1.json            # { starred: true, readAt: "..." }
    │   ├── session-2.json
    │   └── cursor-session-1.json     # { starred: false, readBlobOffset: 12345 }
    └── -localhome-user-another/
        └── ...
```

**New project-config.json** (session fields removed):
```json
{
  "-localhome-user-myproject": {
    "displayName": "My Project",
    "starred": true
  }
}
```

**Session config file** (`sessions/{projectName}/{sessionId}.json`):
```json
{
  "starred": true,
  "readAt": "2024-01-15T10:30:00Z",
  "readBlobOffset": null
}
```
