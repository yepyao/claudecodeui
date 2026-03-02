# Plan: Project Name Standardization

## Objective
Standardize project name handling across the codebase to eliminate confusion between different naming formats used by Claude, Cursor, and other providers.

## Current Problem
Project names have inconsistent formats:
- **Claude projects**: `-localhome-local-eyao-claudecodeui` (leading dash, path separators as dashes)
- **Cursor projects**: `localhome-local-eyao-claudecodeui` (no leading dash)
- **Display name**: User-friendly name like `claudecodeui`

When projects are merged, the naming becomes inconsistent, causing:
1. Session update WebSocket messages using Cursor format don't match frontend project names
2. API calls may use wrong format for different providers
3. Session config lookups fail due to name mismatches

## Phase 1: Audit - Where Project Names Are Used

### Backend API Endpoints (server/index.js)

| Endpoint | Parameter | Current Usage | Notes |
|----------|-----------|---------------|-------|
| `GET /api/projects` | - | Returns all projects | Project has `name` field |
| `GET /api/projects/:projectName/sessions` | projectName | Used to fetch sessions | Strips leading dash for Cursor |
| `POST /api/sessions/batch` | projectName in body | Fetches sessions by ID | Strips leading dash for Cursor |
| `PUT /api/projects/:projectName/sessions/:sessionId/star` | projectName | Toggle star | Used for session config lookup |
| `PUT /api/projects/:projectName/sessions/:sessionId/read` | projectName | Mark as read | Used for session config lookup |
| `DELETE /api/projects/:projectName/sessions/:sessionId` | projectName | Delete session | |
| `PUT /api/projects/:projectName/rename` | projectName | Rename project | |
| `PUT /api/projects/:projectName/star` | projectName | Star project | |

### Backend Functions (server/projects.js)

| Function | Project Name Usage | Notes |
|----------|-------------------|-------|
| `getClaudeSessions(projectName, ...)` | Claude format (with dash) | |
| `getCursorSessions(projectPath, ...)` | Full path, not name | |
| `markSessionRead(projectName, ...)` | Used for session config | |
| `toggleStarSession(projectName, ...)` | Used for session config | |
| `encodeCursorProjectName(projectPath)` | Converts path to Cursor format | No leading dash |
| `extractCursorProjectPath(encodedName)` | Expects Cursor format | |
| `extractProjectDirectory(projectName)` | Claude format | |

### Session Config (server/session-config.js)

| Function | Project Name Usage | Notes |
|----------|-------------------|-------|
| `getSessionConfig(projectName, sessionId)` | Directory name under ~/.cloudcli/sessions/ | |
| `updateSessionConfig(projectName, sessionId, ...)` | Directory name | |
| `getSessionConfigs(projectName, sessionIds)` | Directory name | |

### WebSocket Messages

| Message Type | Project Name Field | Format Used |
|--------------|-------------------|-------------|
| `sessions_updated` (Cursor polling) | `updates[projectName]` | Cursor format (no dash) |
| `sessions_updated` (file watcher) | `updates[projectName]` | Claude format (with dash) |
| `projects_updated` | `project.name` | Mixed |

### Frontend (src/)

| Location | Usage | Notes |
|----------|-------|-------|
| `useProjectsState.ts` | `project.name` comparisons | Needs normalization |
| `api.js` | All API calls use `projectName` | |
| `useSidebarController.ts` | `project.name` for API calls | |

## Phase 2: Proposed Solution

### Option A: Normalize at Source (Recommended)
Store both naming formats in the project object:

```typescript
interface Project {
  name: string;           // Primary identifier (Claude format: -foo-bar)
  cursorName?: string;    // Cursor format (foo-bar) - only if has Cursor sessions
  displayName: string;    // User-friendly display name
  fullPath: string;       // Actual filesystem path
  // ... other fields
}
```

**Changes Required:**

1. **Backend - Project Discovery**
   - `getCursorProjects()`: Set both `name` (with dash) and `cursorName` (without dash)
   - `mergeProjects()`: Preserve `cursorName` when merging

2. **Backend - API Endpoints**
   - Session endpoints: Accept either format, normalize internally
   - Batch endpoint: Use `cursorName` for Cursor lookups

3. **Backend - WebSocket Messages**
   - Cursor polling: Include both `projectName` and `cursorName` in updates
   - Or: Always use Claude format (`-foo-bar`) consistently

4. **Backend - Session Config**
   - Use Claude format (`-foo-bar`) as the canonical directory name
   - Update `encodeCursorProjectName()` to add leading dash

5. **Frontend**
   - Use `project.name` for all API calls
   - Remove normalization hacks

### Option B: Always Use Path-Based Lookup
Instead of project names, use `fullPath` for all lookups:

```typescript
interface BatchSessionRequest {
  projectPath: string;  // Full filesystem path
  sessionId: string;
  provider: SessionProvider;
}
```

**Pros:** Unambiguous, no naming format issues
**Cons:** Exposes internal paths, larger payloads, requires more refactoring

### Recommendation: Option A
It's less invasive and maintains backward compatibility.

## Phase 3: Implementation Tasks

### 3.1 Backend Changes
- [x] Update `Project` type in backend to include `cursorName`
- [x] Update `getCursorProjects()` to set both `name` and `cursorName`
- [x] Update `mergeProjects()` to preserve `cursorName`
- [x] Update `buildCursorHashToProjectNameMap()` to return Claude format
- [x] Update `encodeCursorProjectName()` to return Claude format
- [x] Update batch endpoint to handle both formats

### 3.2 Frontend Changes
- [x] Update `Project` type to include `cursorName?: string`
- [x] Remove project name normalization hacks in `useProjectsState.ts`

### 3.3 Migration
- [ ] Rename existing session config directories to use consistent format (if needed)
- [ ] Note: New sessions will automatically use the correct format

## Phase 4: Testing Strategy

### Should We Write Tests?
**Yes, strongly recommended.** The project name handling is critical and affects:
- Session updates (unread indicators)
- Session starring
- Session read tracking
- Session deletion

### Proposed Test Coverage

1. **Unit Tests (server/)**
   - `encodeCursorProjectName()` - verify output format
   - `extractCursorProjectPath()` - verify path extraction
   - `extractProjectDirectory()` - verify Claude path extraction
   - Session config CRUD with different name formats

2. **Integration Tests**
   - API endpoint tests with both name formats
   - WebSocket message handling
   - Batch session fetch with mixed providers

3. **Test File Structure**
```
server/
  __tests__/
    projects.test.js
    session-config.test.js
    api.test.js
```

### Test Framework
- Use Jest (already common in Node.js projects)
- Add to `package.json` devDependencies if not present

## Decisions Made

1. **Option A selected** - Store both naming formats in project object
2. **Test scope**: Critical paths only for now
3. **Canonical format**: Use Claude format (`-foo-bar`) as the normalized/canonical format everywhere
   - All session configs will use Claude format
   - All API calls will use Claude format
   - WebSocket messages will use Claude format
   - `cursorName` is only for internal Cursor lookups

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing session configs | Medium | High | Migration script + backup |
| API compatibility issues | Low | Medium | Support both formats during transition |
| WebSocket message format change | Low | Low | Frontend handles both formats |

## Next Steps

1. Review and approve this plan
2. Decide on Option A vs Option B
3. Decide on test coverage scope
4. Begin implementation in phases
