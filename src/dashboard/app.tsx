import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";
import type { EngineEventEmitter } from "../engine/event-stream.js";
import {
  type DashboardState,
  initialDashboardState,
  applyRunStart,
  applyRunEnd,
  applyTaskStart,
  applyTaskComplete,
  applyFinding,
  applyStateDiscovered,
  applyProgress,
  applyError,
} from "./state.js";

// --- Utility helpers ---

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function progressBar(ratio: number, width: number = 20): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

// --- Sub-components ---

function Header({ state }: { state: DashboardState }): React.ReactElement {
  const pct = Math.round(state.estimatedProgress * 100);
  const status = state.finished
    ? "✓ Complete"
    : state.running
      ? "● Running"
      : "○ Waiting";
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Dramaturge Dashboard
        </Text>
        <Text>
          {status}
          {"  "}
          {progressBar(state.estimatedProgress)} {pct}%
        </Text>
      </Box>
      {state.targetUrl ? (
        <Box justifyContent="space-between">
          <Text dimColor>Target: {state.targetUrl}</Text>
          <Text dimColor>
            Elapsed: {formatElapsed(state.elapsedMs)}
            {state.timeLimitSeconds > 0
              ? ` / ${formatElapsed(state.timeLimitSeconds * 1000)}`
              : ""}
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
        <Text bold>Findings:</Text>{" "}
        <Text color={state.totalFindings > 0 ? "yellow" : undefined}>
          {state.totalFindings}
        </Text>
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
  activity: DashboardState["activity"];
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
          if (item.kind === "finding") color = "yellow";
          else if (item.kind === "error") color = "red";
          else if (item.kind === "state-discovered") color = "green";
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

function ErrorBanner({
  message,
}: {
  message: string | undefined;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <Box marginTop={1}>
      <Text bold color="red">
        ✗ {message}
      </Text>
    </Box>
  );
}

function FinishedSummary({
  state,
}: {
  state: DashboardState;
}): React.ReactElement | null {
  if (!state.finished) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">
        Run complete in {formatElapsed(state.durationMs)}
      </Text>
      <Text>
        {state.tasksExecuted} tasks · {state.totalFindings} findings ·{" "}
        {state.statesDiscovered} states
      </Text>
    </Box>
  );
}

// --- Main Dashboard component ---

const ACTIVITY_LINES = 15;

export function Dashboard({
  eventStream,
}: {
  eventStream: EngineEventEmitter;
}): React.ReactElement {
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
    const onStateDiscovered = (
      evt: Parameters<typeof applyStateDiscovered>[1]
    ) => setState((s) => applyStateDiscovered(s, evt));
    const onProgress = (evt: Parameters<typeof applyProgress>[1]) =>
      setState((s) => applyProgress(s, evt));
    const onError = (evt: Parameters<typeof applyError>[1]) =>
      setState((s) => applyError(s, evt));

    eventStream.on("run:start", onRunStart);
    eventStream.on("run:end", onRunEnd);
    eventStream.on("task:start", onTaskStart);
    eventStream.on("task:complete", onTaskComplete);
    eventStream.on("finding", onFinding);
    eventStream.on("state:discovered", onStateDiscovered);
    eventStream.on("progress", onProgress);
    eventStream.on("run:error", onError);

    return () => {
      eventStream.off("run:start", onRunStart);
      eventStream.off("run:end", onRunEnd);
      eventStream.off("task:start", onTaskStart);
      eventStream.off("task:complete", onTaskComplete);
      eventStream.off("finding", onFinding);
      eventStream.off("state:discovered", onStateDiscovered);
      eventStream.off("progress", onProgress);
      eventStream.off("run:error", onError);
    };
  }, [eventStream]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header state={state} />
      <Stats state={state} />
      <ActivityFeed activity={state.activity} maxLines={ACTIVITY_LINES} />
      <ErrorBanner message={state.lastError} />
      <FinishedSummary state={state} />
    </Box>
  );
}
