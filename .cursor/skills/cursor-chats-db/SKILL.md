# Cursor Chats Database Structure

## Overview

Cursor stores chat/agent sessions in SQLite databases at `~/.cursor/chats/`.

## Directory Structure

```
~/.cursor/chats/
└── {cwdHash}/                    # MD5 hash of project absolute path
    └── {sessionId}/              # UUID session ID
        └── store.db              # SQLite database
```

### cwdHash Calculation

```javascript
const crypto = require('crypto');
const cwdHash = crypto.createHash('md5').update(projectPath).digest('hex');
```

Example: `/localhome/local-eyao/claudecodeui` → `7f96f391f38c23da3c14d1d8e3de7273`

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `meta` | Session metadata (name, createdAt, model) |
| `blobs` | Message content and DAG structure |

### Meta Table

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Key identifier (usually "0" for main metadata) |
| value | TEXT | Hex-encoded JSON |

**Decoding meta value:**

```javascript
const row = db.prepare("SELECT value FROM meta WHERE key = '0'").get();
const decoded = Buffer.from(row.value, 'hex').toString('utf8');
const meta = JSON.parse(decoded);
```

**Meta JSON structure:**

```json
{
  "agentId": "uuid-session-id",
  "name": "Session Name",
  "createdAt": 1772357490096,
  "mode": "default",
  "lastUsedModel": "claude-4.5-opus-high-thinking",
  "latestRootBlobId": "sha256-hash"
}
```

### Blobs Table

| Column | Type | Description |
|--------|------|-------------|
| rowid | INTEGER | Auto-increment ID |
| id | TEXT | SHA-256 hash of content |
| data | BLOB | JSON message or protobuf DAG structure |

**Blob types:**
- **JSON blobs**: Start with `0x7B` (`{`), contain message content
- **Protobuf blobs**: Binary DAG structure linking messages

**JSON blob structure:**

```json
{
  "role": "user" | "assistant",
  "content": [{ "type": "text", "text": "message content" }],
  "id": "message-id",
  "providerOptions": {}
}
```

## Common Operations

### List all sessions for a project

```javascript
const cwdHash = crypto.createHash('md5').update(projectPath).digest('hex');
const chatsDir = path.join(os.homedir(), '.cursor', 'chats', cwdHash);
const sessions = fs.readdirSync(chatsDir);
```

### Get session metadata

```javascript
const db = await open({ filename: storeDbPath, driver: sqlite3.Database });
const row = await db.get("SELECT value FROM meta WHERE key = '0'");
const meta = JSON.parse(Buffer.from(row.value, 'hex').toString('utf8'));
// meta.name, meta.createdAt, meta.lastUsedModel
```

### Count messages in session

```javascript
const result = await db.get('SELECT COUNT(*) as count FROM blobs');
// Note: includes both message blobs and DAG blobs
```

### Check if session is empty

```javascript
// Empty sessions have 1 blob with size 0
const blob = await db.get('SELECT length(data) as size FROM blobs LIMIT 1');
const isEmpty = blob.size === 0;
```

## Important Notes

1. **Session names** are only in store.db, not in agent-transcripts
2. **Empty sessions** have 1 blob with size 0 and `latestRootBlobId` = SHA-256 of empty string
3. **lastActivity** should use file mtime for sessions with messages, createdAt for empty sessions
4. **Message timestamps** are NOT stored in blobs - use file mtime as proxy
5. **Different from agent-transcripts**: The `~/.cursor/projects/{encoded}/agent-transcripts/` folder contains JSONL transcripts but may not have all sessions that exist in chats

## Related Files

- `server/projects.js`: `getCursorSessions()` reads from this database
- `server/routes/cursor.js`: `/api/cursor/sessions/:sessionId` endpoint parses blobs
- `doc/cursor-folder-structure.md`: Overview of Cursor folder layout
