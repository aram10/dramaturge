# A2A Multi-Agent Mode

Dramaturge supports an optional **A2A (Agent-to-Agent) multi-agent coordination mode** based on Google's A2A protocol. When enabled, the engine routes tasks to specialized agents with distinct roles, enabling coordinated exploration and testing workflows.

## Agent Roles

A2A mode includes five specialized agent roles:

- **Scout** (`agent-scout`): Handles navigation tasks, rapidly mapping the application surface area
- **Tester** (`agent-tester`): Deep-dives into forms, CRUD flows, and API endpoints with domain-specific reasoning
- **Security** (`agent-security`): Runs adversarial scenarios with security-domain knowledge (OWASP patterns, boundary probing)
- **Reviewer** (`agent-reviewer`): Observes other agents in real-time and redirects them toward suspicious behaviors
- **Reporter** (`agent-reporter`): Synthesizes findings across all agents into coherent narratives

## Configuration

Enable A2A mode in your `dramaturge.config.json`:

```json
{
  "targetUrl": "https://example.com",
  "appDescription": "Your application description",
  "a2a": {
    "enabled": true,
    "maxBlackboardEntries": 500,
    "maxMessageHistory": 500
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable multi-agent coordination mode |
| `maxBlackboardEntries` | number | `500` | Maximum entries retained in the shared blackboard |
| `maxMessageHistory` | number | `500` | Maximum messages retained in the message bus history |

## How It Works

### Task Assignment

When A2A mode is enabled:

1. Each frontier task is automatically assigned to the most appropriate agent based on its worker type:
   - `navigation` → Scout
   - `form`, `crud`, `api` → Tester
   - `adversarial` → Security

2. The Coordinator creates an A2A Task wrapper that tracks:
   - Assigned agent
   - Task status (submitted → working → completed/failed)
   - Message history
   - Artifacts produced

### Blackboard Communication

Agents share context through a **Blackboard** — a shared state layer where they post:
- **Findings**: Test results, bugs, and observations
- **Coverage signals**: Which controls have been exercised
- **Navigation discoveries**: New pages found
- **Directives**: High-priority guidance from the Reviewer

Workers can query the blackboard to see what other agents have discovered, enabling coordination without direct communication.

### Message Bus

Agents communicate via a **MessageBus**:
- Point-to-point messages between agents
- Broadcast messages (e.g., Reviewer redirecting all agents to focus on forms)
- Coordinator announcements (task assignments, status updates)

### Task Lifecycle

```
submitted → working → completed/failed
```

The Coordinator tracks each task through this lifecycle:
1. **submitted**: Task assigned to an agent
2. **working**: Agent actively executing the task
3. **completed**: Task finished successfully (findings reported to Reviewer if any)
4. **failed**: Task could not be completed (navigation blocked, timeout, error)

## Worker Context

When A2A is enabled, workers receive additional context:
- **Agent role**: The specialized role they're fulfilling
- **Agent ID**: Unique identifier for this agent instance
- **Blackboard summary**: Recent 10 entries from the shared blackboard
- **Blackboard access**: Ability to post findings and query shared state via the `post_to_blackboard` tool

## Benefits

- **Specialized reasoning**: Each agent applies domain-specific knowledge (navigation patterns, form validation heuristics, security threat models)
- **Coordinated coverage**: Agents avoid duplicate work by observing the blackboard
- **Dynamic prioritization**: Reviewer can redirect agents based on emerging patterns
- **Comprehensive narratives**: Reporter synthesizes findings across multiple testing perspectives

## When to Use A2A

A2A mode adds coordination overhead. Use it when:
- You need comprehensive multi-faceted testing (navigation + forms + API + security)
- Your application has complex workflows where agents can benefit from shared context
- You want specialized reasoning for different task types
- You're exploring a large surface area where coordination reduces wasted effort

For simple sites or single-focus testing (e.g., only navigation), standard mode without A2A is more efficient.

## Observability

With A2A enabled, the engine logs:
- Agent assignments: Which agent is handling each task
- Blackboard activity: Entries posted and their types
- Message bus traffic: Inter-agent communication
- Coordinator events: Task lifecycle transitions

Check the `--verbose` output or dashboard to monitor A2A coordination in real-time.
