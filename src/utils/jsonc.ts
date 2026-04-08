import {
  parseJsoncObject as parseJsoncObjectShared,
  stripJsonComments as stripJsonCommentsShared,
} from './jsonc.shared.js';

export function stripJsonComments(input: string): string {
  return stripJsonCommentsShared(input);
}

export function parseJsoncObject(raw: string): unknown {
  return parseJsoncObjectShared(raw);
}
