# Refactor getProjects Method

## Objective

Refactor `getProjects()` to have clearer separation of concerns with shared utility functions.

## Current Issues

- Logic for Claude, Cursor, Codex, Gemini sessions all mixed together
- Hard to follow the flow
- Duplicate code patterns

## Proposed Architecture

```
getProjects()
├── getClaudeProjects()     → Claude projects + Claude/Codex/Gemini sessions
├── getCursorProjects()     → Cursor projects + Cursor sessions  
└── mergeProjects()         → Combine by path, avoid duplicates
```

### Shared Utilities

```javascript
// Project utilities
generateDisplayName(encodedName, projectPath)
extractProjectDirectory(projectName)        // For Claude
extractCursorProjectPath(encodedName)       // For Cursor

// Session utilities  
getCodexSessions(projectPath)
getGeminiSessions(projectPath)
getCursorAgentSessions(encodedName, projectPath)
```

## Proposed Changes

### 1. Create `getClaudeProjects(progressCallback)`

Returns Claude projects with:
- Claude sessions (from JSONL)
- Codex sessions
- Gemini sessions
- TaskMaster detection

### 2. Refactor `getCursorProjects(progressCallback)` 

Returns Cursor projects with:
- Cursor sessions only (from chats store.db)

### 3. Create `mergeProjects(claudeProjects, cursorProjects)`

- Match by `fullPath`
- Merge sessions when same project exists in both
- Keep unique projects from each source

### 4. Simplify `getProjects(progressCallback)`

```javascript
async function getProjects(progressCallback) {
  const claudeProjects = await getClaudeProjects(progressCallback);
  const cursorProjects = await getCursorProjects();
  return mergeProjects(claudeProjects, cursorProjects);
}
```

## Tasks

- [x] Extract `getClaudeProjects()` from current `getProjects()`
- [x] Simplify `getCursorOnlyProjects()` to only return Cursor sessions
- [x] Create `mergeProjects()` utility
- [x] Simplify main `getProjects()` to orchestrate the above
- [x] Test all project/session combinations work correctly

## Files to Change

- `server/projects.js`
