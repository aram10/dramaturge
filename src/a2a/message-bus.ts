/**
 * MessageBus — inter-agent message passing based on the A2A protocol.
 *
 * Agents send messages to each other (point-to-point or broadcast)
 * through the bus. The Coordinator and Reviewer agents observe all
 * traffic; worker agents see only messages addressed to them.
 */

import type { A2AMessage, Part } from './types.js';
import { shortId } from '../constants.js';

type MessageHandler = (message: A2AMessage) => void;

export class MessageBus {
  private handlers = new Map<string, MessageHandler[]>();
  private broadcastHandlers: MessageHandler[] = [];
  private history: A2AMessage[] = [];

  /**
   * Send a message from one agent to another (or broadcast with toAgent="*").
   */
  send(
    fromAgent: string,
    toAgent: string,
    parts: Part[],
    options?: {
      role?: A2AMessage['role'];
      correlationId?: string;
      metadata?: Record<string, unknown>;
    }
  ): A2AMessage {
    const message: A2AMessage = {
      id: `msg-${shortId()}`,
      fromAgent,
      toAgent,
      role: options?.role ?? 'agent',
      parts,
      timestamp: new Date().toISOString(),
      correlationId: options?.correlationId,
      metadata: options?.metadata,
    };

    this.history.push(message);

    if (toAgent === '*') {
      // Broadcast
      for (const handler of this.broadcastHandlers) handler(message);
      for (const [, handlers] of this.handlers) {
        for (const handler of handlers) handler(message);
      }
    } else {
      // Point-to-point delivery
      const targetHandlers = this.handlers.get(toAgent) ?? [];
      for (const handler of targetHandlers) handler(message);

      // Broadcast listeners also see point-to-point messages
      for (const handler of this.broadcastHandlers) handler(message);
    }

    return message;
  }

  /** Convenience: send a text-only message. */
  sendText(
    fromAgent: string,
    toAgent: string,
    text: string,
    options?: {
      role?: A2AMessage['role'];
      correlationId?: string;
      metadata?: Record<string, unknown>;
    }
  ): A2AMessage {
    return this.send(fromAgent, toAgent, [{ kind: 'text', text }], options);
  }

  /**
   * Register a handler for messages addressed to a specific agent.
   * Returns an unsubscribe function.
   */
  onMessage(agentId: string, handler: MessageHandler): () => void {
    const existing = this.handlers.get(agentId) ?? [];
    existing.push(handler);
    this.handlers.set(agentId, existing);

    return () => {
      const handlers = this.handlers.get(agentId);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Register a handler that observes ALL messages (broadcast subscriber).
   * Useful for the Coordinator or Reviewer agent.
   */
  onAny(handler: MessageHandler): () => void {
    this.broadcastHandlers.push(handler);
    return () => {
      const idx = this.broadcastHandlers.indexOf(handler);
      if (idx >= 0) this.broadcastHandlers.splice(idx, 1);
    };
  }

  /** Get the full message history. */
  getHistory(): readonly A2AMessage[] {
    return [...this.history];
  }

  /** Get messages sent by a specific agent. */
  getMessagesFrom(agentId: string): readonly A2AMessage[] {
    return this.history.filter((m) => m.fromAgent === agentId);
  }

  /** Get messages addressed to a specific agent. */
  getMessagesTo(agentId: string): readonly A2AMessage[] {
    return this.history.filter((m) => m.toAgent === agentId || m.toAgent === '*');
  }

  /** Total messages sent. */
  size(): number {
    return this.history.length;
  }
}
