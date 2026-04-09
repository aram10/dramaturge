// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import type { EngineEventEmitter } from '../engine/event-stream.js';
import type { Blackboard } from '../a2a/blackboard.js';
import type { MessageBus } from '../a2a/message-bus.js';
import {
  type DashboardState,
  type AgentStatus,
  initialDashboardState,
  applyRunStart,
  applyRunEnd,
  applyTaskStart,
  applyTaskComplete,
  applyFinding,
  applyStateDiscovered,
  applyProgress,
  applyError,
  applyA2ATask,
  applyA2AMessage,
  applyA2ABlackboard,
} from './state.js';

// --- Utility helpers ---

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function progressBar(ratio: number, width: number = 20): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// --- Sub-components ---

function Header({ state }: { state: DashboardState }): React.ReactElement {
  const pct = Math.round(state.estimatedProgress * 100);
  const status = state.finished ? '✓ Complete' : state.running ? '● Running' : '○ Waiting';
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Dramaturge Dashboard
        </Text>
        <Text>
          {status}
          {'  '}
          {progressBar(state.estimatedProgress)} {pct}%
        </Text>
      </Box>
      {state.targetUrl ? (
        <Box justifyContent="space-between">
          <Text dimColor>Target: {state.targetUrl}</Text>
          <Text dimColor>
            Elapsed: {formatElapsed(state.elapsedMs)}
            {state.timeLimitSeconds > 0 ? ` / ${formatElapsed(state.timeLimitSeconds * 1000)}` : ''}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Stats({ state }: { state: DashboardState }): React.ReactElement {
  return (
    <Box justifyContent="space-around" marginTop={1}>
      <Text>
        <Text bold>Tasks:</Text> {state.tasksExecuted} done / {state.tasksRemaining} queued
      </Text>
      <Text>
        <Text bold>States:</Text> {state.statesDiscovered}
      </Text>
      <Text>
        <Text bold>Findings:</Text>{' '}
        <Text color={state.totalFindings > 0 ? 'yellow' : undefined}>{state.totalFindings}</Text>
      </Text>
      <Text>
        <Text bold>Workers:</Text> {state.concurrency}
      </Text>
    </Box>
  );
}

function ActivityFeed({
  activity,
  maxLines,
}: {
  activity: DashboardState['activity'];
  maxLines: number;
}): React.ReactElement {
  const visible = activity.slice(0, maxLines);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold underline>
        Activity
      </Text>
      {visible.length === 0 ? (
        <Text dimColor>Waiting for events…</Text>
      ) : (
        visible.map((item) => {
          let color: string | undefined;
          if (item.kind === 'finding') color = 'yellow';
          else if (item.kind === 'error') color = 'red';
          else if (item.kind === 'state-discovered') color = 'green';
          else if (item.kind === 'a2a-task') color = 'cyan';
          else if (item.kind === 'a2a-message') color = 'blue';
          else if (item.kind === 'a2a-blackboard') color = 'magenta';
          return (
            <Text key={item.id} color={color}>
              {item.text}
            </Text>
          );
        })
      )}
    </Box>
  );
}

function ErrorBanner({ message }: { message: string | undefined }): React.ReactElement | null {
  if (!message) return null;
  return (
    <Box marginTop={1}>
      <Text bold color="red">
        ✗ {message}
      </Text>
    </Box>
  );
}

function FinishedSummary({ state }: { state: DashboardState }): React.ReactElement | null {
  if (!state.finished) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">
        Run complete in {formatElapsed(state.durationMs)}
      </Text>
      <Text>
        {state.tasksExecuted} tasks · {state.totalFindings} findings · {state.statesDiscovered}{' '}
        states
        {state.a2aEnabled
          ? ` · ${state.a2aTasksTotal} A2A tasks · ${state.a2aMessagesTotal} messages`
          : ''}
      </Text>
    </Box>
  );
}

const ROLE_ICONS: Record<string, string> = {
  scout: '🔭',
  tester: '🧪',
  security: '🛡️',
  reviewer: '📝',
  reporter: '📊',
};

function AgentPanel({
  agents,
  a2aTasksTotal,
  a2aMessagesTotal,
  a2aBlackboardTotal,
}: {
  agents: Readonly<Record<string, AgentStatus>>;
  a2aTasksTotal: number;
  a2aMessagesTotal: number;
  a2aBlackboardTotal: number;
}): React.ReactElement {
  const agentList = Object.values(agents);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold underline>
        Agents (A2A)
      </Text>
      <Box justifyContent="space-around">
        <Text>
          <Text bold>A2A Tasks:</Text> {a2aTasksTotal}
        </Text>
        <Text>
          <Text bold>Messages:</Text> {a2aMessagesTotal}
        </Text>
        <Text>
          <Text bold>Blackboard:</Text> {a2aBlackboardTotal}
        </Text>
      </Box>
      {agentList.length === 0 ? (
        <Text dimColor>No agents active yet…</Text>
      ) : (
        agentList.map((agent) => {
          const icon = ROLE_ICONS[agent.role] ?? '●';
          const statusColor =
            agent.currentStatus === 'working'
              ? 'cyan'
              : agent.currentStatus === 'completed'
                ? 'green'
                : undefined;
          return (
            <Text key={agent.agentId}>
              {icon} <Text bold>{agent.role}</Text> <Text dimColor>({agent.agentId})</Text>{' '}
              <Text color={statusColor}>{agent.currentStatus}</Text>
              {'  '}tasks: {agent.tasksAssigned}/{agent.tasksCompleted}
              {'  '}posts: {agent.blackboardPosts}
            </Text>
          );
        })
      )}
    </Box>
  );
}

