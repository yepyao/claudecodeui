# Star Logic Investigation

## 1. Current Implementation Overview

### Data Model

In `src/types/app.ts`, the `Project` type holds:
- `starred?: boolean` — whether the project itself is starred
- `starredSessions?: string[]` — array of starred session IDs (cross-provider)

Starred state is persisted server-side in `~/.cloudcli/project-config.json` via `server/projects.js`:
- `config[projectName].starred` — boolean
- `config[projectName].starredSessions` — string array

### Server Functions (`server/projects.js`)

**`toggleStarProject(projectName)`** (line 1190):
Toggles `config[projectName].starred` boolean, saves config, returns new value.

**`toggleStarSession(projectName, sessionId)`** (line 1211):
Toggles session ID in/out of `config[projectName].starredSessions` Set, saves config, returns whether the session is now starred.

**`getClaudeSessions(projectName, limit, offset, starredSessionIds)`** (line 723):
1. Collects all visible sessions sorted by `lastActivity` descending
2. Splits into `starredSessions` (matching `starredSessionIds`) and `nonStarredSessions`
3. Paginates **only non-starred** sessions: `nonStarredSessions.slice(offset, offset + limit)`
4. Sets `total = nonStarredSessions.length`
5. Returns: `sessions: [...starredSessions, ...paginatedNonStarred]`, `hasMore`, `total`

**`getCursorSessions(projectPath, limit, offset, starredSessionIds)`** (line 1458):
Same pattern as Claude — starred sessions always included, pagination applied only to non-starred.

### API Layer (`src/utils/api.js`)

- `api.starProject(projectName)` → `PUT /api/projects/:projectName/star`
- `api.starSession(projectName, sessionId)` → `PUT /api/projects/:projectName/sessions/:sessionId/star`
- `api.sessions(projectName, limit, offset, provider, starredIds)` → `GET /api/projects/:projectName/sessions?limit=&offset=&provider=&starred=id1,id2`

### Server Routes (`server/index.js`)

- `PUT /api/projects/:projectName/star` (line 575) → calls `toggleStarProject`
- `PUT /api/projects/:projectName/sessions/:sessionId/star` (line 585) → calls `toggleStarSession`
- `GET /api/projects/:projectName/sessions` (line 513) → parses `starred` query param, passes to `getClaudeSessions` or `getCursorSessions` depending on `provider`

### Frontend State (`useSidebarController.ts`)

- `starredProjects: Set<string>` — local state for starred project names
- `starredSessions: Map<string, Set<string>>` — local state mapping project names → starred session IDs
- Initialized from server data **once** on first load (`starredInitialized` ref)
- After initialization, local state is source of truth; toggles update local state optimistically and fire-and-forget API calls

### Frontend Sorting (`sidebar/utils/utils.ts`)

- `getAllSessions()` — merges all provider sessions, sorts with starred first
- `sortProjects()` — sorts with starred projects first

---

## 2. Star Project / Star Session Paths

### Star Project Path
1. User clicks star icon on `SidebarProjectItem` → `toggleStarProject(projectName)`
2. `useSidebarController.toggleStarProject`:
   - Updates `starredProjects` Set (add/remove)
   - Calls `api.starProject(projectName)` (fire-and-forget)
3. Server: `toggleStarProject(projectName)` toggles `config[projectName].starred`, saves config
4. Server returns `{ success: true, starred: boolean }`

**Status: Path is correct.** The `api.starProject` sends `PUT /api/projects/:projectName/star`. Server handler exists and calls the right function.

