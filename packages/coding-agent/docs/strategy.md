# Strategy loop

`runWithStrategy()` runs one worker at a time and creates a fresh strategist session after each work step. The strategist chooses `start`, `continue`, `switch`, or `stop`. Continuing keeps the worker's conversation; switching creates a new conversation with the assignment and selected evidence. All workers use the same working directory, so files and edits remain available.

```typescript
import { runWithStrategy } from "@earendil-works/pi-coding-agent";

const result = await runWithStrategy({
  task: {
    objective: "Speed up the parser's slow path",
    successCriteria: "Existing checks pass and a recorded measurement shows an improvement",
    constraints: ["Keep the public API and accepted inputs unchanged"],
    initialContext: "The slow path handles large nested inputs.",
  },
  cwd: "/path/to/project",
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

Workers use `ipython` by default. Set `task.tools: []` to disable it and supply `task.createTools(context)` for an existing harness's operations. Custom tools are enabled for workers only and must honor their abort signal and await their own work. Add instructions through `task.initialContext` or `resourceLoader`. The loader's context files, skills, and prompts remain available; extension lifecycle hooks are excluded from managed sessions.

Workers finish each step with `report_result`. Reports contain claims about changes, observations, artifact paths, and unresolved questions. The controller separately saves actual tool outputs and assigns evidence IDs that either role can read. It does not turn a report into a verified measurement or execute artifact paths supplied by a model.

`createTools` runs once per run. Its `TaskContext` provides `runId`, `cwd`, `outputDir`, and the run cancellation signal. Bind external job ownership and history to `runId`; worker session IDs change on a strategy switch. Tool executions must use their per-call abort signal so work-step timeouts also cancel owned work.

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

## Task checks

A `TaskDefinition` contains the objective, success criteria, constraints, context, tools, and an optional `checkResult(work, context)` callback. The loop has no required metric or candidate format. A work step may inspect sources, test an assumption, find a counterexample, or produce an artifact.

The host calls `checkResult` after each work step has settled, including incomplete and failed steps. It receives a copy of the worker result and returns a `TaskCheck`:

```typescript
return {
  status: "inconclusive",
  summary: "The example contradicts one assumption, but the general claim remains open",
  details: "Original checker output or source-supported findings go here.",
};
```

Use `passed` when the task criteria have been established, `failed` when the checked criteria were not met, and `inconclusive` when evidence is insufficient. Execution exceptions, invalid check output, timeouts, and cancellation produce `error`; they do not establish a negative task result. Checkers should inspect trusted task state or artifacts themselves instead of accepting worker claims as proof.

The check shares the work step's time budget and must honor `context.signal` and await its own cleanup. A late result after cancellation is discarded. The loop waits for the callback to settle before reviewing or dispatching more work. As with custom tools, an uncooperative callback can delay cleanup.

Check output is saved as registered evidence with `source: "check"`, separately from `source: "tool"` receipts and the worker report. Each step exposes `check`; the run's `check` is the latest step's check, not an earlier passing result. Both roles receive the latest check and can inspect original evidence using `read_evidence`. A passing check does not automatically stop the strategist. If no step or checker ran, `check` is absent.

## Research harness integration

The [research task example](../examples/sdk/research-task.ts) connects the existing autoresearch controller through its public methods. Benchmark schemas stay in the example. Caller configuration fixes the benchmark scope, and `runId` owns jobs and lineage across worker switches.

With an existing controller and a checker for its measurements:

```typescript
import { createResearchTask } from "./research-task.js";

const task = createResearchTask({
  controller,
  scope: {
    lane: "compiler-gym",
    benchmarkIds: taskIds,
    budgetClass: "screen",
    treatment: "strategy",
  },
  objective: "Reduce instruction count while preserving program behavior",
  successCriteria: "The agreed verifier passes and the target instruction count is met",
  checkResult: (jobs, work, context) => checkMeasurements(jobs, work, context.signal),
});

const result = await runWithStrategy({ task, cwd: projectDirectory });
```

`controller`, `taskIds`, `checkMeasurements`, and `projectDirectory` are supplied by the calling harness. A succeeded evaluation job establishes that evaluation completed; the checker still decides whether the task's success criteria were met.

The worker can submit a candidate or recall all results in this run, including failed attempts and earlier workers. Submission waits for a terminal job state. On cancellation, the bridge requests cancellation of that job and awaits its terminal state before returning. The controller must report terminal state only after the evaluator's work and cleanup have settled. Each job remains subject to the controller's own resource limits; strategy usage does not meter external compute.

`stopReason` is `strategy_stop`, `limit_reached`, `cancelled`, or `error`. A strategist's assessment can describe completion or a reason to stop pursuing the task. It is separate from the host-owned `check`. The command-line runner supplies no checker, so its assessment alone does not establish verified completion. `usage` sums usage reported on assistant messages, including repeated context. It does not meter external jobs launched by tools.