// --- Main Dashboard component ---

export interface DashboardProps {
  eventStream: EngineEventEmitter;
  blackboard?: Blackboard;
  messageBus?: MessageBus;
}

const ACTIVITY_LINES = 15;

export function Dashboard({
  eventStream,
  blackboard,
  messageBus,
}: DashboardProps): React.ReactElement {
  const [state, setState] = useState<DashboardState>(initialDashboardState);

  useEffect(() => {
    const onRunStart = (evt: Parameters<typeof applyRunStart>[1]) =>
      setState((s) => applyRunStart(s, evt));
    const onRunEnd = (evt: Parameters<typeof applyRunEnd>[1]) =>
      setState((s) => applyRunEnd(s, evt));
    const onTaskStart = (evt: Parameters<typeof applyTaskStart>[1]) =>
      setState((s) => applyTaskStart(s, evt));
    const onTaskComplete = (evt: Parameters<typeof applyTaskComplete>[1]) =>
      setState((s) => applyTaskComplete(s, evt));
    const onFinding = (evt: Parameters<typeof applyFinding>[1]) =>
      setState((s) => applyFinding(s, evt));
    const onStateDiscovered = (evt: Parameters<typeof applyStateDiscovered>[1]) =>
      setState((s) => applyStateDiscovered(s, evt));
    const onProgress = (evt: Parameters<typeof applyProgress>[1]) =>
      setState((s) => applyProgress(s, evt));
    const onError = (evt: Parameters<typeof applyError>[1]) => setState((s) => applyError(s, evt));

    eventStream.on('run:start', onRunStart);
    eventStream.on('run:end', onRunEnd);
    eventStream.on('task:start', onTaskStart);
    eventStream.on('task:complete', onTaskComplete);
    eventStream.on('finding', onFinding);
    eventStream.on('state:discovered', onStateDiscovered);
    eventStream.on('progress', onProgress);
    eventStream.on('run:error', onError);

    const cleanups: (() => void)[] = [];

    // Wire A2A blackboard subscription
    if (blackboard) {
      const unsub = blackboard.subscribe('*', (entry) => {
        const summary =
          typeof entry.data.summary === 'string'
            ? entry.data.summary
            : typeof entry.data.title === 'string'
              ? entry.data.title
              : JSON.stringify(entry.data).slice(0, 60);
        setState((s) =>
          applyA2ABlackboard(s, {
            kind: entry.kind,
            agentId: entry.agentId,
            summary,
          })
        );
      });
      cleanups.push(unsub);
    }

    // Wire A2A message bus subscription
    if (messageBus) {
      const unsub = messageBus.onAny((msg) => {
        const text =
          msg.parts
            .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
            .map((p) => p.text)
            .join(' ') || '(non-text message)';
        setState((s) =>
          applyA2AMessage(s, {
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            text: text.slice(0, 80),
          })
        );
      });
      cleanups.push(unsub);
    }

    return () => {
      eventStream.off('run:start', onRunStart);
      eventStream.off('run:end', onRunEnd);
      eventStream.off('task:start', onTaskStart);
      eventStream.off('task:complete', onTaskComplete);
      eventStream.off('finding', onFinding);
      eventStream.off('state:discovered', onStateDiscovered);
      eventStream.off('progress', onProgress);
      eventStream.off('run:error', onError);
      for (const cleanup of cleanups) cleanup();
    };
  }, [eventStream, blackboard, messageBus]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <Stats state={state} />
      {state.a2aEnabled && (
        <AgentPanel
          agents={state.agents}
          a2aTasksTotal={state.a2aTasksTotal}
          a2aMessagesTotal={state.a2aMessagesTotal}
          a2aBlackboardTotal={state.a2aBlackboardTotal}
        />
      )}
      <ActivityFeed activity={state.activity} maxLines={ACTIVITY_LINES} />
      <ErrorBanner message={state.lastError} />
      <FinishedSummary state={state} />
    </Box>
  );
}
