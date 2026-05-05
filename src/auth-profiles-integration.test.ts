// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dramaturge-profiles-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('Auth Profiles Integration', () => {
  it('loads config with auth profiles successfully', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app with multi-role auth',
        auth: {
          profiles: {
            admin: {
              type: 'stored-state',
              stateFile: '.dramaturge-state/admin.json',
              successIndicator: 'url:https://example.com/dashboard',
            },
            viewer: {
              type: 'stored-state',
              stateFile: '.dramaturge-state/viewer.json',
              successIndicator: 'url:https://example.com/dashboard',
            },
          },
          default: 'admin',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(configPath);

    expect(config.targetUrl).toBe('https://example.com/app');
    expect(config.appDescription).toBe('Test app with multi-role auth');
    expect('profiles' in config.auth).toBe(true);
    if ('profiles' in config.auth) {
      expect(Object.keys(config.auth.profiles)).toEqual(['admin', 'viewer']);
      expect(config.auth.default).toBe('admin');
      expect(config.auth.profiles.admin.type).toBe('stored-state');
      expect(config.auth.profiles.viewer.type).toBe('stored-state');
    }
  });

  it('validates that at least one profile is required', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: {
          profiles: {},
          default: 'admin',
        },
      }),
      'utf-8'
    );

    expect(() => loadConfig(configPath)).toThrow('At least one auth profile is required');
  });

  it('validates that default profile exists in profiles', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: {
          profiles: {
            admin: {
              type: 'none',
            },
          },
          default: 'nonexistent',
        },
      }),
      'utf-8'
    );

    expect(() => loadConfig(configPath)).toThrow('The default profile must exist');
  });

  it('normalizes stateFile paths in auth profiles', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    mkdirSync(join(dir, 'auth-states'), { recursive: true });

    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: {
          profiles: {
            admin: {
              type: 'stored-state',
              stateFile: 'auth-states/admin.json',
            },
            editor: {
              type: 'interactive',
              loginUrl: 'https://example.com/login',
              successIndicator: 'url:https://example.com/dashboard',
              stateFile: 'auth-states/editor.json',
            },
          },
          default: 'admin',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(configPath);

    if ('profiles' in config.auth) {
      const adminProfile = config.auth.profiles.admin;
      const editorProfile = config.auth.profiles.editor;

      if (adminProfile.type === 'stored-state') {
        expect(adminProfile.stateFile).toBe(join(dir, 'auth-states/admin.json'));
      }
      if (editorProfile.type === 'interactive') {
        expect(editorProfile.stateFile).toBe(join(dir, 'auth-states/editor.json'));
      }
    }
  });

  it('supports backward compatibility with direct auth config', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app with single auth',
        auth: {
          type: 'stored-state',
          stateFile: '.dramaturge-state/user.json',
          successIndicator: 'url:https://example.com/dashboard',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(configPath);

    expect(config.targetUrl).toBe('https://example.com/app');
    expect('profiles' in config.auth).toBe(false);
    expect(config.auth.type).toBe('stored-state');
  });

  it('supports form auth in profiles', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: {
          profiles: {
            user1: {
              type: 'form',
              loginUrl: 'https://example.com/login',
              fields: [
                {
                  selector: '#username',
                  value: 'user1',
                  label: 'Username',
                },
                {
                  selector: '#password',
                  value: 'test-password',
                  label: 'Password',
                  secret: true,
                },
              ],
              submit: {
                selector: 'button[type="submit"]',
              },
              successIndicator: 'url:https://example.com/dashboard',
            },
          },
          default: 'user1',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(configPath);

    if ('profiles' in config.auth) {
      const user1Profile = config.auth.profiles.user1;
      expect(user1Profile.type).toBe('form');
      if (user1Profile.type === 'form') {
        expect(user1Profile.fields).toHaveLength(2);
        expect(user1Profile.fields[0].selector).toBe('#username');
        expect(user1Profile.fields[1].secret).toBe(true);
      }
    }
  });

  it('supports oauth-redirect auth in profiles', () => {
    const dir = createTempDir();
    const configPath = join(dir, 'dramaturge.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        targetUrl: 'https://example.com/app',
        appDescription: 'Test app',
        auth: {
          profiles: {
            google: {
              type: 'oauth-redirect',
              loginUrl: 'https://example.com/auth/google',
              steps: [
                {
                  type: 'fill',
                  selector: 'input[type="email"]',
                  value: 'test@example.com',
                },
                {
                  type: 'click',
                  selector: 'button[type="submit"]',
                },
                {
                  type: 'wait-for-selector',
                  selector: '[data-testid="dashboard"]',
                },
              ],
              successIndicator: 'url:https://example.com/dashboard',
            },
          },
          default: 'google',
        },
      }),
      'utf-8'
    );

    const config = loadConfig(configPath);

    if ('profiles' in config.auth) {
      const googleProfile = config.auth.profiles.google;
      expect(googleProfile.type).toBe('oauth-redirect');
      if (googleProfile.type === 'oauth-redirect') {
        expect(googleProfile.steps).toHaveLength(3);
        expect(googleProfile.steps[0].type).toBe('fill');
        expect(googleProfile.steps[1].type).toBe('click');
        expect(googleProfile.steps[2].type).toBe('wait-for-selector');
      }
    }
  });
});