### Star Session Path
1. User clicks star icon on `SidebarSessionItem` → `toggleStarSession(projectName, sessionId)`
2. `useSidebarController.toggleStarSession`:
   - Updates `starredSessions` Map (add/remove session ID in project's Set)
   - Calls `api.starSession(projectName, sessionId)` (fire-and-forget)
3. Server: `toggleStarSession(projectName, sessionId)` toggles session ID in `config[projectName].starredSessions`, saves config
4. Server returns `{ success: true, starred: boolean }`

**Status: Path is correct.** The API URL `PUT /api/projects/:projectName/sessions/:sessionId/star` matches the server route.

---

## 3. Response Handling Review

### Initial Project Load (`GET /api/projects`)
- `getProjects()` calls `buildClaudeProject()` which passes `project.starredSessions` to `getClaudeSessions(projectName, 5, 0, starredSessions)`
- Response includes `project.starred` and `project.starredSessions` on each project object
- **No issues** — starred data is included in initial load

### Session Load (`GET /api/projects/:projectName/sessions`)
- Returns `{ sessions, hasMore, total, offset, limit }`
- `sessions` array contains ALL starred sessions + paginated non-starred sessions
- `total` counts **only non-starred** sessions
- `hasMore` is based on non-starred count
- **Key design**: Starred sessions are always included in every response, regardless of pagination

### WebSocket `projects_updated`
- Triggered by file watcher, calls `getProjects()` which rebuilds everything
- Project objects include `starred` and `starredSessions` from config
- Frontend's `useProjectsState` updates `projects` state but sidebar controller's starred state is **not re-synced** (by design — local state is source of truth after init)
- **No issue for starred state**, but see note on error handling below

---

## 4. Load Sessions / Load More Sessions — Issues Found

### ISSUE 1: Offset Miscalculation (CRITICAL BUG)

In `useSidebarController.loadMoreSessions()` (line 452):

```typescript
const currentClaudeCount =
  (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0);

api.sessions(project.name, 5, currentClaudeCount, 'claude', projectStarredIds)
```

**Problem:** `project.sessions` contains **both starred and non-starred sessions** (the server returns `[...starred, ...paginated]`). But on the server side, `offset` is applied only to non-starred sessions:

```javascript
const paginatedSessions = nonStarredSessions.slice(offset, offset + limit);
```

So if there are 2 starred sessions:
- Initial load: server returns 2 starred + 5 non-starred = 7 sessions
- User clicks "Load More": `currentClaudeCount = 7`
- Request sent: `offset=7, limit=5`
- Server: `nonStarredSessions.slice(7, 12)` — **skips sessions at indices 5 and 6!**
- Result: 2 non-starred sessions are silently dropped

**The offset is over-counted by the number of starred sessions.**

The same issue applies to Cursor sessions:
```typescript
const currentCursorCount =
  (project.cursorSessions?.length || 0) + (additionalCursorSessions[project.name]?.length || 0);
```

### ISSUE 2: Duplicate Starred Sessions (CRITICAL BUG)

The server returns ALL starred sessions in **every** response (both initial load and load-more). The frontend appends load-more results to `additionalSessions`:

```typescript
setAdditionalSessions((prev) => ({
  ...prev,
  [project.name]: [...(prev[project.name] || []), ...(result.sessions || [])],
}));
```

Then `getAllSessions()` combines them:
```typescript
const claudeSessions = [
  ...(project.sessions || []),            // Contains starred + first page non-starred
  ...(additionalSessions[project.name] || []),  // Contains starred AGAIN + more non-starred
]
```

**Result: Starred sessions appear twice (or more, with each "Load More" click) in the session list.**

The `getAllSessions()` sort puts all starred at the top, so users would see duplicate starred session entries.

### ISSUE 3: No Deduplication in `getAllSessions()`

The `getAllSessions()` function in `sidebar/utils/utils.ts` (line 88) does no deduplication. It blindly concatenates arrays. Even though the sorting pushes starred items first, duplicate IDs are never filtered out.

### ISSUE 4: `hasMore` vs Session Count Display Mismatch

`SidebarProjectItem.getSessionCountDisplay()` counts `sessions.length` (all displayed sessions) to show like "7+" or "12". But `total` from the server only counts non-starred sessions. After several loads:
- Display might show "12" sessions visible
- But `total` might be 10 (non-starred)
- `hasMore` could be `false` while there are still visually more sessions than `total`

This isn't a breaking issue but can be confusing.

---

## 5. Additional Observations

### No Error Recovery on Star Toggle Failure
The star API calls are fire-and-forget (`void api.starProject(projectName)`). If the API fails, local state stays toggled but server state is unchanged. There's no retry or error notification. On next page refresh, the starred state will revert to server state.

### Cross-Provider Starred IDs Sent to Provider-Specific Endpoints
```typescript
const projectStarredIds = [...(starredSessions.get(project.name) || [])];
```
This sends ALL starred session IDs (Claude, Cursor, Codex, Gemini) when loading more sessions for any single provider. The server harmlessly ignores non-matching IDs, so it's not a bug — just unnecessary data in the request.

### Codex and Gemini Sessions Not Paginated
Only Claude and Cursor sessions use the star-aware pagination. Codex and Gemini sessions are loaded in full from `getProjects()` and are not paginated. Starring a Codex/Gemini session affects sort order in `getAllSessions()` but has no server-side pagination implications.

### `projectsHaveChanges` Doesn't Check Starred Fields
In `useProjectsState.ts`, the `projectsHaveChanges()` function doesn't compare `starred` or `starredSessions`. Since starred state is managed locally in `useSidebarController`, this is intentional and not a bug.

---

## 6. Summary of Issues

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | **Critical** | Offset miscalculation — starred sessions counted in offset but server paginates non-starred only, causing sessions to be skipped | `useSidebarController.loadMoreSessions()` |
| 2 | **Critical** | Starred sessions duplicated — server returns starred in every response, frontend appends without dedup | `useSidebarController.loadMoreSessions()` + `getAllSessions()` |
| 3 | **Medium** | No deduplication in `getAllSessions()` | `sidebar/utils/utils.ts` |
| 4 | **Low** | Session count display may be inconsistent with actual total | `SidebarProjectItem` |
| 5 | **Low** | No error recovery on failed star API calls | `useSidebarController` |

## 7. Suggested Fixes

### For Issues 1 & 2 (recommended approach):

**Option A: Fix client-side offset and filter duplicates**
- When computing offset for load-more, subtract the number of starred sessions from the count
- In `loadMoreSessions`, filter out starred sessions from the response before appending to `additionalSessions`

```typescript
// Fix offset calculation
const starredCount = starredSessions.get(project.name)?.size || 0;
const currentClaudeCount =
  (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0) - starredCount;

// Filter duplicates from response
const existingIds = new Set([
  ...(project.sessions || []).map(s => s.id),
  ...(additionalSessions[project.name] || []).map(s => s.id),
]);
const newSessions = (result.sessions || []).filter(s => !existingIds.has(s.id));
```

**Option B: Server stops returning starred sessions in paginated responses**
- Server only returns starred sessions on initial load (offset=0)
- On subsequent loads (offset > 0), only return paginated non-starred sessions
- Simpler client code but changes API behavior

### For Issue 3:
Add deduplication in `getAllSessions()`:
```typescript
const seen = new Set<string>();
const allSessions = [...claudeSessions, ...cursorSessions, ...codexSessions, ...geminiSessions]
  .filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
```
