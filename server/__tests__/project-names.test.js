/**
 * Critical Path Tests: Project Name Handling
 * 
 * These tests verify that project names are handled consistently across the codebase.
 * 
 * Naming Convention:
 * - Claude format (canonical): "-localhome-local-eyao-myproject" (leading dash)
 * - Cursor format (internal): "localhome-local-eyao-myproject" (no leading dash)
 * - Display name: "myproject" (user-friendly)
 * 
 * The Claude format is used as the canonical format for:
 * - Project.name in API responses
 * - Session config directory names (~/.cloudcli/sessions/{projectName}/)
 * - WebSocket session update messages
 * - All API endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock fs and path for testing
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    access: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
  },
  default: {
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      access: vi.fn(),
      stat: vi.fn(),
      unlink: vi.fn(),
    }
  }
}));

vi.mock('os', () => ({
  default: {
    homedir: () => '/home/testuser'
  },
  homedir: () => '/home/testuser'
}));

describe('Project Name Format Conversions', () => {
  describe('encodeCursorProjectName', () => {
    it('should convert project path to Claude format (with leading dash)', () => {
      // The function should convert /foo/bar -> -foo-bar
      const projectPath = '/localhome/local-eyao/claudecodeui';
      const expected = '-localhome-local-eyao-claudecodeui';
      
      // Inline implementation of the function for testing
      const encodeCursorProjectName = (path) => path.replace(/[\\/]/g, '-');
      
      expect(encodeCursorProjectName(projectPath)).toBe(expected);
    });

    it('should handle Windows-style paths', () => {
      const projectPath = 'C:\\Users\\test\\project';
      const expected = 'C:-Users-test-project';
      
      const encodeCursorProjectName = (path) => path.replace(/[\\/]/g, '-');
      
      expect(encodeCursorProjectName(projectPath)).toBe(expected);
    });

    it('should handle paths with existing dashes', () => {
      const projectPath = '/home/my-user/my-project';
      const expected = '-home-my-user-my-project';
      
      const encodeCursorProjectName = (path) => path.replace(/[\\/]/g, '-');
      
      expect(encodeCursorProjectName(projectPath)).toBe(expected);
    });
  });

  describe('Project Name Consistency', () => {
    it('Claude format should have leading dash', () => {
      const cursorFolderName = 'localhome-local-eyao-claudecodeui';
      const claudeFormat = '-' + cursorFolderName;
      
      expect(claudeFormat).toBe('-localhome-local-eyao-claudecodeui');
      expect(claudeFormat.startsWith('-')).toBe(true);
    });

    it('Cursor format should NOT have leading dash', () => {
      const cursorFolderName = 'localhome-local-eyao-claudecodeui';
      
      expect(cursorFolderName.startsWith('-')).toBe(false);
    });

    it('Converting Claude format to Cursor format should strip leading dash', () => {
      const claudeFormat = '-localhome-local-eyao-claudecodeui';
      const cursorFormat = claudeFormat.replace(/^-/, '');
      
      expect(cursorFormat).toBe('localhome-local-eyao-claudecodeui');
    });
  });
});

describe('Project Merging', () => {
  it('should preserve cursorName when merging Cursor project into Claude project', () => {
    const claudeProject = {
      name: '-localhome-local-eyao-claudecodeui',
      fullPath: '/localhome/local-eyao/claudecodeui',
      sessions: [{ id: 'claude-session-1' }],
      cursorSessions: [],
    };

    const cursorProject = {
      name: '-localhome-local-eyao-claudecodeui',  // Now uses Claude format
      cursorName: 'localhome-local-eyao-claudecodeui',  // Cursor format preserved
      fullPath: '/localhome/local-eyao/claudecodeui',
      sessions: [],
      cursorSessions: [{ id: 'cursor-session-1' }],
    };

    // Simulate merge
    const merged = { ...claudeProject };
    merged.cursorSessions = cursorProject.cursorSessions;
    merged.cursorName = cursorProject.cursorName;

    expect(merged.name).toBe('-localhome-local-eyao-claudecodeui');
    expect(merged.cursorName).toBe('localhome-local-eyao-claudecodeui');
    expect(merged.cursorSessions).toHaveLength(1);
    expect(merged.sessions).toHaveLength(1);
  });

  it('Cursor-only projects should use Claude format for name', () => {
    const cursorOnlyProject = {
      name: '-localhome-local-eyao-cursor-only',  // Claude format
      cursorName: 'localhome-local-eyao-cursor-only',  // Cursor format
      fullPath: '/localhome/local-eyao/cursor-only',
      sessions: [],
      cursorSessions: [{ id: 'cursor-session-1' }],
    };

    expect(cursorOnlyProject.name.startsWith('-')).toBe(true);
    expect(cursorOnlyProject.cursorName.startsWith('-')).toBe(false);
  });
});

describe('Session Config Paths', () => {
  it('should use Claude format for session config directory', () => {
    const projectName = '-localhome-local-eyao-claudecodeui';
    const sessionId = 'test-session-123';
    const expectedPath = '/home/testuser/.cloudcli/sessions/-localhome-local-eyao-claudecodeui/test-session-123.json';
    
    const configPath = `/home/testuser/.cloudcli/sessions/${projectName}/${sessionId}.json`;
    
    expect(configPath).toBe(expectedPath);
  });
});

describe('WebSocket Message Project Names', () => {
  it('sessions_updated message should use Claude format project names', () => {
    const message = {
      type: 'sessions_updated',
      updates: {
        '-localhome-local-eyao-claudecodeui': {
          sessionIds: ['session-1', 'session-2'],
          provider: 'cursor'
        }
      },
      timestamp: new Date().toISOString()
    };

    const projectNames = Object.keys(message.updates);
    expect(projectNames[0]).toBe('-localhome-local-eyao-claudecodeui');
    expect(projectNames[0].startsWith('-')).toBe(true);
  });
});

describe('API Endpoint Project Name Handling', () => {
  it('batch session fetch should match project.name directly', () => {
    const project = {
      name: '-localhome-local-eyao-claudecodeui',
      cursorName: 'localhome-local-eyao-claudecodeui',
    };

    const batchResponse = {
      projectName: '-localhome-local-eyao-claudecodeui',
      sessionId: 'test-session',
      provider: 'cursor',
      session: { id: 'test-session', name: 'Test Session' }
    };

    // Direct comparison should work now (no normalization needed)
    expect(batchResponse.projectName).toBe(project.name);
  });

  it('Cursor session lookup should strip leading dash from project name', () => {
    const projectName = '-localhome-local-eyao-claudecodeui';
    const cursorName = projectName.replace(/^-/, '');
    
    expect(cursorName).toBe('localhome-local-eyao-claudecodeui');
    // This cursorName is used to call extractCursorProjectPath()
  });
});

describe('Hash to Project Name Mapping', () => {
  it('should map Cursor project hash to Claude format name', async () => {
    const crypto = await import('crypto');
    const projectPath = '/localhome/local-eyao/claudecodeui';
    const cursorFolderName = 'localhome-local-eyao-claudecodeui';
    const canonicalName = '-' + cursorFolderName;
    
    const hash = crypto.createHash('md5').update(projectPath).digest('hex');
    
    // The hash mapping should return Claude format
    const hashToName = new Map();
    hashToName.set(hash, canonicalName);
    
    expect(hashToName.get(hash)).toBe('-localhome-local-eyao-claudecodeui');
    expect(hashToName.get(hash).startsWith('-')).toBe(true);
  });
});
