# Move project-config.json to ~/.cloudcli/

## Objective

Move `~/.claude/project-config.json` to `~/.cloudcli/project-config.json` to separate this project's config from Claude CLI's files.

## Changes

### File: `server/projects.js`

Update `loadProjectConfig()` and `saveProjectConfig()`:

```javascript
// Before
const configPath = path.join(os.homedir(), '.claude', 'project-config.json');

// After  
const configPath = path.join(os.homedir(), '.cloudcli', 'project-config.json');
```

## Tasks

- [x] Update `loadProjectConfig()` path
- [x] Update `saveProjectConfig()` path and directory creation
- [x] Update comments referencing the old path
- [x] Test loading/saving works correctly
