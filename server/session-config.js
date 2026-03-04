/**
 * SESSION CONFIG MODULE
 * =====================
 * 
 * Manages per-session configuration (starred, read status) stored in individual files.
 * 
 * File Structure:
 *   ~/.cloudcli/sessions/{project-name}/{session-id}.json
 * 
 * Session Config Schema:
 *   {
 *     "starred": boolean,
 *     "readAt": string | null,        // ISO timestamp for Claude/Codex/Gemini
 *     "readBlobOffset": number | null, // For Cursor sessions
 *     "displayName": string | null    // User-set override name (all providers)
 *   }
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const SESSION_CONFIG_ROOT = path.join(os.homedir(), '.cloudcli', 'sessions');

/**
 * Get session config, returns defaults if file doesn't exist
 */
export async function getSessionConfig(projectName, sessionId) {
  const configPath = path.join(SESSION_CONFIG_ROOT, projectName, `${sessionId}.json`);
  try {
    const content = await fs.readFile(configPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { starred: false, readAt: null, readBlobOffset: null, displayName: null };
    }
    throw err;
  }
}

/**
 * Update session config (merge with existing)
 */
export async function updateSessionConfig(projectName, sessionId, updates) {
  const configDir = path.join(SESSION_CONFIG_ROOT, projectName);
  await fs.mkdir(configDir, { recursive: true });
  
  const existing = await getSessionConfig(projectName, sessionId);
  const merged = { ...existing, ...updates };
  
  const configPath = path.join(configDir, `${sessionId}.json`);
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2));
  return merged;
}

/**
 * Delete session config
 */
export async function deleteSessionConfig(projectName, sessionId) {
  const configPath = path.join(SESSION_CONFIG_ROOT, projectName, `${sessionId}.json`);
  try {
    await fs.unlink(configPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Batch get configs for multiple sessions (efficient for getProjects)
 */
export async function getSessionConfigs(projectName, sessionIds) {
  const configs = {};
  await Promise.all(sessionIds.map(async (sessionId) => {
    configs[sessionId] = await getSessionConfig(projectName, sessionId);
  }));
  return configs;
}

/**
 * Migrate existing session data from project-config.json to individual session configs
 * This is called once on startup to migrate old data format
 */
export async function migrateSessionConfigs() {
  const oldConfigPath = path.join(os.homedir(), '.cloudcli', 'project-config.json');
  
  let oldConfig;
  try {
    const content = await fs.readFile(oldConfigPath, 'utf8');
    oldConfig = JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { migrated: false, reason: 'No existing config' };
    }
    throw err;
  }
  
  let migratedCount = 0;
  let needsSave = false;
  
  for (const [projectName, projectConfig] of Object.entries(oldConfig)) {
    if (!projectConfig || typeof projectConfig !== 'object') continue;
    
    // Migrate starred sessions
    const starredSessions = projectConfig.starredSessions || [];
    for (const sessionId of starredSessions) {
      await updateSessionConfig(projectName, sessionId, { starred: true });
      migratedCount++;
    }
    
    // Migrate read timestamps (Claude/Codex/Gemini)
    const readTimestamps = projectConfig.readTimestamps || {};
    for (const [sessionId, readAt] of Object.entries(readTimestamps)) {
      await updateSessionConfig(projectName, sessionId, { readAt });
      migratedCount++;
    }
    
    // Migrate read blob offsets (Cursor)
    const readBlobOffsets = projectConfig.readBlobOffsets || {};
    for (const [sessionId, offset] of Object.entries(readBlobOffsets)) {
      await updateSessionConfig(projectName, sessionId, { readBlobOffset: offset });
      migratedCount++;
    }
    
    // Clean up old fields from project config
    if (projectConfig.starredSessions) {
      delete projectConfig.starredSessions;
      needsSave = true;
    }
    if (projectConfig.readTimestamps) {
      delete projectConfig.readTimestamps;
      needsSave = true;
    }
    if (projectConfig.readBlobOffsets) {
      delete projectConfig.readBlobOffsets;
      needsSave = true;
    }
  }
  
  // Save cleaned project config
  if (needsSave) {
    await fs.writeFile(oldConfigPath, JSON.stringify(oldConfig, null, 2));
  }
  
  return { migrated: true, count: migratedCount };
}

/**
 * Check if migration has been done (by checking if old fields exist in project config)
 */
export async function needsMigration() {
  const oldConfigPath = path.join(os.homedir(), '.cloudcli', 'project-config.json');
  
  try {
    const content = await fs.readFile(oldConfigPath, 'utf8');
    const config = JSON.parse(content);
    
    for (const projectConfig of Object.values(config)) {
      if (!projectConfig || typeof projectConfig !== 'object') continue;
      if (projectConfig.starredSessions?.length > 0 ||
          (projectConfig.readTimestamps && Object.keys(projectConfig.readTimestamps).length > 0) ||
          (projectConfig.readBlobOffsets && Object.keys(projectConfig.readBlobOffsets).length > 0)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}
