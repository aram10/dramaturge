---
applyTo: "**/*.test.ts,**/*.test.tsx"
---

# Test Writing Conventions — Dramaturge

## Framework
- Vitest 4 with `vitest run` (no watch mode in CI)
- Co-locate tests: `module.test.ts` next to `module.ts`

## Mocking

### Hoisted Mocks (for circular dependencies)
```typescript
const mocks = vi.hoisted(() => ({
  myFunction: vi.fn(),
}));
vi.mock('./my-module.js', () => ({
  myFunction: mocks.myFunction,
}));
```

### Standard Mocks
```typescript
vi.mock('../llm.js', () => ({
  callLLM: vi.fn().mockResolvedValue('response'),
}));
```

### Type-Safe Mock Access
```typescript
vi.mocked(myFunction).mockReturnValue(expected);
expect(vi.mocked(myFunction)).toHaveBeenCalledWith(arg);
```

**Always use `.js` extension** in `vi.mock()` paths — they must match the compiled ESM import paths.

## Test Structure
```typescript
describe('ModuleName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does the expected thing when given valid input', () => {
    // arrange → act → assert
  });

  it('handles edge case gracefully', () => {
    // ...
  });
});
```

## Factory Helpers
Create reusable test doubles with sensible defaults:
```typescript
function makeItem(overrides: Partial<FrontierItem> = {}): FrontierItem {
  return {
    id: 'test-item',
    nodeId: 'node-1',
    workerType: 'navigation',
    objective: 'Test objective',
    priority: 1,
    reason: 'test',
    retryCount: 0,
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}
```

## Rules
- Never remove or disable existing tests
- Use `describe` blocks grouped by concern
- Use descriptive `it` names: `'sorts findings by severity'`, not `'test 1'`
- Clean up temp files/dirs in `afterEach`
- Assert async rejections: `await expect(fn()).rejects.toThrow('message')`
- Prefer `toEqual` for deep equality, `toBe` for primitives/references
