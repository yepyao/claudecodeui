# Plan: Favorite Sessions & Projects (Server-Synced)

## Objective

1. Allow users to star/favorite sessions - starred sessions always appear at the very top (above all non-starred) and are always loaded regardless of pagination
2. Migrate starred projects from localStorage to server-side storage
3. Both starred projects and sessions sync to server for persistence across devices/browsers

## Current State

- Projects can be starred (stored in localStorage as `starredProjects`) - browser-only
- Sessions cannot be starred
- Sessions are paginated (limit 5 per load)

## Proposed Changes

### 1. Backend - Config Storage (`server/projects.js`)

The project config file (`~/.cloudcli/project-config.json`) already exists for project settings (line 208). Extend it to store:

```json
{
  "projectName": {
    "displayName": "...",
    "starred": true,
    "starredSessions": ["session-id-1", "session-id-2"]
  }
}
```

### 2. Backend - New API Endpoints (`server/index.js`)

- `PUT /api/projects/:name/star` - Toggle project starred status
- `PUT /api/projects/:name/sessions/:sessionId/star` - Toggle session starred status

### 3. Backend - Sessions API (`server/index.js`, `server/projects.js`)

Modify `getClaudeSessions()` and `getCursorSessions()`:
- Accept `starredSessionIds` parameter
- Always include starred sessions in response (even if outside pagination range)
- Return starred sessions first, then paginated non-starred sessions
- Adjust `hasMore` calculation to exclude already-returned starred sessions

### 4. Backend - Projects API (`server/projects.js`)

- Include `starred: true/false` flag in project response
- Include `starredSessions: string[]` in project response

### 5. Frontend - Remove localStorage (`src/components/sidebar/utils/utils.ts`)

- Remove `loadStarredProjects()` and `persistStarredProjects()`
- Starred state now comes from project API response

### 6. Frontend - API (`src/utils/api.js`)

- Add `starProject(projectName)` - toggle project star
- Add `starSession(projectName, sessionId)` - toggle session star
- Update `sessions()` to pass starred session IDs

### 7. Frontend State (`src/components/sidebar/hooks/useSidebarController.ts`)

- Load starred state from project data (comes from API)
- `toggleStarProject()` - call API, update local state optimistically
- `toggleStarSession()` - call API, update local state optimistically
- `isSessionStarred(projectName, sessionId)` function

### 8. UI - Session Star (`src/components/sidebar/view/subcomponents/SidebarSessionItem.tsx`)

- Add star icon button (similar to project star)
- Show filled star for starred, outline for non-starred

### 9. Sorting (`src/components/sidebar/utils/utils.ts`)

- Update `getAllSessions()` to sort starred sessions to the **very top** (above all non-starred, regardless of provider)

## Tasks

- [ ] Extend config schema to include `starred` and `starredSessions`
- [ ] Add `PUT /api/projects/:name/star` endpoint
- [ ] Add `PUT /api/projects/:name/sessions/:sessionId/star` endpoint
- [ ] Update `getClaudeSessions()` to handle starred sessions
- [ ] Update `getCursorSessions()` to handle starred sessions
- [ ] Include starred info in project API response
- [ ] Remove localStorage functions for starred projects
- [ ] Add star API calls to frontend
- [ ] Update useSidebarController for server-synced starring
- [ ] Update SidebarSessionItem UI with star icon
- [ ] Update getAllSessions to sort starred to very top
- [ ] Migrate existing localStorage starred projects on first load (one-time)
- [ ] Test with both Claude and Cursor sessions

## Migration Strategy

On first load after update:
1. Check if localStorage `starredProjects` exists
2. If yes, call API to save them to server config
3. Clear localStorage `starredProjects`

## Risk Assessment

- Medium risk: Changes existing starred projects behavior
- Need migration path for existing localStorage data
- Backend config file changes need careful handling
