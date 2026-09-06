# Minimum-overlap strategy comparison

One bounded comparison of Prime's strategy loop and a continuous worker, starting from the same saved construction for the [Erdős minimum-overlap problem](https://github.com/teorth/optimizationproblems/blob/9d57db86c8564cb623ec9f9e41429a34efd819fb/constants/1b.md). The strategy loop uses fresh reviews and can replace its worker. The control keeps one worker across the same work-step boundaries.

Both arms receive eight minutes, twelve model requests, three work steps of four assistant turns, 150,000 reported tokens including cached input and review, and 1.2 MB of cumulative model input. A response can exceed the remaining token allowance; no further request is then allowed. Arm order is randomized. A runtime failure or missing usage stops the remaining comparison. There are no automatic retries.

Success requires a submitted, exactly feasible construction whose score is at least `1e-9` below the frozen baseline. The checker uses integer arithmetic and checks every signed grid shift; linearity between grid shifts makes this the continuum supremum for the submitted step function. A strategist assessment is not a verified improvement. One pair cannot establish general superiority or optimality.

## Starting data

`source.json` preserves the public numeric vector from [EinsteinArena submission 2507 by CodexProLong](https://einsteinarena.com/api/solutions/best?problem_id=1&agent_name=CodexProLong&limit=1), submitted August 15, 2026 and retrieved September 6, 2026. Its SHA-256 is `33422e43982bb38969e63e3758296f9d9f14e2512447da86d0fcee411eb4a90b`. This is a frozen starting artifact, without a claim that it remains the best public result.

Preparation verifies the source hash and repairs its small decimal mass excess at one bin. It records the exact repair and its score-change bound, then independently scores the 3,584 bins using Python integers. The TypeScript checker verifies the same reduced fraction, approximately `0.3808585748578584`. Submitted candidates receive no host-side clipping, normalization, or feasibility tolerance.

## Prepare and check

Install the repository dependencies and have Docker available. The existing research image supplies Python, NumPy, and SciPy; containers run offline with one CPU and 2 GiB. Build it from the repository root if it is not already available:

```sh
docker build -f packages/coding-agent/examples/sdk/heilbronn.Dockerfile -t prime-overlap .
docker image inspect prime-overlap --format '{{.Id}}'
```

Use the returned immutable image ID for `--image`. Set `DOCKER` to the Docker executable path if it is not `/usr/local/bin/docker`.

Run the following from `packages/coding-agent`. Replace `/tmp/prime-overlap` with an output directory outside the checkout and `sha256:IMAGE_ID` with the image ID. Baseline preparation refuses to overwrite an existing file.

```sh
mkdir -p /tmp/prime-overlap
python3 ../../research/strategy/minimum-overlap/checker/prepare-baseline.py --output /tmp/prime-overlap/baseline.json
npx tsx --tsconfig ../../tsconfig.json ../../research/strategy/minimum-overlap/checker/overlap.test.ts
npx tsx --tsconfig ../../tsconfig.json ../../research/strategy/minimum-overlap/checker/verify-baseline.ts /tmp/prime-overlap/baseline.json
npx tsx --tsconfig ../../tsconfig.json ../../research/strategy/minimum-overlap/run.mts --seed-file /tmp/prime-overlap/baseline.json --image sha256:IMAGE_ID --output-dir /tmp/prime-overlap/checks --dry-run
python3 ../../research/strategy/minimum-overlap/cancellation.test.py --seed-file /tmp/prime-overlap/baseline.json --image sha256:IMAGE_ID --output-dir /tmp/prime-overlap/checks
```

`--dry-run` uses Prime's faux provider and real containers. It checks both arms, saved submissions, and rejection of tool execution after a terminating report. The cancellation test injects cancellation or an expired deadline before candidate acceptance and verifies that neither produces an accepted receipt. These checks make no model requests. `--preflight-only` checks only the container and baseline.

## Run

Omitting `--dry-run` makes real model requests with Prime's configured authentication. The default is `openai-codex/gpt-5.5` at high reasoning effort. Confirm that Prime is configured for the account intended to fund the comparison before launching it.

```sh
npx tsx --tsconfig ../../tsconfig.json ../../research/strategy/minimum-overlap/run.mts --seed-file /tmp/prime-overlap/baseline.json --image sha256:IMAGE_ID --output-dir /tmp/prime-overlap/runs
```

Each invocation prints a new output directory containing the protocol, source hashes, native transcripts, strategy history, command records, candidate checks, container snapshots, and results. `status.json` tracks progress; `results.jsonl` contains completed arm summaries. Interrupting the process cancels active work and awaits container cleanup. A failed or incomplete pair remains incomplete; inspect its saved failure before deciding whether to authorize a new run.
