---
name: debug-api-changes
description: Test server-side code changes without restarting the server. Use when modifying files in server/, verifying API endpoint behavior, or testing with JWT authentication.
---

# Debug API Changes

Test server-side code changes without restarting the server.

## When to Use

- After modifying files in `server/` directory
- When you need to verify code changes work before restarting
- When testing API endpoints with authentication

## Method 1: Direct Module Import (No Server Restart)

Test code changes directly without restarting the server:

```bash
cd /localhome/local-eyao/claudecodeui

# Test a specific function
node -e "
import('./server/projects.js').then(async (m) => {
  const projects = await m.getProjects();
  console.log('Projects:', projects.length);
  projects.forEach(p => {
    console.log('  -', p.displayName, '| Claude:', p.sessions?.length, '| Cursor:', p.cursorSessions?.length);
  });
}).catch(e => console.error('Error:', e.message));
"
```

## Method 2: Test API with Authentication

The API requires JWT authentication. Generate a token and test:

### Step 1: Generate JWT Token

```bash
cd /localhome/local-eyao/claudecodeui

node -e "
const jwt = require('jsonwebtoken');
const JWT_SECRET = 'claude-ui-dev-secret-change-in-production';
// userId must match a user in ~/.cloudcli/auth.db
const token = jwt.sign({ userId: 1, username: 'eyao' }, JWT_SECRET);
console.log(token);
"
```

### Step 2: Test API Endpoint

```bash
TOKEN="<token-from-step-1>"

# Test projects endpoint
curl -s "http://localhost:3001/api/projects" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test with formatted output
curl -s "http://localhost:3001/api/projects" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if isinstance(data, list):
    print(f'Total: {len(data)} projects')
    for p in data:
        print(f'  - {p.get(\"displayName\", \"?\")} | Claude: {len(p.get(\"sessions\", []))} | Cursor: {len(p.get(\"cursorSessions\", []))}')
else:
    print(json.dumps(data, indent=2))
"
```

## Method 3: Check Syntax Errors

Before testing, verify no syntax errors:

```bash
node --check server/projects.js
```

## Key Files

| File | Purpose |
|------|---------|
| `server/projects.js` | Project discovery and session management |
| `server/middleware/auth.js` | JWT authentication (secret: `claude-ui-dev-secret-change-in-production`) |
| `~/.cloudcli/auth.db` | User database (SQLite) |

## Ports

| Port | Service |
|------|---------|
| 3001 | Express API server |
| 5173 | Vite frontend (proxies to 3001) |

## Notes

- Server runs as `node server/index.js` (no hot-reload)
- **Must restart server** for changes to take effect in production
- Direct module import tests the actual code without server restart
- JWT tokens don't expire (no expiration set)
