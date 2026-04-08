import { shortId } from '../constants.js';
import { isSensitiveKey } from '../redaction.js';
import type {
  ControlAction,
  ControlOutcome,
  ReplayableAction,
  ReplayableActionKind,
  ReplayableActionStatus,
} from '../types.js';

type QueryMethod =
  | 'locator'
  | 'getByRole'
  | 'getByText'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByTestId'
  | 'getByAltText'
  | 'getByTitle';

const QUERY_METHODS: QueryMethod[] = [
  'locator',
  'getByRole',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByTestId',
  'getByAltText',
  'getByTitle',
];

const LOCATOR_ACTION_METHODS = new Set([
  'click',
  'fill',
  'type',
  'press',
  'check',
  'uncheck',
  'selectOption',
]);

const PAGE_ACTION_METHODS = new Set([
  'click',
  'fill',
  'type',
  'press',
  'check',
  'uncheck',
  'selectOption',
]);

function summarizeAction(
  kind: ReplayableActionKind,
  target: string | undefined,
  status: ReplayableActionStatus
): string {
  if (!target) {
    return `${kind} -> ${status}`;
  }
  return `${kind} ${target} -> ${status}`;
}

function describeQuery(method: QueryMethod, args: unknown[]): string {
  switch (method) {
    case 'locator':
      return String(args[0] ?? 'unknown');
    case 'getByRole': {
      const role = String(args[0] ?? 'unknown');
      const name = (args[1] as { name?: unknown } | undefined)?.name;
      return name ? `role=${role}[name=${String(name)}]` : `role=${role}`;
    }
    case 'getByText':
      return `text=${String(args[0] ?? 'unknown')}`;
    case 'getByLabel':
      return `label=${String(args[0] ?? 'unknown')}`;
    case 'getByPlaceholder':
      return `placeholder=${String(args[0] ?? 'unknown')}`;
    case 'getByTestId':
      return `testid=${String(args[0] ?? 'unknown')}`;
    case 'getByAltText':
      return `alt=${String(args[0] ?? 'unknown')}`;
    case 'getByTitle':
      return `title=${String(args[0] ?? 'unknown')}`;
    default:
      return String(args[0] ?? 'unknown');
  }
}

function mapControlActionToReplayableKind(action: ControlAction): ReplayableActionKind {
  return action;
}

function mapActionMethodToKind(method: string): ReplayableActionKind {
  switch (method) {
    case 'fill':
    case 'type':
    case 'selectOption':
      return 'input';
    case 'press':
      return 'keydown';
    case 'check':
    case 'uncheck':
      return 'toggle';
    default:
      return 'click';
  }
}

function normalizeActionValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    const candidate = value as {
      value?: unknown;
      label?: unknown;
      index?: unknown;
    };
    if (candidate.value != null) {
      return String(candidate.value);
    }
    if (candidate.label != null) {
      return `label=${String(candidate.label)}`;
    }
    if (candidate.index != null) {
      return `index=${String(candidate.index)}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function sanitizeRecordedAction(
  kind: ReplayableActionKind,
  selector: string | undefined,
  value: string | undefined
): Pick<ReplayableAction, 'value' | 'redacted'> {
  if (kind === 'input' && value != null && selector && isSensitiveKey(selector)) {
    return { value: undefined, redacted: true };
  }

  return { value };
}

export class ActionRecorder {
  private actions: ReplayableAction[] = [];
  private restores: Array<() => void> = [];
  private wrappedLocators = new WeakMap<object, unknown>();
  private started = false;

  constructor(private page?: any) {}

  start(): void {
    if (this.started || !this.page) {
      return;
    }
    this.started = true;

    this.patchPageNavigation('goto');
    this.patchPageNavigation('goBack');
    this.patchPageNavigation('goForward');
    this.patchPageNavigation('reload');

    for (const method of PAGE_ACTION_METHODS) {
      this.patchPageAction(method);
    }

    for (const method of QUERY_METHODS) {
      this.patchQueryMethod(this.page, method);
    }

    if (this.page.keyboard && typeof this.page.keyboard.press === 'function') {
      const original = this.page.keyboard.press;
      this.page.keyboard.press = async (...args: unknown[]) => {
        try {
          const result = await original.apply(this.page.keyboard, args);
          if (this.started) {
            this.recordToolAction({
              kind: 'keydown',
              key: String(args[0] ?? ''),
              summary: summarizeAction('keydown', String(args[0] ?? ''), 'worked'),
              source: 'page',
              status: 'worked',
            });
          }
          return result;
        } catch (error) {
          if (this.started) {
            this.recordToolAction({
              kind: 'keydown',
              key: String(args[0] ?? ''),
              summary: summarizeAction('keydown', String(args[0] ?? ''), 'error'),
              source: 'page',
              status: 'error',
            });
          }
          throw error;
        }
      };
      this.restores.push(() => {
        this.page.keyboard.press = original;
      });
    }
  }

  stop(): void {
    while (this.restores.length > 0) {
      const restore = this.restores.pop();
      restore?.();
    }
    this.started = false;
  }

  getActions(): ReplayableAction[] {
    return [...this.actions];
  }

  getRecentActionIds(limit = 8): string[] {
    return this.actions.slice(-limit).map((action) => action.id);
  }

  getRecentSummaries(limit = 8): string[] {
    return this.actions.slice(-limit).map((action) => action.summary);
  }

  recordControlAction(
    controlId: string,
    action: ControlAction,
    outcome: ControlOutcome
  ): ReplayableAction {
    const kind = mapControlActionToReplayableKind(action);
    return this.recordAction({
      kind,
      selector: controlId,
      summary: summarizeAction(kind, controlId, outcome),
      source: 'worker-tool',
      status: outcome,
    });
  }

  recordToolAction(
    input: Omit<ReplayableAction, 'id' | 'timestamp'> & {
      source?: ReplayableAction['source'];
    }
  ): ReplayableAction {
    return this.recordAction({
      ...input,
      source: input.source ?? 'worker-tool',
    });
  }

  private recordAction(action: Omit<ReplayableAction, 'id' | 'timestamp'>): ReplayableAction {
    const sanitized = sanitizeRecordedAction(action.kind, action.selector, action.value);
    const recorded: ReplayableAction = {
      id: `act-${shortId()}`,
      timestamp: new Date().toISOString(),
      ...action,
      ...sanitized,
    };
    this.actions.push(recorded);
    return recorded;
  }

  private patchPageNavigation(method: 'goto' | 'goBack' | 'goForward' | 'reload'): void {
    if (typeof this.page?.[method] !== 'function') {
      return;
    }

    const original = this.page[method];
    this.page[method] = async (...args: unknown[]) => {
      try {
        const result = await original.apply(this.page, args);
        const url = method === 'goto' ? String(args[0] ?? '') : undefined;
        if (this.started) {
          this.recordToolAction({
            kind: 'navigate',
            url,
            summary: method === 'goto' ? `navigate ${url} -> worked` : `${method} -> worked`,
            source: 'page',
            status: 'worked',
          });
        }
        return result;
      } catch (error) {
        if (this.started) {
          this.recordToolAction({
            kind: 'navigate',
            url: method === 'goto' ? String(args[0] ?? '') : undefined,
            summary:
              method === 'goto'
                ? `navigate ${String(args[0] ?? '')} -> error`
                : `${method} -> error`,
            source: 'page',
            status: 'error',
          });
        }
        throw error;
      }
    };
    this.restores.push(() => {
      this.page[method] = original;
    });
  }

  private patchPageAction(method: string): void {
    if (typeof this.page?.[method] !== 'function') {
      return;
    }

    const original = this.page[method];
    this.page[method] = async (...args: unknown[]) => {
      const selector = String(args[0] ?? '');
      try {
        const result = await original.apply(this.page, args);
        if (this.started) {
          this.recordToolAction({
            kind: mapActionMethodToKind(method),
            selector,
            value:
              method === 'fill' || method === 'type' || method === 'selectOption'
                ? normalizeActionValue(args[1])
                : undefined,
            key: method === 'press' ? String(args[1] ?? '') : undefined,
            summary: summarizeAction(mapActionMethodToKind(method), selector, 'worked'),
            source: 'page',
            status: 'worked',
          });
        }
        return result;
      } catch (error) {
        if (this.started) {
          this.recordToolAction({
            kind: mapActionMethodToKind(method),
            selector,
            summary: summarizeAction(mapActionMethodToKind(method), selector, 'error'),
            source: 'page',
            status: 'error',
          });
        }
        throw error;
      }
    };
    this.restores.push(() => {
      this.page[method] = original;
    });
  }

  private patchQueryMethod(target: any, method: QueryMethod): void {
    if (!target || typeof target[method] !== 'function') {
      return;
    }

    const original = target[method];
    target[method] = (...args: unknown[]) => {
      const locator = original.apply(target, args);
      const selectorHint = describeQuery(method, args);
      return this.wrapLocator(locator, selectorHint);
    };
    this.restores.push(() => {
      target[method] = original;
    });
  }

  private wrapLocator(locator: any, selectorHint: string): any {
    if (!locator || typeof locator !== 'object') {
      return locator;
    }

    const existing = this.wrappedLocators.get(locator);
    if (existing) {
      return existing;
    }

    const proxy = new Proxy(locator, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string' || typeof value !== 'function') {
          return value;
        }

        if (QUERY_METHODS.includes(prop as QueryMethod)) {
          return (...args: unknown[]) => {
            const child = value.apply(target, args);
            const childSelector = `${selectorHint} >> ${describeQuery(prop as QueryMethod, args)}`;
            return this.wrapLocator(child, childSelector);
          };
        }

        if (!LOCATOR_ACTION_METHODS.has(prop)) {
          return value.bind(target);
        }

        return async (...args: unknown[]) => {
          const kind = mapActionMethodToKind(prop);
          try {
            const result = await value.apply(target, args);
            if (this.started) {
              this.recordToolAction({
                kind,
                selector: selectorHint,
                value:
                  prop === 'fill' || prop === 'type' || prop === 'selectOption'
                    ? normalizeActionValue(args[0])
                    : undefined,
                key: prop === 'press' ? String(args[0] ?? '') : undefined,
                summary: summarizeAction(kind, selectorHint, 'worked'),
                source: 'page',
                status: 'worked',
              });
            }
            return result;
          } catch (error) {
            if (this.started) {
              this.recordToolAction({
                kind,
                selector: selectorHint,
                summary: summarizeAction(kind, selectorHint, 'error'),
                source: 'page',
                status: 'error',
              });
            }
            throw error;
          }
        };
      },
    });

    this.wrappedLocators.set(locator, proxy);
    return proxy;
  }
}
