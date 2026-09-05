# Strategy loop

`runWithStrategy()` runs one worker at a time and creates a fresh strategist session after each work step. The strategist chooses `start`, `continue`, `switch`, or `stop`. Continuing keeps the worker's conversation; switching creates a new conversation with the assignment and selected evidence. All workers use the same working directory, so files and edits remain available.

```typescript
import { runWithStrategy } from "@earendil-works/pi-coding-agent";

const result = await runWithStrategy({
  objective: "Speed up the parser's slow path",
  successCriteria: "Existing checks pass and a recorded measurement shows an improvement",
  cwd: "/path/to/project",
  initialContext: "The slow path handles large nested inputs.",
  limits: { maxSteps: 5 },
  onEvent(event) {
    if (event.type === "decision") console.log(event.decision);
  },
});

console.log(result.assessment, result.stopReason, result.outputDir);
```

The same configured Prime model serves both roles. You can supply `model`, `thinkingLevel`, `serviceTier`, `authStorage`, and `modelRegistry` using the existing SDK types. `settings` applies run-local overrides without changing saved settings.

## Run from this checkout

From `packages/coding-agent`:

```bash
npx tsx --tsconfig ../../tsconfig.json examples/sdk/14-strategy.ts \
  --objective "Speed up the parser's slow path" \
  --success-criteria "Existing checks pass and a recorded measurement shows an improvement" \
  --cwd /path/to/project \
  --max-steps 5
```

Use `--output-dir` to choose the parent directory for saved runs. Ctrl-C requests cancellation and waits for owned work to settle.

## Work and evidence

The strategist has only `read_evidence` and `choose_strategy`. Each work decision states the approach, next assignment, expected evidence, review condition, alternative, and strongest concern. The controller validates the decision before dispatching work.

Workers use `ipython` by default. Set `tools: []` to disable it and supply `customTools` for an existing harness's operations. Custom tools are enabled for workers only and must honor their abort signal and await their own work. Add instructions through `initialContext` or `resourceLoader`. The loader's context files, skills, and prompts remain available; extension lifecycle hooks are excluded from managed sessions.

Workers finish each step with `report_result`. Reports contain claims about changes, observations, artifact paths, and unresolved questions. The controller separately saves actual tool outputs and assigns evidence IDs that either role can read. It does not turn a report into a verified measurement or execute artifact paths supplied by a model.

Each new run directory contains `history.jsonl`, native session transcripts under `sessions/`, and original tool outputs under `evidence/`. `onEvent` receives the recorded events in order. Observer exceptions do not change the run. Saved history supports inspection; restarting creates a new run.

## Limits and results

| Option | Default |
| --- | --- |
| `maxSteps` | 5 work steps |
| `maxWorkerTurns` | 12 assistant turns per step |
| `maxReviewTurns` | 3 assistant turns per review |
| `stepTimeoutMs` | 5 minutes per step or review |
| `runTimeoutMs` | 30 minutes for the run |

The host enforces these limits. The final work step still gets a review, but another work step cannot start after `maxSteps`. Cancellation stops model/tool activity and awaits cleanup before closing or replacing the session. A custom tool that ignores cancellation can delay cleanup; the controller will not start another worker while it remains active.

The loop disables nested delegation, goal/autonomous continuation, session-level automatic retries, and automatic refinement. Worker context compaction remains available. A session that ends without its structured result gets one correction within the remaining limits. An incomplete worker result goes back to review with its runtime status and partial evidence.

`stopReason` is `strategy_stop`, `limit_reached`, `cancelled`, or `error`. A strategist's assessment can describe completion or a reason to stop pursuing the task. It is not a verified pass/fail verdict; the calling harness owns that check. `usage` sums usage reported on assistant messages, including repeated context. It does not meter external jobs launched by tools.
