# Project and Session Naming

This document explains how project display names and session names are determined, stored, and displayed in the UI.

## Project Display Name

### How It's Determined

The `generateDisplayName()` function in `server/projects.js` determines project display names:

1. **Primary**: Read `name` field from `package.json` in the project directory
2. **Fallback**: Use the last folder name from the project path

### Storage

Custom display names are stored in `~/.claude/project-config.json`:

```json
{
  "encoded-project-name": {
    "displayName": "Custom Name"
  }
}
```

### User Modification

Users can rename projects via:
- **API**: `PUT /api/projects/:projectName` with `{ displayName: "New Name" }`
- **Backend**: `renameProject(projectName, newDisplayName)` in `server/projects.js`

Setting an empty display name removes the custom name and reverts to auto-generated.

## Session Display Name

### Frontend Display Logic

The `getSessionName()` function in `src/components/sidebar/utils/utils.ts` determines what's shown:

| Provider | Primary Field | Fallback |
|----------|---------------|----------|
| Claude   | `summary`     | "New Session" |
| Cursor   | `name`        | "Untitled Session" |
| Codex    | `summary`     | `name`, then "Codex Session" |
| Gemini   | `summary`     | `name`, then "New Session" |

### How Summary is Generated

#### Claude Sessions

In `parseJsonlSessions()`:
1. Look for `type: 'summary'` entries in JSONL (Claude CLI auto-generates these)
2. Fall back to last user message (truncated to 50 characters)

#### Cursor Sessions

In `parseCursorAgentSession()`:
1. Extract first meaningful user message from the transcript
2. Skip system-like messages (JSON, commands)
3. Extract content from `<user_query>` tags if present
4. Truncate to 80 characters

#### Codex/Gemini Sessions

Similar pattern - use first user message or session metadata.

### Session Rename

**Currently not implemented.** The `updateSessionSummary()` function in `useSidebarController.ts` is a no-op:

```typescript
const updateSessionSummary = useCallback(
  async (_projectName: string, _sessionId: string, _summary: string) => {
    // Session rename endpoint is not currently exposed on the API.
    setEditingSession(null);
    setEditingSessionName('');
  },
  [],
);
```

The UI shows an edit button but changes are not persisted.

## Cursor Session Discovery

Cursor sessions are now read directly from `~/.cursor/chats/{md5_of_project_path}/`:
- Each session has a `store.db` SQLite database
- Metadata (name, createdAt, model) stored in `meta` table, key `0`, hex-encoded JSON
- Message history stored in `blobs` table

The `getCursorSessions()` function scans this directory and reads metadata from each session's store.db.

## Data Flow Summary

```
Project Discovery
├── Claude: ~/.claude/projects/{encoded-name}/
├── Cursor: ~/.cursor/projects/{encoded-name}/agent-transcripts/
├── Codex: ~/.openai-codex/sessions/
└── Gemini: In-memory (sessionManager.js)

Display Name Resolution
├── Check project-config.json for custom displayName
├── Try package.json name field
└── Fall back to last folder name

Session Name Resolution
├── Claude: summary field from JSONL
├── Cursor: name field (BUG: backend sets summary)
├── Codex: summary or name field
└── Gemini: summary or name field
```
