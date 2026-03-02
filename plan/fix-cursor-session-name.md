# Fix: Cursor Session Name Display

## Objective

Fix Cursor sessions showing as "Untitled Session" by reading session name from Cursor's store.db.

## Current State

- Backend `getCursorAgentSessions()` parses JSONL and sets `summary` from first user message
- Frontend `getSessionName()` expects `name` field for Cursor sessions
- Cursor stores proper session names in `~/.cursor/chats/{cwdHash}/{sessionId}/store.db`

## Discovery

Session names are stored in:
- Path: `~/.cursor/chats/{md5_hash_of_project_path}/{session_id}/store.db`
- Table: `meta`, Key: `0`
- Value: Hex-encoded JSON with `name` field

Example decoded value:
```json
{
  "agentId": "a8f18d56-d724-466b-8e57-a16e6538b719",
  "name": "Project Merge Plan",
  "createdAt": 1772358365809,
  "mode": "default",
  "lastUsedModel": "claude-4.5-opus-high-thinking"
}
```

## Proposed Changes

### File: `server/projects.js`

**Change 1**: Add function to read session name from store.db

```javascript
async function getCursorSessionName(projectPath, sessionId) {
  const cwdHash = crypto.createHash('md5').update(projectPath).digest('hex');
  const dbPath = path.join(os.homedir(), '.cursor', 'chats', cwdHash, sessionId, 'store.db');
  
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = '0'").get();
    db.close();
    
    if (row?.value) {
      const decoded = Buffer.from(row.value, 'hex').toString('utf8');
      const json = JSON.parse(decoded);
      return json.name || null;
    }
  } catch {
    return null;
  }
  return null;
}
```

**Change 2**: Update `getCursorAgentSessions()` to use the new function

```javascript
// Get session name from store.db
const sessionName = await getCursorSessionName(projectPath, sessionId);

sessions.push({
  id: sessionId,
  name: sessionName || sessionData.summary,  // Prefer store.db name
  summary: sessionData.summary,
  ...
});
```

## Tasks

- [x] Add `getCursorSessionName()` function to read from store.db
- [x] Update `getCursorAgentSessions()` to fetch and set `name` field
- [x] Pass projectPath to `getCursorAgentSessions()` for cwdHash calculation

## Risk Assessment

- Low risk - fallback to summary if store.db read fails
- Uses existing `better-sqlite3` dependency
