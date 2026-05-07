// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import {
  getAuthProfileNames,
  isAuthProfiles,
  resolveAuthProfile,
  type AuthConfig,
  type AuthProfiles,
} from './config.js';

describe('Auth Profiles', () => {
  describe('isAuthProfiles', () => {
    it('returns false for direct auth config', () => {
      const auth: AuthConfig = { type: 'none' };
      expect(isAuthProfiles(auth)).toBe(false);
    });

    it('returns true for auth profiles config', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: { type: 'none' },
        },
        default: 'admin',
      };
      expect(isAuthProfiles(auth)).toBe(true);
    });
  });

  describe('resolveAuthProfile', () => {
    it('returns direct auth config when not using profiles', () => {
      const auth: AuthConfig = {
        type: 'stored-state',
        stateFile: '.dramaturge-state/user.json',
      };
      const resolved = resolveAuthProfile(auth);
      expect(resolved).toEqual(auth);
    });

    it('resolves default profile when no profile name specified', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/admin.json',
          },
          viewer: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/viewer.json',
          },
        },
        default: 'admin',
      };
      const resolved = resolveAuthProfile(auth);
      expect(resolved).toEqual(auth.profiles.admin);
    });

    it('resolves specified profile when profile name provided', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/admin.json',
          },
          viewer: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/viewer.json',
          },
        },
        default: 'admin',
      };
      const resolved = resolveAuthProfile(auth, 'viewer');
      expect(resolved).toEqual(auth.profiles.viewer);
    });

    it('throws error when no default set and no profile specified', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/admin.json',
          },
        },
      };
      expect(() => resolveAuthProfile(auth)).toThrow(
        'No profile specified and no default profile set'
      );
    });

    it('throws error when profile does not exist', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: {
            type: 'stored-state',
            stateFile: '.dramaturge-state/admin.json',
          },
        },
        default: 'admin',
      };
      expect(() => resolveAuthProfile(auth, 'nonexistent')).toThrow(
        'Auth profile "nonexistent" not found'
      );
    });
  });

  describe('getAuthProfileNames', () => {
    it('returns empty array for direct auth config', () => {
      const auth: AuthConfig = { type: 'none' };
      expect(getAuthProfileNames(auth)).toEqual([]);
    });

    it('returns all profile names for auth profiles', () => {
      const auth: AuthProfiles = {
        profiles: {
          admin: { type: 'none' },
          viewer: { type: 'none' },
          editor: { type: 'none' },
        },
        default: 'admin',
      };
      expect(getAuthProfileNames(auth)).toEqual(['admin', 'viewer', 'editor']);
    });
  });
});
