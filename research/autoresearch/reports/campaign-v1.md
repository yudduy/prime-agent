# Prime Agent verifier-separated autoresearch

## CPU ablations, runtime integrity, and GPU-lane qualification

Decision report v1  
Date: 2026-08-30 UTC  
Prime Agent commit: `bc0fa7606abb3b7af0f765319518d255e6ae553d`  
NanoGPT speedrun artifact: `38e258afefb1ce206dd7595aa71d7740da405742`

## Executive decision

The campaign built and exercised a verifier-separated asynchronous research sidecar, but it did **not** show that any tested agent-facing Prime Agent harness feature improves research performance.

The contemporaneous native-stock versus typed-interface screen was inconclusive across three valid matched pairs: one favored typed, one favored stock, and one split by task under the frozen scalar selector. A whole-Pareto sensitivity found that a non-selected stock point in the mixed pair strictly dominated the typed frontier. This does not retroactively change the frozen decision, but it shows why task vectors and complete frontiers must remain authoritative.

The runtime now closes a fixed-budget trajectory in the host after four candidates, so assistant `CHAMPION` prose is advisory and no fifth paid response is required. A read-only replay preserved all seven historical selections and qualified all 56 verified task measurements; the formerly invalid arm remains historically invalid rather than being rewritten.

The first clean host-owned feature ablation tested a concise model-visible evaluator projection against full feedback. Concision reduced feedback bytes by 86.5%, input tokens by 54.2%, total tokens by 32.1%, and modeled cost by 20.0%. It nevertheless failed the preregistered quality gate: the full-feedback control frontier at `1,925 / 13,676` strictly dominated concise at `1,962 / 14,103`. The treatment is stopped after one randomized directional pair; this is a preregistered negative pilot, not an estimate of causal harm.

The earlier strongest isolation-grade memory experiment was sealed v7: typed, branch-local measured-evidence recall (`M`) versus control. Both arms produced the same candidate sequence and verified task values. `M` used 15.7% fewer output tokens, but 19.3% more total tokens and 19.2% greater modeled cost, with no evaluator-call reduction. It failed promotion.

Earlier exploratory results were also non-promoting. Controlled width (`W`) shortened critical-path time but produced worse solutions. The implemented retest/re-ablation treatment (`R`) generated diagnostic evidence without a better champion, and a separate frozen 2x2 resurrection gate found zero conditional benefit from the candidate component. Sparse sharing (`S`) was correctly not run because its prerequisites were not promising.

KernelBench-Verified and NanoGPT execution paths were qualified independently on FarmShare L40S hardware. NanoGPT now has two distinct operational artifacts: historical unscored smoke job `1701170` and production candidate-specific scored-apparatus smoke job `1703802`. Neither is treatment transfer or a frontier point. Full stock score-1 job `1703804` is pending and contributes no result. Since no agent-facing treatment passed the CPU gate, spending GPU time on treatment transfer or drawing a NanoGPT frontier would not be scientifically justified.

The valid current result is:

> No tested agent-facing harness feature beat stock Prime Agent. The infrastructure is viable; the present sidecar research interface has not yet recovered stock Prime's descriptive CPU search quality.

A later no-model systems series also rejected persistent warm transport as the next speed lever. It preserved every C1–C4 request, metric, verifier verdict, lineage edge, and budget field, but took `194.673 s` against `124.793 s` for the matched stock-cold path (`1.560x`). The preregistered decision is `keep-stock-cold`; no paid warm-transport trajectory is justified.

The replacement systems gate was one sealed, no-model C1 control-plane-consolidation qualification. After BatchMode authentication and preflight passed, the runner submitted its one allowed held root and then failed before release or candidate publication: FarmShare returned the exact one-node range as `NumNodes=1-1`, while the frozen parser required the raw string `1`. Cleanup-only recovery hit the same assertion. Exact manual cancellation then verified the root absent and `CANCELLED` with zero allocated CPUs, elapsed allocation time, or CPU time. This post-submit failure is terminal under the preregistration: there is no retry, replacement, C1–C4 screen, provider call, or GPU use, and candidate-scoped job-step transport is killed.

The next stock-cold hypothesis exposed a compact per-action IR-instruction delta trace. Its no-model qualification passed exact metric, verifier, trace, projection, and overhead gates over eight fresh allocations. The first paid screen then stopped on a cross-language numeric-spelling defect after one valid S12 evaluation. A fresh, hash-bound v2 attempt reached two verified candidates: S12 at `1,970 / 13,838`, then an adaptive 25-action candidate at `1,958 / 13,751`. Its third model response proposed 47 actions and was rejected locally against the frozen `1..46` policy before evaluation. Because treatment randomized first and terminated, there is no control arm or trace-effect comparison. The result is durable negative policy evidence, not an apparatus retry opportunity or a CPU promotion.

Two later low-cost decision screens did not change that result. A broad late-stage Pareto-summary idea failed its model-free headroom gate at `3/21 = 14.2857%`, below the declared 20% minimum, before implementation or model/evaluator spend. A development-informed structural-novelty reconstruction found a 42.857-point domination-rate gap, but weak Fisher sensitivity and strong protocol confounds restricted it to a four-call faux wiring check. That check passed exact arm isolation and call-four delivery; it is apparatus evidence only, not a live or paid treatment result.

A separately preregistered late-novelty paid screen then produced two terminal apparatus outcomes. V1 stopped in pre-provider source-closure validation before an attempt lock or paid/evaluator work; contemporaneous console output identified a duplicate implementation path, but that exception text is not persisted in the one-event ledger. Fresh v2 randomized treatment first and made exactly one Luna `xhigh`/priority dispatch. The model returned the exact frozen S12 tool request once, but the first evaluator failed before an accepted measurement. A later read-only `sacct` observation identified Slurm `1703304`, `FAILED/3:0`; that scheduler identity is not embedded in the sealed local artifact. The old adapter retained only a generic failure and lost the underlying raw stdout/stderr. No control, call-four guidance exposure, compaction, comparison, or treatment result exists, and the paid attempt lock forbids a retry.

Three zero-model cold diagnostics then separated scheduler health from environment integrity. Slurm was scheduling immediately; the first job exposed missing Gym sources, the second exposed a compatibility tree truncated from 2,749 to 1,247 entries, and the third passed after the pinned payloads were restored. Job `1703328` reproduced empty-pass blowfish at `3,898` IR and `16,573` object-text bytes and passed the frozen environment seal plus all 20 semantic callbacks; a later read-only `sacct` observation reported `COMPLETED/0:0`. This restores the CPU apparatus operationally; it does not convert the failed paid screen into a scientific result.

Future typed adapter failures now keep model-visible errors sanitized while persisting raw stdout/stderr and host-only error evidence as content-addressed run-manifest artifacts. That prospective hardening is sealed into the implementation inventories and tested, but it cannot reconstruct v2's missing raw bytes.

Prospective late-novelty runner/preregistration protocol v2 also moves the exact frozen environment probe into `before_provider_request`. Every attempted paid transport first runs a read-only login-node SSH probe under the pinned Python/cache/site/library paths; no `srun` or `sbatch` is permitted. Ordered host-only records bind pass or failure to arm and provider ordinal. A failed probe leaves actual provider transport and evaluator counts at zero. This was faux-tested only and requires a fresh preregistration; no existing lock, result, verifier epoch, or live cluster state changed.

An additive home-bundle builder was prepared to move the recovered payload out of cleanup-prone scratch. Its hash and fail-closed regression suite passed 5/5 locally. Contemporaneous remote command output, not persisted in a campaign artifact, reported `EDQUOT` while creating the parent before a staging directory or path switch existed. The active evaluator therefore still uses the recovered scratch tree; no durable migration is claimed.

A later zero-model screen tested whether the stock prompt's 26 visible LLVM flags leave measurable search headroom among all 124 legal actions. V1 stopped before its environment probe, attempt lock, scheduler query, or allocation because the runner asked the trusted-file backend for an overbroad read bound. Its ledger records zero dispatches. The exact-byte repair was regression-tested, and the fresh v2 namespace made the sole scientific dispatch as Slurm `1703490`.

The v2 raw evaluator payload completed the exact 98-flag dijkstra sweep. Five flags cleared the raw `max(3 instructions, 0.5%)` prefilter; the declared early-positive schedule then verified `-early-cse-memssa` at `292 -> 260` IR and `-early-cse` at `292 -> 269`, each over all 20 callbacks. The frozen result assessor accepts that payload in isolation. The runner nevertheless admitted no result: root and extern accounting reported four logical CPUs rather than the preregistered exact two, although the actual evaluator step remained one CPU/one task and completed `0:0`. Later read-only diagnosis found that `--mem=8G` exceeded the 4,000 MiB-per-CPU ceiling, raising the request to three CPUs and whole-core allocation rounding it to four. That scheduler mismatch is orthogonal to the IR and callback observations, but it cannot be relaxed post hoc. The 29-event ledger ends terminal apparatus-invalid, cleanup proves the job completed and left the queue, and the attempt lock forbids a rerun. The raw signal is non-admitted exploratory decision evidence, not a passed gate, verified frontier point, treatment result, or GPU/NanoGPT authorization.

That non-admitted signal motivated one genuinely new, separately preregistered first-proposal visibility pair. Its shared zero-model S12 gate first reproduced the frozen two-task metrics exactly: blowfish `1,970` IR and `21,501` object bytes; bzip2 `13,838` IR and `166,545` object bytes; all 20 callbacks passed for each task. The pair then made exactly one subscription-backed Luna request and one successful tool execution per arm. Stock-26 control measured blowfish `1,960` IR / `22,380` object bytes and bzip2 `14,080` IR / `172,685` bytes. Full-124 treatment uniquely used 19 flags omitted from the control guide but measured blowfish `1,971` IR / `23,040` bytes and bzip2 `14,268` IR / `181,907` bytes. Control was strictly better on both authoritative IR tasks, so the frozen decision is `directional-loss` and the screen stops.

The complete run used six unique FarmShare CPU allocations: shared S12 jobs `1703515` and `1703516`, control jobs `1703519` and `1703520`, and treatment jobs `1703521` and `1703522`. Both arms recorded exactly one real provider dispatch, one tool call and execution, and one locally blocked `provider-call-limit` continuation whose durable assistant record has exactly zero usage. The requests used `openai-codex/gpt-5.6-luna`, `xhigh`, with locally requested `priority`; the upstream response did not acknowledge a service tier. The order was sampled locally as control then treatment, but there was no external precommitment or tamper-evident assignment. The result therefore explicitly sets randomized inference, causal claims, default promotion, GPU promotion, and NanoGPT promotion to false.

A later model-free systems qualification exercised a blowfish-first proxy cascade through production-default code with no dependency injection. It made eight fresh one-task CPU allocations: four blowfish measurements, bzip2 measurements for selected candidates 2 and 3, and hidden audit-only bzip2 measurements for omitted candidates 1 and 4. The complete frontier remained `[3]` and champion 3 was retained. All 24 root/extern/step Slurm rows were `COMPLETED/0:0`, the terminal queue was empty, and there were zero failures, retries, replacements, reused measurements, models, providers, RLM children, or GPUs. This qualifies live wiring only. The actual audit ran all eight allocations; six versus eight is a counterfactual 25% allocation-count reduction, not an observed compute, time, latency, agent, default, GPU, or NanoGPT improvement.

A distinct, separately preregistered resource screen then made the six-versus-eight schedule prospective and order-balanced. Block 1 ran full control then cascade, measuring `84.477934 s / 198` evaluator-step CPU-seconds versus `54.664385 s / 136`; block 2 reversed the order, measuring cascade `52.682669 s / 126` versus control `82.121875 s / 188`. Median cascade/control wall ratio was `0.6443014367`, median absolute saving was `29.6263775 s`, and median evaluator-step CPU ratio was `0.6785407264`. All four arms reproduced the exact metrics, verifier results, frontier `[3]`, and champion 3; both cascade arms selected candidates `[2, 3]` from their own fresh blowfish measurements. The 28 fresh unique CPU allocations produced 84 exact terminal accounting rows with maximum evaluator concurrency two and no failure, retry, replacement, reuse, model, provider, tool, RLM, compaction, or GPU work. This passed the model-free resource-feasibility gate and qualified one separately preregistered paid directional campaign. That follow-up was attempted and closed apparatus-invalid. The model-free result is not evidence of an agent-performance effect, default improvement, GPU transfer, or NanoGPT progress.

That paid proxy-cascade campaign was attempted twice and is now closed without an admissible comparison. V1 exposed a provider-response guard defect and terminated apparatus-invalid. Fresh v2 completed both online arms with eight subscription-backed Luna transports, eight tool calls, and 14 durable online measurements, then failed while admitting the two post-terminal hidden treatment audits. Read-only Slurm accounting shows that all 16 physical allocations and their evaluator `.0` steps completed `0:0`; for hidden jobs `1703771` and `1703772`, only the `.extern` containment step ended one second after the root row. The frozen host adapter incorrectly applied evaluator-step temporal containment to `.extern`. V2 therefore remains `assessment=null` and `liveScientificEvidenceEligible=false`; its online measurements are apparatus diagnostics only, not a directional result, frontier, resource-quality finding, replication, or promotion signal. The preregistered second-apparatus-failure rule forbids v3.

The prospective apparatus now treats `.extern` according to its cleanup role while preserving exact row shape, node, terminal state, timestamps, per-row bounds, and strict root containment for the evaluator `.0` step. It records each Slurm ID immediately and durably preserves running/failed states, raw streams, host evidence, ordered aggregate children, and failure-path session-integrity seals. A fresh zero-model qualification exercised the exact concurrent hidden-audit path: jobs `1703787` and `1703788` overlapped, both exact root/extern/step triples completed `0:0`, and both passed all 20 semantic callbacks. This validates only the repaired apparatus; it does not rescue v1/v2 or authorize another paid trajectory.

## Why the benchmark plan changed

FarmShare is suitable for queued overnight validation but not as a guaranteed synchronous propose-measure-update loop. In a live snapshot at `2026-08-28 20:47–20:50 PDT`, 13 of 24 L40S devices were physically unallocated, yet `srun --test-only` predicted an approximately eight-hour wait for either one or four GPUs. A small CPU request was immediately schedulable. The active GPU QoS allowed four jobs and four GPUs. Physical idleness and scheduler availability are therefore different quantities; this time-stamped observation may drift and is not an immutable campaign artifact.

In a later CPU recovery snapshot at `2026-08-29 17:11–17:27 PDT`, three diagnostic allocations started promptly on `barley-01`; the final one completed in ten seconds and the user queue was empty. At `17:43 PDT`, a separate one-L40S ten-minute `srun --test-only` projected start at `2026-08-31 15:55 PDT`, roughly 46 hours later; no GPU job was submitted. CPU recovery therefore does not make the GPU lane synchronous. The CPU failures were inside the extracted CompilerGym filesystem, not Slurm admission. Old upstream mtimes and the deletion pattern make nightly scratch cleanup the leading explanation, but that cause is inferred rather than directly observed.

The campaign uses three lanes as a gated funnel, not as interchangeable substitutes:

| Lane | Hardware | Decision role |
|---|---|---|
| CompilerGym/cBench | FarmShare CPU, locally orchestrated | Fast surrogate screen for harness ablations and CPU promotion gates |
| KernelBench-Verified | Queued one-GPU L40S jobs | Optional verifier and GPU-transfer stress after a CPU promotion |
| NanoGPT Track 3 | Queued one-GPU L40S jobs | Direct confirmatory estimand and final expensive validation |

The controller can continue CPU search while GPU measurements are pending, then append delayed results to the same evidence model. It now limits KernelBench plus NanoGPT to four aggregate in-process jobs, matching the current one-GPU-per-job QoS design, while leaving CPU progress independent. A faux regression validates the cap and exact-once delayed merge; Slurm remains authoritative across other controller processes. Queue time remains a reported resource rather than disappearing from the experiment.

The original 24-hour NanoGPT stock trajectory was not run. The benchmark pivot added a stock Prime CPU smoke baseline for fast iteration; it did not replace NanoGPT as the target benchmark. A production scored adapter, verifier, SSH/Slurm transport, remote worker, full 3,290-step stock recipe, and staged stock driver now exist. Candidate-specific smoke job `1703802` passed; full score-1 job `1703804` is pending and is not yet evidence. No treatment run or eight-seed replay has completed.

## System and repository map

Prime Agent is the inner runtime, not the experiment authority.

```text
model subscription
      |
      v
packages/ai             provider transport, model/tool event normalization
      |
      v
packages/agent          stateful turn and tool-execution loop
      |
      v
packages/coding-agent   sessions, Python kernel, RLM children, compaction,
                        extensions, goals, daemon continuity, TUI integration
      |
      +------> packages/tui  terminal rendering and input primitives
      |
      v
research/autoresearch   opt-in verifier-separated sidecar
      |
      +------> append-only hash-linked ledger + content-addressed artifacts
      +------> typed submit/status/recall/compare boundary
      +------> budgeted controller and deterministic CPU reuse contract
      +------> CompilerGym CPU / KernelBench GPU / NanoGPT GPU adapters
```

| Area | Existing responsibility | Campaign use or change |
|---|---|---|
| [`packages/ai`](../../../packages/ai) | Provider registry, normalized streams, tools, usage, and model handoff | Live ChatGPT subscription transport; pre-dispatch abort and exact retry control; omit unsupported Codex `max_output_tokens`. |
| [`packages/agent`](../../../packages/agent) | Stateful model/tool loop and event stream | Unmodified inner turn runtime. |
| [`packages/coding-agent`](../../../packages/coding-agent) | Durable JSONL sessions, persistent Python, RLM, compaction, SDK, daemon recovery, extensions | Stock baseline and live integrity canaries; a faux-provider regression verifies continuation abort before a paid dispatch. |
| [`packages/tui`](../../../packages/tui) | Differential terminal rendering and interactive components | No experiment-authority role and no campaign change. |
| [`research/autoresearch`](..) | New private sidecar | Frozen campaign schema, strict canonical ledger verification, host-owned terminalization, Pareto comparison, typed operations, adapters, analyzers, tests, reports, and the production NanoGPT scored protocol/adapter/transport/worker/stock driver. |

The sidecar deliberately does not change default Prime behavior or the daemon protocol. The agent proposes candidate material; it cannot write accepted metrics, verifier configuration, evaluator jobs, or prior evidence. The controller is the single writer for an append-only hash-linked JSONL ledger and stores referenced bytes by content digest.

The main contracts are in [`types.ts`](../src/types.ts), controller and budget enforcement in [`controller.ts`](../src/controller.ts), ledger integrity in [`ledger.ts`](../src/ledger.ts), content-addressed storage in [`artifact-store.ts`](../src/artifact-store.ts), typed operations in [`tools.ts`](../src/tools.ts), and the frozen campaign declaration in [`campaign.ts`](../src/campaign.ts). The production NanoGPT path is split across the prospective [`nanogpt-scored-amendment.ts`](../src/nanogpt-scored-amendment.ts), [`nanogpt-scored-protocol.ts`](../src/nanogpt-scored-protocol.ts), [`nanogpt-scored-adapter.ts`](../src/nanogpt-scored-adapter.ts), [`nanogpt-scored-transport.ts`](../src/nanogpt-scored-transport.ts), [`nanogpt-scored-stock.ts`](../src/nanogpt-scored-stock.ts), and remote [`nanogpt_scored_worker.py`](../evaluators/nanogpt_scored_worker.py).

## Claim boundary

| Evidence class | Meaning |
|---|---|
| Verified measurement | The frozen verifier accepted the measurement and the ledger/artifact integrity path was checked. |
| Verified operational | A runtime mechanism worked; no research-performance claim follows. |
| Descriptive | A valid measurement exists without a matched causal comparison. |
| Non-admitted observation | Raw sealed bytes pass a scientific parser or verifier, but the native attempt failed another frozen admission contract. The observation may guide a new hypothesis but cannot become a result or frontier point. |
| Negative | A declared mechanism or promotion gate was missed. |
| Unrun | No eligible measurement exists; no claim is made. |

The v5 and v7 analyzers verify each source ledger's hash chain and re-read candidate, stdout, and stderr artifacts from the content-addressed store. They do not treat convenience `result.json` files as authoritative evidence.

## Campaign-level result

| Question | Status | Finding |
|---|---|---|
| Does the paid Luna subscription path work? | Verified operational | Live `openai-codex/gpt-5.6-luna`, `xhigh` calls completed over SSE with locally requested `priority`. The upstream response did not acknowledge service tier. |
| Are typed tools durable and deduplicated? | Verified operational | Submit, status, and recall succeeded; durable restart produced zero redispatch; an exact duplicate submission was recognized. |
| Does evidence survive compaction without leaking into the control? | Verified operational in sealed v7 | Both arms used the same evidence-free sealed summary. The treatment recovered branch-local measurement evidence only through typed recall. |
| Does `M` improve research? | Negative | Exact quality and evaluator-call tie; higher total tokens and modeled cost. |
| Does `W` improve research? | Negative exploratory | Lower critical-path time, worse verified quality on both search tasks. |
| Does `R` improve research? | Negative exploratory | Diagnostic information only; no better champion; independent resurrection gate failed. |
| Does the typed whole interface preserve native-stock quality? | Inconclusive directional screen | Three valid pairs split typed-positive, stock-positive, and task-wise mixed; the V4 whole-Pareto sensitivity favored stock. |
| Can fixed-budget trajectories close without a fifth model call? | Verified operational | Host-owned selection preserved all historical selections; new live arms used exactly four provider calls and one intentional host stop. |
| Does concise measured feedback preserve research quality? | Negative directional screen | The compression and integrity gates passed, but full feedback strictly covered concise on the complete two-task frontier. |
| Does persistent warm transport beat stock cold execution? | Negative matched systems gate | Exact semantic and accounting parity; warm `194.673 s` versus cold `124.793 s`. Keep stock cold. |
| Does candidate-scoped control-plane consolidation pass C1? | Terminal infrastructure negative | One held root was submitted exactly once, but strict `NumNodes` representation parsing failed before release or candidate publication. Native recovery failed on the same assertion; exact manual cleanup verified cancellation and zero allocation. The preregistered transport kill fired. |
| Is per-action IR-delta feedback measurement-safe and cheap enough to expose? | Verified operational | Eight fresh allocations preserved exact terminal metrics and 20/20 verifier callbacks; median treatment/control runtime ratio was `0.996886`, maximum `1.021607`, and the added projection was 2,039 bytes. |
| Does visible IR-delta feedback improve Luna search? | Unresolved; terminal screen evidence | V1 was apparatus-invalid before adaptive feedback. V2 produced two verified treatment candidates, then violated the frozen 46-action cap. No control arm ran, so no treatment-effect claim or promotion is allowed. |
| Does broad late-stage Pareto-summary injection have enough headroom? | Negative model-free screen | Only `3/21 = 14.2857%` of the development cases met the proposed opportunity condition, below the declared 20% gate. It was killed before implementation, evaluator work, or model calls. |
| Does lower ordinal-four structural similarity predict improvement? | Retrospective, faux-only | Low Dice-LCS transitions dominated in 5/7 cases versus 2/7 high-similarity cases, but Fisher sensitivity was weak and protocol/selection confounds preclude a treatment claim. Only four-call faux wiring was authorized and tested. |
| Does late-novelty guidance improve Luna search? | Unresolved; terminal apparatus screen | V1 stopped pre-provider. V2 made one exact paid S12 tool round trip, then its first treatment evaluation failed before an accepted measurement; later diagnostics found the FarmShare environment damaged. No accepted measurement, guidance exposure, control arm, or comparison exists. |
| Is the current CompilerGym CPU evaluator healthy? | Verified operational at one zero-model smoke | After two diagnostic failures and pinned-payload restoration, Slurm `1703328` passed the frozen operational environment seal, empty-pass blowfish measurement, and all 20 callbacks. This is not a research baseline. |
| Are raw evaluator failures durable without model leakage? | Verified prospectively in tests | Typed adapter failures expose a sanitized message to the model while the controller stores host-only error evidence and raw streams by digest. The behavior was added after late-novelty v2 and cannot recover its missing streams. |
| Can an environment failing the frozen live seal spend a future paid call? | Prevented prospectively in faux | Runner/preregistration v2 records a sealed read-only FarmShare probe before each provider transport. The failure regression leaves actual faux transport, provider counters, downstream guard, and evaluator calls at zero; unprobed or transient evaluator failures remain possible. |
| Do legal actions omitted from the stock 26-flag guide have measurable headroom? | Terminal apparatus screen with non-admitted signal | The sole v2 job swept all 98 omitted flags and its raw payload found two distinct 20/20-verified dijkstra improvements. Root accounting was four logical CPUs instead of the frozen exact two, so the runner admitted no result and the attempt cannot be repeated or promoted. |
| Does showing all 124 legal flags improve Luna's first verified proposal? | Negative directional screen | The shared S12 apparatus gate passed. Control produced `1,960 / 14,080`; treatment used 19 uniquely guide-omitted flags but produced `1,971 / 14,268`, so control strictly dominated. The preregistered decision is `directional-loss`; no randomized/causal/default/GPU/NanoGPT claim is allowed. |
| Does the blowfish-first proxy cascade execute correctly under production defaults? | Verified operational, model-free only | Eight fresh unique CPU allocations completed as 4 blowfish + selected 2/3 bzip2 + hidden omitted 1/4 bzip2 audit. Frontier `[3]` and champion 3 were retained. This validates wiring and exact accounting only; the 25% figure is counterfactual allocation count, not an observed resource, latency, agent, default, GPU, or NanoGPT improvement. |
| Does the proxy cascade reduce prospective fixed-batch CPU resource and feedback-ready wall cost? | Positive model-free counterbalanced systems screen | Two AB/BA blocks retained exact metrics, verifiers, frontier `[3]`, and champion 3. Median cascade/control wall ratio was `0.6443014367`, median saving `29.6263775 s`, and median evaluator-step CPU ratio `0.6785407264`. Its one paid follow-up was attempted and closed without an admissible comparison; no agent/default/GPU/NanoGPT claim follows. |
| Does the proxy cascade improve Luna search under the paid directional protocol? | Unresolved; campaign terminal apparatus-invalid | V1 failed its provider-response guard. V2 completed both online arms but failed admission of both required hidden audits because `.extern` outlived root by one second. `assessment` is null, scientific eligibility is false, and the second-apparatus-failure stop closes the campaign. The 14 online measurements are diagnostics only. |
| Is the repaired concurrent hidden-audit path operational? | Verified operational, zero-model only | Fresh overlapping Slurm jobs `1703787` and `1703788` passed exact root/extern/step accounting and 20/20 semantic callbacks with zero model, provider, or agent-session calls. This is not scientific treatment evidence or paid-dispatch authorization. |
| Is aggregate GPU-lane capacity bounded? | Verified operational in faux | Three KernelBench jobs plus one NanoGPT job occupied the four-job cap, a fifth GPU job waited while CPU completed, and the fifth ran and merged once after release. No live combined-lane campaign ran. |
| Is KernelBench GPU evaluation ready? | Verified operational | Positive candidate passed four hidden configurations; wrong-output candidate was rejected on all four. |
| Is NanoGPT L40S execution ready? | Verified operational under the production scored verifier | Candidate-specific `smoke-10` job `1703802` completed `COMPLETED/0:0`, passed exact source, scheduler, hardware, count, and archived-log verification, and reconciled without redispatch. It remains unscored, frontier-ineligible, and record-ineligible. Historical job `1701170` remains separate unscored infrastructure evidence. |
| Did a treatment transfer to GPU? | Unrun by gate | No CPU treatment qualified. |
| Is there a scored NanoGPT frontier? | No; score-1 pending | Job `1703804` has no accepted result yet. There are zero record-eligible points and no treatment or eight-seed replay. |

## Goal completion matrix

| Campaign requirement | Status | Boundary |
|---|---|---|
| Unmodified Prime/Luna baseline | Partial | A 173-second, four-candidate stock CPU smoke and the production candidate-specific NanoGPT scored-apparatus smoke are verified. The planned 24-hour NanoGPT trajectory is unrun, and full score-1 job `1703804` remains pending/non-evidence. |
| Fast CompilerGym ablations | Verified negative or terminal at smoke stage, with one positive model-free resource screen | `M`, `W`, `R`, concise feedback, task fusion, broad Pareto summary, and warm transport did not promote; `S` was correctly gated off. C1 failed terminally before measurement. IR-delta observation qualified operationally, but its paid treatment arm terminated on policy before control. Late novelty reached one live paid tool call but terminated on evaluator apparatus before an accepted measurement or control. The complete-action-space screen produced a non-admitted raw headroom signal; its separately preregistered visibility pair completed and returned a directional loss. The proxy cascade passed a two-block model-free resource gate; its paid campaign was then attempted twice and closed apparatus-invalid without a scientific comparison. No causal confirmation stage ran. |
| Verifier-separated evidence controller | Verified operational | Typed submit/status/recall/compare, immutable measurement append, deduplication, restart, and compaction recall are exercised. |
| CPU work while GPU evidence is pending | Faux-verified shared-capacity primitive | The controller caps aggregate GPU-lane work at four, holds a fifth GPU job, completes CompilerGym independently, then admits and merges the delayed job exactly once after a permit releases. No real combined-lane campaign run exists. |
| KernelBench transfer subset | Unrun | One fixed-candidate L40S verifier qualification is not a 20–50-task treatment transfer. |
| NanoGPT confirmation | Apparatus verified; score pending | Historical unscored job `1701170` and production candidate-specific scored-apparatus job `1703802` are complete. Full stock score-1 job `1703804` is pending; no threshold result, score-3 widening, treatment, or eight-seed replay exists. |
| Frontier deliverables | Partial | Reproducible task-local CPU CSV/SVG frontiers exist. NanoGPT time, token, evaluator-call, and GPU-hour frontiers have no eligible points. |
| Rigorous report bundle | Deterministic final gate | Markdown/HTML synchronization and local citation hashing are enforced by the campaign bundle verifier after every Markdown change; bundle currency is established by the generator/check result, not by this narrative. |

Operational proofs: [multi-lane controller regression](../test/multi-lane-controller.test.ts), [campaign bundle verifier](../src/campaign-report-bundle.ts), and [bundle tamper regression](../test/campaign-report-bundle.test.ts).

## Stock Prime CPU baseline

The stock-core smoke used the pinned Prime commit, native `ipython`, no autoresearch tools, and disabled extensions, skills, goals, templates, themes, and context files. Source and Prime core integrity remained stable.

| Field | Result |
|---|---:|
| Model | `openai-codex/gpt-5.6-luna`, `xhigh`, locally requested `priority` |
| Candidate evaluations | 4 |
| Logical task evaluations | 8 |
| Champion digest | `03eba60a7f28...` |
| Blowfish | 1,937 IR, 49.69% of empty-pass calibration |
| Bzip2 | 13,706 IR, 47.68% of empty-pass calibration |
| Output / total tokens | 4,948 / 47,435 |
| Modeled cost | 0.108408 |
| Calendar time | 172.995 s |
| Source integrity | Passed |

Evidence: [stock result](../../../.autoresearch/stock-cpu-baseline/2026-08-28-v3-v2-sealed/result.json) and [stock evaluation ledger](../../../.autoresearch/stock-cpu-baseline/2026-08-28-v3-v2-sealed/evaluation/evidence.jsonl).

This champion strictly dominates the sealed v7 champion on the declared IR objective. That is descriptive evidence that the sidecar protocol has not surpassed stock Prime; it is not proof that the sidecar harms performance. The prompt, action guide, tool interface, and evaluation depth differ.

## CPU ablations

| Feature | Evidence grade | Control to treatment quality | Resource effect | Decision |
|---|---|---|---|---|
| `M`, sealed typed recall | Isolation-grade smoke, one matched pair | Blowfish 2,091 to 2,091; bzip2 16,559 to 16,559 | 6 to 6 task evals; output -15.7%; total tokens +19.3%; cost +19.2% | Do not promote |
| `W`, two half-depth branches | Exploratory v5 smoke | Blowfish 2,047 to 2,161; bzip2 14,893 to 17,665 | 8 to 8 task evals; output -46.0%; critical path -61.2% | Quality-for-time tradeoff; do not promote |
| `R`, forced leave-one-out | Exploratory v5 smoke | 2,091/16,559 to the same result | 8 to 8 task evals; output +9.0%; wall +6.5% | Mechanistic only; do not promote |
| `R` resurrection 2x2 | Frozen evaluator-only qualification | `X` changed neither task before or after `E` | 4 submissions, 8 task evals | Gate failed |
| `S`, sparse sharing | No experiment | Unrun | Unrun | Correctly gated off |
| Native stock vs typed interface | Three valid matched directional pairs | Typed positive, stock positive, then task-wise mixed | 56 fresh task measurements across seven attempted arms | Inconclusive; no promotion |
| Concise evaluator feedback | One randomized typed-vs-typed pair | Full `1,925/13,676`; concise `1,962/14,103` | Feedback -86.5%; total tokens -32.1%; cost -20.0% | Quality kill; do not replicate |
| Visible per-action IR deltas | Model-free qualification plus two terminal paid attempts | V2 treatment: S12 `1,970/13,838`, adaptive `1,958/13,751`; no control | 3 paid dispatches and 4 fresh tasks in v2; third proposal rejected at 47 actions | No pair result; do not promote or retry |
| Broad Pareto summary | Unpersisted model-free development screen | Opportunity condition in `3/21 = 14.2857%` cases | No implementation, evaluator, provider, or GPU work | Failed 20% headroom gate |
| Late structural novelty | Development-informed reconstruction plus faux E2E | Low-similarity 5/7 dominates; high-similarity 2/7; later live attempt had no accepted measurement | 14 reconstructed transitions; four calls/jobs per faux arm | Apparatus only; no treatment claim |
| Late structural-novelty paid screen | Two terminal apparatus attempts | No accepted treatment measurement or control vector | V1 zero paid calls; v2 one paid call and one failed Slurm task | Locked terminal; no retry or promotion |
| Complete-action-space headroom | One terminal zero-model apparatus attempt after one zero-dispatch setup failure | Non-admitted raw dijkstra payload: `-early-cse-memssa` `292->260`; `-early-cse` `292->269`; both 20/20 | One scientific CPU allocation, zero model/provider/GPU calls; evaluator step one CPU, root reserved four | Motivated one new visibility pair; no result, promotion, or retry |
| Stock-26 versus full-124 first-proposal visibility | One sampled-order paid directional pair | Control `1,960/14,080`; treatment `1,971/14,268`, despite 19 unique omitted-guide flags | Shared S12 plus two arm candidates: 6 CPU allocations, 2 paid Luna calls, 1 tool execution per arm, 1 exact zero-use blocked continuation per arm | `directional-loss`; stop without replication or promotion |
| Blowfish-first proxy cascade | Post hoc 13-trajectory headroom plus one prospective production-default wiring audit | Replay retained all frontiers; prospective frontier `[3]` and champion 3 retained | Replay: task allocations -17.3077%, summed evaluator runtime -28.5178%, post hoc. Audit: 8 fresh allocations and exact terminal accounting | Apparatus-only keep; no observed saving or agent claim |
| Full versus proxy-cascade schedule | Two-block AB/BA model-free systems screen | Exact metrics, verifiers, frontier `[3]`, champion 3, and selection `[2,3]` retained in both blocks | Median wall ratio `0.6443014367`, saving `29.6263775 s`, evaluator-step CPU ratio `0.6785407264`; 28 fresh allocations total | Resource gate passed; its one paid follow-up was attempted and closed apparatus-invalid |
| Paid proxy-cascade directional campaign | Two terminal apparatus attempts | V1 failed its provider-response guard; v2 completed 14 online measurements but lacked the two admitted hidden-audit measurements required to reconstruct the treatment's full frontier | V2 used 8 Luna transports, 8 tool calls, and 16 physical CPU allocations; all evaluator steps completed, but only 14 measurements were durably admitted | Campaign closed under second-apparatus-failure rule; no v3, comparison, or promotion |
| Proxy-cascade hidden-audit repair | Prospective tests plus one live zero-model qualification | No agent-quality estimand; exact concurrent hidden-audit path only | Jobs `1703787/1703788` overlapped and passed exact accounting plus 20/20 callbacks with zero model calls | Apparatus-only keep; no paid or scientific authorization |

The sealed v7 pair is the primary treatment evidence. Both arms proposed and selected the sequence:

```text
2,327 / 18,977 -> 2,161 / 17,665 -> 2,091 / 16,559
```

The treatment completed two typed recalls after compaction and selected the same final candidate. Its two protocol deviations were cosmetic assistant acknowledgements that rendered `job_` as `job-`; durable tool bindings and ledger identifiers were correct.

The separate resurrection qualification froze four candidates:

| Cell | Blowfish IR | Bzip2 IR |
|---|---:|---:|
| `A` | 2,161 | 17,665 |
| `A+X` | 2,161 | 17,665 |
| `A+E` | 2,161 | 17,534 |
| `A+E+X` | 2,161 | 17,534 |

`X` had exactly zero task-local effect before and after `E`; the declared conditional-resurrection mechanism was not demonstrated. Evidence: [qualification result](../../../.autoresearch/r-resurrection-qualification/2026-08-28-v1/result.json) and [ledger](../../../.autoresearch/r-resurrection-qualification/2026-08-28-v1/evidence.jsonl).

### Held-out CPU transfer

Dijkstra was not in the search objective.

| Comparison | Control | Treatment | Finding |
|---|---:|---:|---|
| Sealed v7 `M` | 292 IR | 292 IR | Exact tie |
| Exploratory v5 `W` | 275 IR | 304 IR | Treatment worse |
| Exploratory v5 `R` | 292 IR | 292 IR | Exact tie |

Held-out CPU evidence does not rescue a treatment.

### Why v5 `M` is not isolation-grade

The native v5 compaction summaries retained earlier job identifiers and measured IR values in both arms. The nominal control therefore retained evidence without typed recall. V7 fixed this by using the same deterministic sealed summary in both arms and verifying that earlier job IDs, manifest digests, and candidate bytes were absent from rebuilt model context.

### Whole-interface matched screen

Four randomized blocks were attempted on the same live Luna runtime. Block V2 was operationally invalid because one harmless workspace inspection plus four evaluator calls exhausted the old five-response budget before the final assistant report; its typed arm was correctly not launched. The other three blocks were valid:

| Block | Stock selected | Typed selected | Frozen direction |
|---|---:|---:|---|
| V1 | `1,958 / 13,802` | `1,958 / 13,747` | Typed positive |
| V3 | `1,925 / 13,704` | `1,926 / 13,865` | Stock positive |
| V4 | `1,948 / 14,047` | `1,959 / 13,951` | Task-wise mixed |

Across the three valid pairs, the preregistered directional result is inconclusive. V4's stock arm also measured a non-selected point at `1,958 / 13,792`, which strictly dominates the typed selected point at `1,959 / 13,951`. This whole-Pareto sensitivity does not replace the sealed scalar decision; it establishes the comparison rule for later work.

The screen contains 182 hash-verified ledger events, 84 artifact references, 56 fresh task measurements, zero reuse, and 353,153 total tokens. Evidence: [screen summary](../../../.autoresearch/stock-interface-pair-screen/summary-v1.md), [machine-readable summary](../../../.autoresearch/stock-interface-pair-screen/summary-v1.json), and [immutable correction](../../../.autoresearch/stock-interface-pair-screen/summary-v1-correction.json).

### Host-owned terminalization

The host can determine the champion from authoritative ledger measurements immediately after the fourth candidate. A fifth assistant response is neither evidence nor necessary control flow. The future runtime therefore records one intentional host stop before any post-budget provider dispatch, while preserving verifier, boundary, duplicate, source-integrity, and exact-budget failures as hard failures.

A read-only replay preserved all seven historical champion selections and revalidated 182 events, 84 artifacts, 28 evaluator dispatches, and 56 fresh task measurements. It does not rewrite V2's historical operational status. Evidence: [host-owned replay](../../../.autoresearch/stock-interface-pair-screen/host-terminalization-replay-v1.md).

### Concise feedback projection

The first live host-owned ablation varied only what evaluator evidence the model saw. Full authoritative measurements remained in the ledger and artifact store in both arms. The randomized order was preregistered as full then concise.

| Arm | Complete measured frontier | Feedback bytes | Input tokens | Total tokens | Modeled cost |
|---|---:|---:|---:|---:|---:|
| Full control | `1,925 / 13,676` | 17,983 | 15,687 | 24,397 | 0.075478 |
| Concise | `1,962 / 14,103` | 2,420 | 7,189 | 16,562 | 0.060396 |

The concise/full byte ratio was `0.134572`, passing the preregistered `<= 0.25` compression gate. Both arms used exactly four provider requests, four evaluator calls, eight fresh tasks, zero retries or duplicates, zero post-terminal dispatches, and one intentional host stop. All model-visible projections matched their authoritative details and remaining budgets.

Quality failed: concise covered `0/1` full-control Pareto vectors, while full covered `1/1` concise vectors and was strictly better on both tasks. The preregistered decision is `negative-quality`, so there is no replication or GPU transfer. Because this is one unseedable randomized pair, the result kills this pilot but does not estimate causal harm. Evidence: [feedback analysis](../../../.autoresearch/feedback-projection-screen/analysis-v1.md), [machine-readable analysis](../../../.autoresearch/feedback-projection-screen/analysis-v1.json), and [pair preregistration](../../../.autoresearch/feedback-projection-screen/preregistration.json).

### Killed before implementation: per-candidate task fusion

The next zero-model idea was to place blowfish and bzip2 in one SLURM allocation. A read-only topology and timing audit killed it before code or evaluator spend:

- the current adapter already evaluates the two tasks concurrently, so candidate latency is their maximum rather than their sum;
- bzip2 was the critical task in all eight latest candidates and all 69 campaign search/qualification pairs in the frozen latency cohort, which explicitly excludes one calibration and two deliberate replay measurements;
- across all 69 pairs, the optimistic assumption that a fused allocation inherits the lower of the two observed queue/transport residuals predicts only `0.731 ms` median saving;
- a fused request needs four CPUs and 16 GB, which may schedule more slowly than the present independent two-CPU/8-GB jobs.

The conservative expected wall saving is therefore zero. The proposed gate—at least two seconds and 10% median wall reduction, wins in at least seven of eight fixed-candidate pairs, and no slowdown above 10%—already fails on historical evidence. No implementation, remote job, or model call was made. Trajectory-scoped warm-allocation reuse is a different hypothesis because it could remove repeated critical-path setup after the first candidate.

### Killed before implementation: broad Pareto summary

A later model-free development screen considered adding a broader Pareto summary to the late-stage model context. Only 3 of 21 cases met its proposed opportunity condition, or `14.2857%`, below the declared 20% headroom gate. The idea was killed before implementation and produced no sealed analysis artifact, source module, remote evaluator job, provider call, or GPU use. This is an unpersisted development disposition, not an experimental measurement. Its durable record is limited to [campaign state](../../../STATE.md) and the [experiment log](../../../results.tsv).

### Late structural novelty: retrospective headroom and faux wiring

The next bounded idea asked whether the fourth proposal should be nudged away from its declared parent. A fail-closed reconstruction reread the pinned 21-ledger [latency cohort](../../../.autoresearch/compiler-gym-latency-audit/analysis-v1.json), verified each ledger chain and candidate artifact, and recovered 14 eligible ordinal-four transitions. Similarity was the exact Dice-LCS quantity

```text
S = 2 * LCS(child actions, parent actions) / (|child actions| + |parent actions|)
```

with low similarity defined as `S < 0.80`. Low-similarity transitions contained 5 dominating outcomes, 0 that improved neither task, and 2 tradeoffs. High-similarity transitions contained 2, 4, and 1, respectively. The domination-rate gap was `42.857` percentage points.

That descriptive gap is not treatment evidence. A Fisher exact sensitivity gives one-sided `p = 491/3432 ~= 0.143` and two-sided `p ~= 0.286`. The threshold and cohort query were development-informed; only 14/21 ledgers yielded eligible transitions; the pool mixes optimization trajectories with deliberately deleterious `R` leave-one-out/model-free diagnostics; the remaining-protocol positive sign depends on that diagnostic and reverses when it is excluded; first-declared-parent binding misattributes one resurrection mechanism; and action-sequence similarity is not a causal intervention. The analyzer therefore explicitly authorizes no provider, paid, treatment, promotion, or GPU claim.

The allowed next step was only a four-call faux apparatus check. The treatment added one serialized 128-byte `call4Guidance` field to the third accepted result, making it visible exactly once to treatment provider call four. Both arms made four provider calls, four evaluator calls, and four tool calls, with zero duplicates, one host stop, zero compactions, four unique jobs, and byte-identical authoritative raw artifacts. Invalid or rejected third feedback receives no guidance. This proves prompt isolation and routing only; no model behavior, treatment effect, or promotion was measured.

Evidence and implementation: [headroom analyzer](../src/compiler-gym-late-novelty-headroom.ts), [headroom regression](../test/compiler-gym-late-novelty-headroom.test.ts), [neutral guidance/projector](../src/compiler-gym-late-novelty-guidance.ts), [faux pilot policy](../src/compiler-gym-late-novelty-pilot.ts), and [four-call faux E2E](../test/compiler-gym-ir-delta-screen-faux-e2e.test.ts).

### Late-novelty paid screen and FarmShare recovery

V1 froze the paid hypothesis and randomized control first. It wrote one preflight ledger event, then stopped before the global attempt lock, provider, evaluator, Slurm, compaction, or GPU work. Contemporaneous console output identified an implementation-closure source path repeated from the stock bundle; that thrown text is not present in the sealed artifact. No terminal result exists. The preregistration and ledger hashes are `3ad488c6a0a0a2f6b1ed6c50ced0015cc90634e07d1310eb5618d5697703aabb` and `4a3b66a57e81e8056d81417eabc53437c0da0e3b1f781456411b797dbd0ce4d9`. Evidence: [v1 preregistration](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-28-v1/preregistration.json) and [single-event ledger](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-28-v1/execution-v1/evidence.jsonl).

A fresh v2 namespace, source closure, random draw, and attempt lock then passed pre-dispatch integrity with treatment first. Exactly one subscription-backed `openai-codex/gpt-5.6-luna` request ran at `xhigh`, locally requested `priority`, zero retries, and zero duplicate dispatches. The upstream response API exposed no service-tier acknowledgement. Usage was 1,899 input and 233 output tokens, 2,132 total, with modeled cost `$0.006594`. Request anchors, model resolution, source snapshot, and the returned first S12 tool request all matched the frozen contract.

The tool call was parsed and submitted exactly once. Its first evaluator failed. A later read-only scheduler observation reported Slurm `1703304`, `FAILED/3:0`, on `barley-01`; the sealed local trajectory records only an abstract failed job, not that Slurm identity. The adapter version used in this attempt collapsed the failure into a 65-byte generic rejection and stored no raw stdout artifact, so the direct task error is irrecoverable. The arm stopped immediately: zero tasks were accepted, result three never existed, call-four guidance was never produced or exposed, and the control arm did not run. Compaction and RLM were disabled. The disposition is terminal apparatus-invalid, not a negative treatment effect or permission to retry.

The v2 preregistration, pair result, and pair-ledger hashes are `b643267bbca810684b93557096fa67d095b402cbd77af09bb44e90166caa79c5`, `c628d537766dfad025a9592fc8cd01fa9e068734676db8d8bcf531120428d7bd`, and `49da646f9f772d7afa9148bb61d9be037de1ca1dff6805c01cecf6d61d89f352`. The arm result, evaluation ledger, and session hashes are `0198e9566ba562d94b8bf4fff5b8f6fc5a5124a74540cc81b5d94ac59fa0ccb9`, `5738b1f4af84f2771027ff934962da8616e10de0ee192c1efa8a16bf6c64ce43`, and `078bc92d63dfff1222d31ba3e7d2fda7e245e651c217947b835d10eac0d79f31`. The global lock remains hash `79b73799fb23022d0dc38f3c95e82d6256a5d8243371702c330521d1dc247001`. Evidence: [v2 preregistration](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/preregistration.json), [pair result](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/execution-v1/result.json), [pair ledger](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/execution-v1/evidence.jsonl), [arm result](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/execution-v1/arms/01-late-novelty-treatment/result.json), [arm ledger](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/execution-v1/arms/01-late-novelty-treatment/evaluation/evidence.jsonl), and [session](../../../.autoresearch/compiler-gym-late-novelty-paid-screen/2026-08-29-v2/execution-v1/arms/01-late-novelty-treatment/sessions/pln-8ac1cae5b778b7847256ad01355da137.jsonl).

Three zero-model, one-task cold diagnostics then located and repaired contemporaneous environment defects without spending more subscription inference:

The normalized v1/v2 results do not store external job IDs. Their content-addressed raw stderr names `StepId=1703309.0` and `StepId=1703313.0` with exit code 3, while v3 embeds `1703328` and successful evaluator output in raw stdout. Later read-only `sacct` supplied the normalized terminal states for all three jobs.

| Diagnostic | Slurm | Finding | Result / ledger SHA-256 |
|---|---:|---|---|
| V1 | `1703309`, `FAILED/3:0` | `cannot import name 'Space' from 'gym.spaces'`; Gym metadata existed while package sources were missing | `1e165dd0...` / `6180035c...` |
| V2 | `1703313`, `FAILED/3:0` | Compatibility tree expected 2,749 entries, 215,462 manifest bytes, hash `c43abf...`; observed 1,247, 62,778, `aa9a8b...` | `8f30b268...` / `1dfc7258...` |
| V3 | `1703328`; external `sacct`: `COMPLETED/0:0` | Full environment seal and 20/20 callbacks passed; blowfish empty pass measured `3,898` IR and `16,573` bytes | `51eb3155...` / `13669c9c...` |

Evidence: diagnostic [v1 result](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v1/result.json) and [ledger](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v1/evidence.jsonl), [v2 result](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v2/result.json) and [ledger](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v2/evidence.jsonl), and [v3 result](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v3/result.json) and [ledger](../../../.autoresearch/cpu-diagnostics/2026-08-29-slurm-recovery-v3/evidence.jsonl).

The package-version seal had not detected missing package files. Old extracted-file timestamps and the deletion pattern point to scratch cleanup, but that mechanism was not directly logged. The restored scratch environment is therefore healthy at the v3 timestamp, not guaranteed durable. Future paid admission requires a same-path live environment probe; a persistent versioned root or deterministic rebuild remains the durable follow-up.

The prospective error path now throws a typed sanitized adapter error and stores host-only error evidence plus raw stdout/stderr as content-addressed run-manifest artifacts. Source sealing includes [the typed error module](../src/evaluation-adapter-output-error.ts) in the paid preregistration, stock bundle, and transport runtime inventory. [Sidecar regressions](../test/sidecar.test.ts) verify persistence and non-leakage. This hardening does not rewrite v2 or recreate its lost output.

Prospective paid runner/preregistration protocol v2 additionally runs [the sealed live environment gate](../src/compiler-gym-paid-live-environment-gate.ts) before every provider transport. It executes the exact frozen probe over read-only login-node SSH using `/usr/bin/env -i` and the pinned v2 paths, rejects any stderr or byte drift, and contains no Slurm command. Each pass or failure is appended to the host-owned pair ledger with arm and dispatch ordinal before the hardened provider guard. Terminal accounting requires gate passes to equal actual paid dispatches and attempts to equal passes plus failures. Faux regressions prove success ordering across two calls and zero provider/evaluator dispatch on failure. This requires a fresh v2 preregistration; measurement semantics and verifier epoch are unchanged.

### Durable environment and complete-action-space headroom

The additive [home-bundle builder](../evaluators/compiler_gym_home_bundle.py) and [five-case regression](../test/compiler_gym_home_bundle_test.py) bind source bytes, target paths, modes, and hashes before a switch. Their SHA-256 values are `c2ee638750042ed41a675354499f7b39738fb0787e9e55b33a5e4820dd1d54d3` and `e39d052361211ce2c4f2fac0f07975049a0bc47fb52bb7b2cc2639650c799d4b`. Contemporaneous remote output, not persisted in a campaign artifact, reported `EDQUOT` while creating the parent before any stage or active-path change. These are locally verified migration mechanics, not a completed FarmShare migration.

The complete-action-space screen froze one held-out-from-cohort dijkstra scaffold, the exact 124 legal LLVM 10 flags, the 26 flags visible in the stock prompt guide, and their 98-flag complement. Dijkstra was absent from the sealed blowfish/bzip2 development cohort but had appeared in older campaign ledgers, so it is cohort-held-out rather than globally unseen. Every omitted flag was inserted once at index two into `mem2reg,sroa,X,instcombine,simplifycfg,adce,dce`. Only raw improvements of at least `max(3 instructions, 0.5%)` reached the existing 20-callback verifier. Two distinct verified flags were required.

V1 is a preserved zero-dispatch apparatus failure. The local runner requested an 8 MiB trusted read while the backend ceiling was 4.5 MiB. It installed one immutable source, then stopped before the live environment probe, scheduler queries, scientific lock, or `srun`. Its terminal ledger records `dispatchAttempts=0`, cleanup proved without scheduler work, and no result exists. Evidence: [v1 preregistration](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v1/preregistration.json) and [v1 ledger](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v1/execution-v1/result.json.evidence/evidence.jsonl).

The repair asks for exactly each source's byte length and is covered by a faux remote-filesystem equality assertion. Under a fresh v2 preregistration/output namespace, the runner passed its operational preflight and dispatched exactly once:

| Field | Raw observation |
|---|---:|
| Slurm job / terminal state | `1703490` / `COMPLETED 0:0` |
| Omitted flags swept | 98/98 |
| Raw qualifiers | 5 |
| Verified omitted flags | `-early-cse-memssa`, `-early-cse` |
| Baseline to `-early-cse-memssa` | `292 -> 260` IR; 20/20 callbacks |
| Baseline to `-early-cse` | `292 -> 269` IR; 20/20 callbacks |
| Evaluator CPU / wall | `59.933243 s` / `61.128304 s` |
| Evaluator step | `AllocCPUS=1`, `NTasks=1`, 65 CPU-seconds |
| Root reservation | `AllocCPUS=4`, 264 allocated-CPU-seconds |
| Native admission | No; terminal apparatus-invalid |

The raw stdout is one strict JSON line and replays through the frozen assessor as `gatePassed=true`, `apparatusCompleted=true`, `status=passed`. It is nevertheless not the experiment result. The preregistration required exactly two scheduler logical CPUs at the allocation root, while `sacct` reported four for root and extern. A later read-only diagnosis showed `ReqMem=8G`, `MaxMemPerCPU=4000`, `SelectTypeParameters=CR_CORE_MEMORY`, and two threads per core: `ceil(8192/4000)=3` logical CPUs rounded to two whole cores, or four logical CPUs. Root `TotalCPU` still matched the one-worker step, and the 4.4 allocated CPU-minutes remained below the declared 20-minute ceiling. This explains the mismatch without changing the frozen exact-topology rule.

The native ledger therefore contains no measurement, claim, or complete event and no terminal result file. It ends failed after 29 events, with raw evaluator, stderr, and accounting artifacts preserved; cleanup records the terminal job and empty queue. The scientific lock makes the attempt exact-once. Evidence: [v2 preregistration](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v2/preregistration.json), [v2 ledger](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v2/execution-v1/result.json.evidence/evidence.jsonl), [raw evaluator stdout](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v2/execution-v1/result.json.evidence/artifacts/sha256/73/dc6ffb921da7a6e85b117f53be75252c3ece290bb0111b9efafaddf2213cd8), [embedded `sacct` rows](../../../.autoresearch/compiler-gym-complete-action-space-headroom/2026-08-29-v2/execution-v1/result.json.evidence/artifacts/sha256/1a/aa84bade0ba5369d2a2dab3477b96784245469799710d0f0be5851e3ea7ce7), and [attempt lock](../../../.autoresearch/attempt-locks/complete-action-space-headroom-e7f409c498814b28f11af2fcfdaccaa1b87fb64c76b347b343d33a1c52c92255.lock).

The scientific signal was complete enough to motivate, but not formally promote, one genuinely new exploratory stock-26 versus full-124 prompt-visibility pair. That pair used its own hypothesis, entropy draw, source closure, namespace, output, and exact-once locks, plus a scheduler contract that distinguishes the one-worker evaluator step from a two- or four-logical-CPU root reservation. It is not a v2 retry or rescue.

### Paid first-proposal action-guide visibility

The visibility experiment froze a guide-only prompt difference. Both arms retained the same full legal 124-action execution space and the same unenumerated `minItems: 1`, `maxItems: 256` tool schema; control saw the stock 26-flag guide, while treatment saw that prefix plus the canonical omitted-98 suffix. It tested one first proposal per arm, with no compaction, RLM children, web access, retries, replacements, or reused measurements.

Before either paid lock or provider transport, a shared zero-model S12 gate made two fresh allocations and passed every frozen condition:

| Shared gate task | IR instructions | Object-text bytes | Semantic callbacks |
|---|---:|---:|---:|
| blowfish | 1,970 | 21,501 | 20/20 |
| bzip2 | 13,838 | 166,545 | 20/20 |

The paid first proposals then produced:

| Arm | Blowfish IR / object bytes | Bzip2 IR / object bytes | Unique omitted-guide flags | Provider / tool calls | Blocked continuation |
|---|---:|---:|---:|---:|---:|
| Stock-26 control | `1,960 / 22,380` | `14,080 / 172,685` | 0 | 1 / 1 | 1, exact zero usage |
| Full-124 treatment | `1,971 / 23,040` | `14,268 / 181,907` | 19 | 1 / 1 | 1, exact zero usage |

Both candidates passed all 20 callbacks on both tasks, and neither arm recorded a policy or apparatus failure. Treatment engaged the proposed mechanism by uniquely using 19 guide-omitted flags, but control strictly Pareto-dominated it. The diagnostic normalized minimax comparison also favored control. The preregistered decision is therefore `directional-loss` with next gate `stop-visibility-v1`.

The six unique CPU allocations were `1703515`, `1703516`, `1703519`, `1703520`, `1703521`, and `1703522`. There were exactly two paid subscription-model requests, two successful tool executions, four arm task evaluations, and two additional shared-gate task evaluations. Each arm's attempted continuation was intercepted locally at the one-call ceiling; the persisted aborted assistant message has zero input, output, cache, total-token, and cost usage, so it is not a third or fourth paid request.

The local entropy draw sampled control first, then treatment. Because it had no external precommitment or tamper-evident assignment, the sealed result sets `randomizedInferenceAllowed=false` and `causalClaimAllowed=false`. It also sets default, GPU, and NanoGPT promotion to false. The directional loss stops this pilot; it does not show that full-guide visibility is generally harmful, and it authorizes no repeat, default change, interaction test, KernelBench transfer, or NanoGPT run.

Key sealed evidence:

- [preregistration](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/preregistration.json), SHA-256 `30c6b86d2cd043ed766fb3ff97b9c8179c9a664529fd6af95039f05aeb323024`;
- [terminal result](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/result.json), SHA-256 `f113e6ec8bba8cadf9ee2165205bda61802a7145074ab9da40c2f48d50419ccc`;
- [pair ledger](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/evidence.jsonl), SHA-256 `9d2babb8e90ffffaae64d624dc8d2ffbe1a016020cb87c754c508550f7f0497a`;
- [shared-S12 ledger](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/shared-s12/evidence.jsonl), SHA-256 `48f10ac972b9b714c7bbb6996944d309d3de642932763d7cb7eaf0e0dffc2fa4`;
- [control evaluation ledger](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/arm-1-stock-26-guide-control/evaluation/evidence.jsonl), SHA-256 `edece3771988b155f43f49dc1bd866f8f933ac44b729625629e2681e9ea2ecd1`, and [control session](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/arm-1-stock-26-guide-control/sessions/pav-4f539dc81e7b6086b952709190511a9f.jsonl), SHA-256 `d9e67922642d901e9faab58986ba03216d93457d44a02a11125254f066f95b71`;
- [treatment evaluation ledger](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/arm-2-stock-124-guide-treatment/evaluation/evidence.jsonl), SHA-256 `578346149cb01f3bb87720c0675fc3bf37770721da5e061d891377b31054c130`, and [treatment session](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/arm-2-stock-124-guide-treatment/sessions/pav-4f539dc81e7b6086b952709190511a9f.jsonl), SHA-256 `92903a50cf2400acf1905728f790eb1f3ec686997c5c8404bf87daba3996f0b0`.

The exact shared-S12, control, and treatment raw-aggregate SHA-256 values are `37814430137bbd27c15092f184632149f923e5b05b2a04f1538529acfe379e72`, `f2a20a38dd77f8518afb64c37143a6113d59d5c38c3fe986fc581e3ce9c49f0e`, and `38924f9624efc596939f034bb264a90dfb62bdb6e08f8d6fdbe225acbbce8d6d`. The [provider-request pair anchor](../../../.autoresearch/compiler-gym-action-space-visibility/2026-08-29-v1/execution/provider-request-anchor.json) is SHA-256 `7267061180115f8d637455874fd5cf63b011dafa65ae3c8a84f61c0535a498b1` and binds the guide-only request difference. The requests locally asked for `priority`; no artifact claims that the upstream endpoint acknowledged a priority tier.

### Prospective blowfish-proxy cascade qualification

The development screen was a sealed post hoc replay over 13 natural four-candidate trajectories. Selecting the best two distinct blowfish IR tiers retained every complete two-task Pareto frontier while changing task allocations from 104 to 86 (`17.3077%`) and summed evaluator runtime from `947,686.128` to `677,427.105 ms` (`28.5178%`). Those values established headroom for one model-free systems audit only. Later candidates in the historical trajectories had already seen bzip2 feedback, and the replay's evaluator sum is neither feedback latency nor a prospective timing comparison.

The separately preregistered production-default audit evaluated one frozen four-candidate batch:

| Phase | Fresh allocations | Candidates | Visibility |
|---|---:|---|---|
| Blowfish proxy | 4 | 1, 2, 3, 4 | Cascade evidence |
| Selected bzip2 | 2 | 2, 3 | Cascade evidence |
| Omitted bzip2 audit | 2 | 1, 4 | Hidden audit only |

All eight Slurm IDs, job names, and transient caches were unique. All 24 root/extern/step accounting rows ended `COMPLETED/0:0`; the terminal queue was empty. There were no failed allocations, retries, replacements, reused measurements, model calls, provider dispatches, RLM children, or GPU allocations. The run recorded 102 allocation-wall seconds, 196 requested task CPU-seconds, and 408 scheduler logical CPU-seconds. Full reconstruction retained frontier ordinal `[3]` and champion 3.

The actual qualification deliberately ran the two hidden audit allocations, so it consumed eight allocations rather than six. The only allowed saving statement is the frozen counterfactual: a terminal cascade would use 6 instead of 8 allocations, a 25% allocation-count reduction. No actual compute, CPU, wall-time, queue, feedback-latency, agent-performance, default, GPU-transfer, or NanoGPT claim follows.

Evidence anchors: [sealed replay](../../../.autoresearch/compiler-gym-proxy-cascade-headroom/2026-08-29-v1/replay-result.json), SHA-256 `824065b538e0eb38436f32eb981970497ecf3d64a815a4b8dafcc1f559bd79d2`; [preregistration](../../../.autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/preregistration.json), SHA-256 `9a76b71cb66724182c8d393469a3dd403e211449460a3f31cb163cb03dd41da3`; [terminal result](../../../.autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/execution/result.json), SHA-256 `11ead1ff072cad2dd01ade41ef9ad2b362e14da9aab04573e4a0a543d7fc9edb`; and [strict ledger](../../../.autoresearch/compiler-gym-proxy-cascade-qualification/2026-08-29-v1/execution/evidence.jsonl), SHA-256 `d27b5e85bf7d221eab88b856e2f310c9575810b531c79e70933b71d91f5e8446`, terminal event `3bf8544b224303980990ee3a58f36aeae860b7b9945c0064c8aa39e512fb11ac`.

### Counterbalanced full-versus-cascade resource screen

The next exact-once experiment tested the resource claim prospectively, without a model. It froze the same four candidates and ran two counterbalanced blocks: full control then cascade, followed by cascade then full control. Each control arm evaluated blowfish and bzip2 concurrently within four sequential candidate rounds, for eight fresh one-task allocations. Each cascade arm ran four sequential blowfish rounds, derived `[2, 3]` solely from that arm's fresh accepted blowfish IR values, then evaluated bzip2 for those two candidates concurrently, for six fresh allocations. Maximum evaluator concurrency was two in every arm.

Environment probes, source readbacks, and source preparation ran outside the timed arm intervals. Each arm's feedback-ready interval started immediately before its first online dispatch and ended only after its final allocation was terminal, verified, and durably appended. Evaluator-step CPU is the `.0` step's `CPUTimeRAW`; it is intentionally narrower than root scheduler allocation accounting.

| Block | Order | Full-control wall / step CPU | Cascade wall / step CPU | Wall ratio | Wall saving | Step-CPU ratio |
|---:|---|---:|---:|---:|---:|---:|
| 1 | Control -> cascade | `84.477934 s / 198 s` | `54.664385 s / 136 s` | `0.6470847760` | `29.813549 s` | `0.6868686869` |
| 2 | Cascade -> control | `82.121875 s / 188 s` | `52.682669 s / 126 s` | `0.6415180973` | `29.439206 s` | `0.6702127660` |
| Median | AB/BA | — | — | `0.6443014367` | `29.6263775 s` | `0.6785407264` |

All preregistered gates passed. Every arm reproduced the frozen candidate metrics and verifier results, control's full frontier was `[3]`, each cascade retained `[3]`, and champion 3 was unchanged. Both cascades selected `[2, 3]` from blowfish inputs `2,091`, `1,970`, `1,958`, and `1,980`. Exact allocation counts were six versus eight, every block reduced evaluator-step CPU by at least 20%, median wall was more than 10% and ten seconds lower, and neither cascade arm was more than 5% slower.

The run used 28 fresh unique one-task allocations, Slurm `1703626` through `1703653`, with 84 root/extern/step accounting rows. Every row was terminal `COMPLETED/0:0`. It also recorded eight local seals and ten create-only remote locks. Aggregate accounting was 335 allocation-wall seconds, 648 evaluator-step CPU-seconds, and 1,340 scheduler logical CPU-seconds. There were zero failed allocations, retries, replacements, reused measurements, model calls, provider dispatches, tool calls, RLM children, compactions, or GPU allocations.

This is positive evidence for the fixed-batch model-free schedule and resource mechanism under this FarmShare CPU design. Counterbalancing reduces simple order bias but does not turn two blocks over one candidate batch into an agent-performance experiment. The result qualified one separately preregistered paid directional campaign, which was later attempted and closed apparatus-invalid. It does not establish a causal agent benefit, support a default change, or authorize KernelBench, GPU, or NanoGPT transfer.

Evidence anchors: [resource-screen preregistration](../../../.autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/preregistration.json), SHA-256 `554e3530a3adc5bbe800cce69eb06bdf501823d394e835734e90e2371029513e`; [terminal result](../../../.autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/execution/result.json), SHA-256 `894d444f7059ac8c301eee8b4167d88fa0314d2f9f4c345873f56cb6ad7e862f`; and [strict ledger](../../../.autoresearch/compiler-gym-proxy-cascade-resource-screen/2026-08-29-v1/execution/evidence.jsonl), SHA-256 `21d0e379151b1c4618f96adea41974490cdc064ebfd3a850e0cb07d4c4b2af6f`, terminal event `0d2aac8cb65ec72996299099a4807a9ac67c9e2c6c8396c8ce9d947172fe0715`. The scientific identity is `22d838d4c144732c1cfcf064a55f65f61b1eea619b826a31ee42dbc0c67cb45c`.

### Paid proxy-cascade campaign and apparatus qualification

The separately preregistered paid campaign consumed two fresh identities and then stopped under its second-apparatus-failure rule.

V1 ran control first, made two accepted proposals and four task allocations, then the pre-transport history guard rejected a valid second-turn response as `history turn 2 reasoning item shape drifted`. The failure was inside the provider-shape apparatus, not a model-policy or evaluator result. Exact sealed replay passes after the parser repair, while malformed shapes remain rejected; those prospective tests do not change v1. Its [preregistration](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/preregistration.json), [terminal result](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/result.json), and [strict ledger](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v1/execution/evidence.jsonl) have SHA-256 values `1c016ddff62f6556464febb8ae8a4fb0026600542e195a950cc9e4ee21d09e95`, `0b59060a1df32587eaaab336a91466b0bbb740aadf5d8e860d2bda2857b910e5`, and `538b9c906eb1c7e357faa1caacee8a87dc009fe3f7e012f20fd7f14368ec456c`. Its consumed scientific identity is `16ba4339af4c119cd91cfde2d88bf123086bffb291c2b2b8f9ae7c0a0f3f61f2`.

V2 used a fresh identity and randomized treatment before control. Both online arms reached their four-call terminal boundary: eight real Luna transports, eight tool calls, and 14 verified online task measurements. Treatment used six online allocations because bzip2 was delayed to its two blowfish-selected candidates; control used eight. Two post-terminal bzip2 audits intended to remain agent-inaccessible were then launched for the omitted treatment candidates. The host admitted neither measurement, and the post-audit session seal did not complete, so the frozen result does not claim that agent inaccessibility was established. The durable result contains 14 allocations even though read-only `sacct` proves 16 physical allocations, jobs `1703757` through `1703772`, and all 48 root/extern/`.0` rows completed `0:0` on `barley-01`.

The exact failure was semantic accounting, not Slurm or evaluator-process failure. For hidden jobs `1703771` and `1703772`, root and evaluator `.0` each ended after 17 seconds, while `.extern` ended one second later after 18 seconds. The old adapter applied root temporal containment to both `.extern` and `.0`; Slurm's `.extern` containment/cleanup step may legitimately outlive the root accounting row. The two raw hidden evaluator outputs are unrecoverable because interactive `srun` piped them through the host and the old failure path discarded its ordered child errors and streams.

No v2 online result is scientifically admitted. The sealed result has `assessment=null`, `liveScientificEvidenceEligible=false`, and terminal classification `terminal-apparatus-invalid-attempt-identity-consumed`. Descriptively, the treatment's online path used 126 evaluator-step CPU-seconds versus control's 202 and its deployed online vector `(1,958, 13,790)` did not cover control `(1,944, 13,706)`. Neither observation is a formal resource or directional comparison because the required treatment frontier reconstruction and hidden-audit integrity seal did not complete. There is no v3, replacement, pooled frontier, replication, default change, GPU transfer, or NanoGPT promotion.

V2's [preregistration](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v2/preregistration.json), [terminal result](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v2/execution/result.json), and [strict ledger](../../../.autoresearch/compiler-gym-proxy-cascade-paid-pilot/2026-08-29-v2/execution/evidence.jsonl) have SHA-256 values `0c6ab6b481e5482499eae591bb970535c332cb602b170321c97c7eb6df372ee5`, `98077f929e90169a18754fce8c06401605ee29e3ede19c3e672a01dac6fc4e85`, and `1b218d60ebac1e4c54ff10058a841afe5a42f3b2ed846b55d19d3cb9b2ef6985`. The ledger terminal event is `26f8206fe2483e0c315d54d8eb2bb6143021092ff6ff412f1d7626e0d2cdceea`; the consumed scientific identity is `7522261ba2c357f3e89e9bbe272a7374b578975e3784a7d88ce943035747cc0e`.

The prospective repair removes only `.extern` start/end/elapsed containment against root. It still requires the exact root/extern/`.0` identity and shape, one node, the declared CPU/task structure, matching node, valid timestamps, terminal `COMPLETED/0:0`, and a 300-second per-row bound; the evaluator `.0` remains strictly contained by root. The adapter reports the parsed Slurm ID before accounting collection. The paid runner now records attempt, external-allocation, terminal-measurement, and failure counts; running and failed states; content-addressed stdout, stderr, and typed host evidence; every ordered aggregate child; and a failure-path seal proving both agent sessions unchanged after hidden work drains.

The focused paid matrix passed 60/60, the legacy proxy-cascade suite 53/53, the resource suite 37/37, and the full repository check. A fresh model-free FarmShare qualification then ran two concurrent fixed bzip2 jobs through the repaired canonical adapter. Slurm `1703787` and `1703788` overlapped; each root/extern/`.0` triple completed `0:0`, and each task passed all 20 semantic callbacks. It made zero model/provider/session calls and is explicitly scientific-ineligible. Its [result](../../../.autoresearch/compiler-gym-proxy-cascade-paid-apparatus-qualification/2026-08-29-v1/result.json), [strict ledger](../../../.autoresearch/compiler-gym-proxy-cascade-paid-apparatus-qualification/2026-08-29-v1/evidence.jsonl), and [seal](../../../.autoresearch/compiler-gym-proxy-cascade-paid-apparatus-qualification/2026-08-29-v1/seal.json) have SHA-256 values `eb5ecece523916d6712e68e2e50f343da151ebf59625cc9841ce50c08ed53694`, `6c19d682332d49def1e9d579496fb0bc312c33fd2abf42e8d44e3de5854a02f6`, and `1913bed248864a3ab80facd39138b996f2af4b2e35ae199ed2b4c6148e1e861e`. The ledger terminal event is `0798a2290151482f064a7eed47edc25c3b5d87450c1218cfb67ddd88368ee123`; qualification ID is `3ce586d3-4b89-4e21-9f55-6ae012903a34`.

This qualification makes the future apparatus usable. It does not reopen the paid campaign. Any later paid experiment requires separate authorization and a genuinely new hypothesis, protocol, name, identity, draw, namespace, locks, sessions, source closure, and fresh measurements; no v1/v2 candidate, metric, or trajectory history may seed the model.

### Warm-allocation headroom model

The distinct trajectory-scoped hypothesis has enough modeled headroom for a fixed-candidate pilot. Among 18 multi-candidate ledgers in the 69-candidate cohort, there are 48 post-first measurements. Their median bzip2 queue/transport residual is `8.708 s`. If a warm worker removed that residual completely after initial admission, the median per-ledger reclaim would be `20.298 s`, or 24.9% of the summed candidate critical path.

That is an optimistic upper-bound proxy, not a causal estimate: the residual combines queueing, SSH, launch/teardown, and I/O, and a warm worker retains some transport overhead while reserving four CPUs during model-thinking gaps. The data-compatible lower bound is zero. A safe pilot must therefore measure pool acquisition, idle reservation, per-request transport, and verified cleanup separately while keeping the evaluator itself one-shot and unchanged.

The cohort and every timing field are reconstructed from strict canonical ledgers, with exact hardware/provenance pins and an independently checked recorded-residual equation. Evidence: [latency audit](../../../.autoresearch/compiler-gym-latency-audit/analysis-v1.md), [machine-readable analysis](../../../.autoresearch/compiler-gym-latency-audit/analysis-v1.json), and [input/output hash manifest](../../../.autoresearch/compiler-gym-latency-audit/analysis-v1.sha256).

### Warm transport result and kill

The mechanism-only warm-root pilot first compared persistent reuse with repeatedly acquired fresh warm roots. Across two sealed blocks it preserved exact semantics and won all eight candidate timings, with a `16.033 s` median saving. That established only that reusing an already-warm root beats reacquiring warm roots; it did not compare against the production stock-cold path.

The subsequent matched systems gate made that comparison. Both arms used the same four frozen candidates and produced the same requests, job identities, task metrics, verifier evidence, lineage, and budgets. Stock cold completed in `124.792743916 s`; persistent warm completed in `194.672781209 s`, a `69.880037293 s` regression. The warm root ended cleanly, with four allocated CPUs, exact `CPUTimeRAW = AllocCPUS × ElapsedRaw` accounting, acknowledgements `[0,1]`, and no residual queue entry.

The declared `>=10%` improvement gate failed. Persistent warm transport is stopped, and the agent-facing Luna screen was never launched. Evidence: [matched result](../../../.autoresearch/stock-interface-transport-pair/execution-v1/result.json), [execution manifest](../../../.autoresearch/stock-interface-transport-pair/execution-v1/execution-manifest.json), and [preregistration](../../../.autoresearch/stock-interface-transport-pair/preregistration-v1.json).

### Sealed C1 control-plane qualification

The candidate-scoped no-model systems hypothesis asked whether one two-rank SLURM step could remove enough control latency to justify a sealed four-candidate CPU screen. C1 v2 permitted one root submission, one candidate, two fresh task evaluations, zero provider calls, five CPU-allocation minutes, zero GPU-hours, and no replacement run.

BatchMode authentication and the required preflight passed. The sealed runner then submitted held root `1702093` exactly once. Before release or candidate publication, scheduler identity validation received `NumNodes=1-1` and failed its frozen `NumNodes === "1"` assertion. Slurm documents this field as [`min_count[-max_count]`](https://slurm.schedmd.com/scontrol.html), so `1-1` denotes the exact one-node bound rather than a wider allocation request. This identifies a strict representation parser defect; it does not turn the failed attempt into a valid measurement or permit another dispatch.

The immutable five-event ledger and failure manifest classify the attempt post-submit and terminal. Sealed cleanup-only recovery was invoked once and failed on the same parser assertion. After validating the exact held-job identity from the persisted handle and scheduler record, external cleanup ran `/usr/bin/scancel --full 1702093`. The subsequent scheduler observation found no queue entry; `sacct -X` records `CANCELLED`, `ExitCode=0:0`, `AllocCPUS=0`, `ElapsedRaw=0`, and `CPUTimeRAW=0`. The sibling cleanup attestation proves operational removal only: it does not rewrite the native `rootCleanupVerified=false` field or make C1 pass.

The preregistered `kill-job-step-transport` decision therefore fired. The attempt used one root submission but zero provider calls, candidate steps, fresh task evaluations, CPU-allocation seconds, or GPU-hours. There is no replacement run and the C1–C4 screen remains unrun. Evidence: [v2 preregistration](../../../.autoresearch/compiler-gym-job-step-qualification/preregistration-v2.json), [runtime manifest](../../../.autoresearch/compiler-gym-job-step-qualification/runtime-manifest-v2.json), [terminal failure manifest](../../../.autoresearch/compiler-gym-job-step-qualification/execution-v2/failure.json), [immutable execution ledger](../../../.autoresearch/compiler-gym-job-step-qualification/execution-v2/evidence.jsonl), [native recovery failure](../../../.autoresearch/compiler-gym-job-step-qualification/execution-v2/cleanup-recovery-failure.json), [external cleanup attestation](../../../.autoresearch/compiler-gym-job-step-qualification/execution-v2-manual-cleanup-v1.json), [campaign state](../../../STATE.md), and [experiment log](../../../results.tsv).

### IR-delta feedback qualification and paid screen

| Iteration | Gate | Terminal result |
|---:|---|---|
| 9 | Direct action-trace apparatus, v1–v3 | Terminal infrastructure discard; v3 completed eight exact metric/verifier allocations but hit a frozen raw no-effect versus observed `+1` IR contradiction. |
| 10 | One-environment IR-delta smoke | Mechanism-only pass over four fresh ABBA allocations; promote only to a broader model-free gate. |
| 11 | Formal IR-delta qualification | Mechanism-only pass over eight fresh allocations; separately preregistered paid screen eligible. |
| 12 | Paid directional screen v1 | Terminal apparatus-invalid before treatment feedback or control. |
| 13 | Paid directional screen v2 | Terminal scientific-policy nonconformance in treatment; no control or pair result. |

The first direct action-trace apparatus did not admit a result. V1 stopped before allocation because its frozen remote source parent was absent; v2 stopped after one allocation because its environment paths were stale. V3 completed all eight planned allocations with exact terminal metrics and verifier results, but its frozen parser rejected `-mergereturn`: CompilerGym reported no module modification while the observed IR count increased by one. The contradiction was terminal under that preregistration. No v3 result or retry is allowed. Evidence: [v1 preregistration](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v1/preregistration.json), [v1 ledger](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v1/execution/evidence.jsonl), [v2 preregistration](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v2/preregistration.json), [v2 ledger](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v2/execution/evidence.jsonl), [v3 preregistration](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v3/preregistration.json), and [v3 ledger](../../../.autoresearch/compiler-gym-action-trace-qualification/2026-08-28-v3/execution/evidence.jsonl).

A narrower IR-delta smoke then observed only the metric used by the objective. Four fresh ABBA allocations on L46/blowfish preserved `1,981` IR, `23,028` object-text bytes, and 20/20 verification; the trace telescoped exactly even across the `-mergereturn: +1` step. Median total-runtime ratio was `0.935880` and maximum `1.038765`. This passed only to the broader no-model qualification. Evidence: [smoke preregistration](../../../.autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/preregistration.json), [result](../../../.autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/execution/result.json), and [ledger](../../../.autoresearch/compiler-gym-ir-delta-smoke/2026-08-28-v1/execution/evidence.jsonl).

The no-model qualification compared canonical evaluation against evaluation with a per-action `IrInstructionCount` trace for S12 and L46 on blowfish and bzip2. All eight allocations were fresh. Each canonical/treatment pair matched final IR count, object-text size, action indices, command line, and all 20 verifier callbacks. Trace deltas telescoped exactly to the terminal count. The median treatment/control intrinsic-runtime ratio was `0.996886` and the maximum was `1.021607`, both inside the frozen limits. The two agent-visible trace additions totaled 2,039 bytes, or 19.66% of their control envelopes. This qualified a separately preregistered paid screen; it did not make an agent-benefit claim. Evidence: [qualification preregistration](../../../.autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/preregistration.json), [result](../../../.autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/result.json), and [ledger](../../../.autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/evidence.jsonl).

Paid-screen v1 made one Luna dispatch and evaluated S12 on two fresh tasks. The measurements were valid at `1,970 / 21,501 bytes` for blowfish and `13,838 / 166,545 bytes` for bzip2, with 20/20 verifier callbacks on both. The host rejected the aggregate before feedback because Python emitted exponent spellings for small finite timings where JavaScript canonical JSON emitted decimals. No adaptive request or control arm ran. The attempt remains sealed as apparatus-invalid. A future parser repair accepts only mathematically exact numeric re-spellings outside strings and fails closed on whitespace, key order, string, lossy-number, negative-zero, underflow, unsafe-integer, non-finite, hash, schema, and trace mutations. Evidence: [v1 preregistration](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/preregistration.json), [pair result](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/result.json), [pair ledger](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/evidence.jsonl), [treatment result](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/arms/01-visible-ir-delta-treatment/result.json), [treatment ledger](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/arms/01-visible-ir-delta-treatment/evaluation/evidence.jsonl), and [session](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v1/execution-v1/arms/01-visible-ir-delta-treatment/sessions/pids-8de92a07ef0ca429dca43e45e66080c9.jsonl).

Paid-screen v2 used a new namespace, source/runtime closure, random draw, attempt lock, and output path. It made three real subscription-backed Luna dispatches, two evaluator jobs, and four fresh task evaluations with no reuse or duplicates. S12 reproduced `1,970 / 13,838`; after receiving the full treatment trace, the model proposed a 25-action candidate that improved both task IR counts to `1,958 / 13,751`. Every admitted task passed all 20 callbacks. The third response proposed exactly 47 actions. The host rejected it before evaluator dispatch under the frozen scientific rule requiring `1..46`, and the next assistant record was a locally synthesized zero-usage abort rather than a fourth paid call.

The sealed v2 pair result retains an obsolete apparatus label because the then-current audit counted that synthetic abort as both a provider failure and an extra dispatch record. Under the preregistered taxonomy, the controlling disposition is terminal scientific-policy nonconformance. A read-only replay under the corrected, fail-closed future taxonomy preserves the same two candidates and counts while returning zero apparatus failures; no sealed byte or hash changes. The post-v2 interface now leaves stock behavior at `maxItems: 256` but advertises and locally enforces the opt-in screen schema at `minItems: 1`, `maxItems: 46`; the pre-transport gate rejects any schema or strictness mutation. This hardening does not rescue v2 or authorize another run. Evidence: [v2 preregistration](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/preregistration.json), [sealed pair result](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/execution-v1/result.json), [pair ledger](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/execution-v1/evidence.jsonl), [treatment result](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/execution-v1/arms/01-visible-ir-delta-treatment/result.json), [treatment ledger](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/execution-v1/arms/01-visible-ir-delta-treatment/evaluation/evidence.jsonl), [session](../../../.autoresearch/compiler-gym-ir-delta-paid-screen/2026-08-28-v2/execution-v1/arms/01-visible-ir-delta-treatment/sessions/pids-2dae545ba160c22de951131b2de035d7.jsonl), [future audit implementation](../src/compiler-gym-ir-delta-screen-runner.ts), [protocol](../src/compiler-gym-ir-delta-screen-protocol.ts), [audit regression](../test/compiler-gym-ir-delta-screen-runner.test.ts), [provider-parity regression](../test/compiler-gym-ir-delta-screen-provider-parity.test.ts), [campaign state](../../../STATE.md), and [experiment log](../../../results.tsv).

## Subscription transport, tools, RLM, and compaction

### Paid endpoint canary

The successful live endpoint canary produced one accepted candidate over two verified tasks:

| Item | Result |
|---|---:|
| Transport / provider retries | SSE / 0 |
| Provider calls / blocked calls | 4 / 0 |
| Submit / status failures | 0 / 0 |
| Output / total tokens | 607 / 8,975 |
| Verified tasks | 2/2 |

Evidence: [v7 endpoint canary](../../../.autoresearch/cpu-canaries/control-v7-live-endpoint-2026-08-28-v1/result.json).

Two earlier v6 attempts failed before producing candidates because the ChatGPT Codex subscription endpoint rejected `max_output_tokens`. The provider now omits that unsupported field, checks an abort immediately after `before_provider_request`/payload mutation, and honors an explicit zero-retry policy. Provider-call admission is hard-capped before transport; token and time ceilings are post-response checkpoints and are not presented as hard per-response limits.

### Matched v7 tool integrity

| Arm | Provider calls | Submit | Status | Recall | Compaction / sealed check | Deviations |
|---|---:|---:|---:|---:|---:|---:|
| Control | 12 | 3/0 | 4/0 | 0/0 | 1/1 | 0 |
| `M` | 12 | 3/0 | 2/0 | 2/0 | 1/1 | 2 cosmetic |

Every machine-authoritative tool call succeeded. There was no duplicate dispatch.

### Concise-feedback host-owned closure

Both feedback-projection arms completed with four provider calls and four evaluator dispatches. The attempted continuation is represented by a synthetic zero-token aborted assistant message and an intentional host-stop record; it is not a paid provider dispatch. Each arm had zero duplicate, reused, blocked, or post-terminal evaluations. The strict canonical-ledger verifier independently reconstructed event ordering, state transitions, artifacts, budgets, and terminal state.

### RLM and restart continuity

The successful RLM canary demonstrated one child admission, one nested evaluator dispatch, child-to-parent receipt delivery, parent status and recall, a persisted compaction, separate parent/child usage attribution, and zero adapter redispatch after restart. An exact duplicate submission returned the same job and manifest as a duplicate.

Evidence: [RLM v4 result](../../../.autoresearch/rlm-live-canary/2026-08-28-v4/result.json) and [durable canary](../../../.autoresearch/durable-canary/2026-08-27T22-50-00Z/result.json).

Conclusion: core typed-tool dispatch and sealed v7 compaction are clean enough for further experiments. Generic compaction is not automatically an experimental isolation boundary; the summary itself can retain measurements. Isolation requires the sealed-summary check or an equivalent policy. Prime's public API also does not expose separate compaction-token accounting. IR-delta paid-screen v2 separately exposed an opt-in contract mismatch: its provider schema still advertised stock `maxItems: 256` while the prompt and host enforced 46. The future screen schema and pre-transport gate now bind `1..46`; that post hoc repair does not alter v2.

The later late-novelty v2 screen adds narrower evidence: one exact subscription-backed tool call was parsed and dispatched once before the evaluator failed. This validates that first tool-routing round trip only, not a complete four-call trajectory. Compaction was disabled by that screen's frozen isolation contract, so compaction correctness remains supported by the earlier sealed canaries rather than the late-novelty attempt. Its missing raw evaluator streams also motivated the prospective typed-error path: models see only sanitized failure text, while host-only run manifests retain raw bytes by digest.

## Deterministic verified-measurement reuse

The controller now has an optional adapter-owned reuse contract for deterministic CompilerGym measurements:

- same ledger and branch;
- a completed fresh source only;
- exact candidate digest, sorted task set, lane, budget class, candidate format, verifier epoch, hardware, and provenance;
- source job, manifest, measurement digest, and immutable measurement-event hash recorded on reuse;
- only declared objective metrics and verifier verdict cloned;
- timing, queue metrics, stdout, and stderr never inherited;
- logical budgets remain charged while actual/reused/unevaluated task counts are separate;
- confirmation jobs and host-side `requireFreshMeasurement` force a fresh evaluation;
- KernelBench and NanoGPT do not opt in.

The agent-facing tools do not expose `requireFreshMeasurement`, so the model cannot manipulate causal resource accounting. A pinned CompilerGym adapter opts in only when its verifier, environment, hardware, and provenance contract match. Under concurrency, a duplicate whose source is still running evaluates fresh; the implementation does not claim cross-process single-flight behavior.

The focused reuse suite passed 5/5 cases, including required misses and restart behavior. The historical current-v2 R ledger contains an exact repeated candidate; shadow accounting would reduce 8 logical task evaluations to 6 physical plus 2 reused, a 25% physical-evaluation reduction with the same conclusion. This is a retrospective infrastructure estimate, not an observed treatment effect.

Source and contracts: [`controller.ts`](../src/controller.ts), [`compiler-gym-adapter.ts`](../src/compiler-gym-adapter.ts), and [`measurement-reuse.test.ts`](../test/measurement-reuse.test.ts).

## GPU-lane qualification

### Shared capacity and asynchronous progress

The controller now enforces a default maximum of four aggregate running jobs across the KernelBench and NanoGPT lanes, while each lane retains its own limit and CompilerGym remains independent. A local faux regression started three KernelBench jobs and one NanoGPT job, held a fifth NanoGPT job in `accepted`, completed a CPU job while all four GPU permits were occupied, then admitted the fifth after one KernelBench completion. All six jobs produced one unique measurement record and the strict ledger reverified; a configured aggregate limit above four is rejected.

This is operational apparatus evidence, not cluster utilization or GPU-transfer evidence. The bound is per controller process and assumes the current one-GPU-per-job contract; Slurm QoS remains authoritative across concurrent processes and live users. Source and test: [controller](../src/controller.ts) and [multi-lane regression](../test/multi-lane-controller.test.ts).

The `2026-08-28 20:47–20:50 PDT` scheduler snapshot found 13/24 L40S devices physically unallocated but an approximately eight-hour `srun --test-only` wait, while a small CPU request was immediately schedulable. That observation explains why CPU remains the synchronous lane and GPUs remain queued validation lanes. It is explicitly time-sensitive and was not promoted to a sealed experiment artifact.

### KernelBench-Verified

One fixed compiled candidate qualified the FarmShare L40S correctness and timing path:

| Metric | Result |
|---|---:|
| Positive hidden configurations passed | 4/4 |
| Wrong candidate rejected | 4/4 |
| `fastAtOne` | 1 |
| Reference mean | 52.295 ms |
| Positive warm mean | 16.680 ms |
| Observed speedup | 3.13525x |
| Cold compile | 5,421 ms |
| SLURM job | 1701019 |

Evidence: [KernelBench qualification ledger](../../../.autoresearch/kernelbench-compiled-qualification/2026-08-28-v5-recovered/evidence.jsonl).

This qualifies compilation, hidden correctness configurations, timing capture, and wrong-answer rejection. The candidate was fixed and allowlisted, `usesModelApi=false`, and acceptance was correctness-only. It is not a Prime Agent treatment-transfer result.

### NanoGPT

Two completed NanoGPT artifacts have different contracts and must not be pooled.

The historical pinned public speedrun fixture completed an unscored one-L40S infrastructure smoke:

| Metric | Result |
|---|---:|
| Effective optimizer steps | 10 |
| Backward calls | 80 |
| Seed | `0xC0FFEE` / 12,648,430 |
| Mean validation loss | 6.48509 |
| Peak VRAM | 29,634 MB |
| GPU | NVIDIA L40S |
| Source integrity before/after | Stable |
| Record/scored eligible | No / no |
| SLURM job | 1701170 |

Evidence: [NanoGPT smoke result](../../../.autoresearch/nanogpt-farmshare-smoke/2026-08-28-v1-sealed/result.json) and [strict evidence ledger](../../../.autoresearch/nanogpt-farmshare-smoke/2026-08-28-v1-sealed/evidence.jsonl).

That artifact's own claim scope forbids quality, score, or record claims. It proves only that its frozen source, smoke-data contract, CUDA execution, logging, and integrity checks worked.

The production path separately ran the byte-exact stock candidate through verifier epoch `nanogpt-scored-v1-ec824abe9c0ec43a5645afdb`, which binds the static evaluator, environment manifest and seal, 19-file dataset, worker, transport, and prospective campaign amendment:

| Metric | Production scored-apparatus smoke |
|---|---:|
| Mode / eligibility | `smoke-10`; unscored, frontier-ineligible, record-ineligible |
| Effective optimizer steps | 10/10 |
| Seed | `0xC0FFEE` / 12,648,430 |
| Final validation loss | `6.485082150` |
| Peak VRAM | `29,634.344 MB` |
| GPU / world size | NVIDIA L40S / 1 |
| CPU request / allocation | 8 requested / 10 allocated (`ReqTRES cpu=8`; `AllocTRES cpu=10`) |
| Source integrity before/after | Stable |
| Slurm job / terminal state | `1703802` / `COMPLETED/0:0` |

Request `826a1cb90d9523b4c5342cba7a6a706d70710e2489e121302cba102e33781bb9`, result `6a9a465282037d80bdf19420f2e9bbde49b197181a21daf3bec4b0a51a29f880`, and receipt `dbf0d16fa9ce34ac8059e9113e3028eb34eda1c34ffbe9d5fc72bd2e165f6af4` reverified through a fresh live reconcile without redispatch. Immutable evidence: [completed smoke slot](../../../.autoresearch/nanogpt-scored/stock-v1/scored-state/slots/1d/1db424157a830859145611f1817558810ebe9d972b455bb282c05559067b003f/smoke-10.json), [content-addressed result](../../../.autoresearch/nanogpt-scored/stock-v1/scored-state/artifacts/sha256/6a/9a465282037d80bdf19420f2e9bbde49b197181a21daf3bec4b0a51a29f880), and [archived-log manifest](../../../.autoresearch/nanogpt-scored/stock-v1/transport-evidence/82/826a1cb90d9523b4c5342cba7a6a706d70710e2489e121302cba102e33781bb9/manifest.json). The growing controller ledger is intentionally not a report-bundle input while the next stage is pending.

The historical frozen campaign declaration remains immutable at SHA-256 `31f6b78ac5c5ccb87a471e61bbad46e1f0d1b1c892eb7c678c1e8f5a8e02e2f4` with widening schedule `[1,2,4,8]`. Before the first scored dispatch, prospective amendment `0aece581a2cc9e49672f598129a9f298353114368962a4fca0e09b0f7e9751ab` defined a separate unscored `smoke-10` gate followed by scored stages `[1,3,8]` (`score-1`, `score-3`, `replay-8`). It changes only interim widening, preserves the final eight-seed decision rule, forbids historical reclassification, and forbids cross-protocol aggregation.

Full score-1 job `1703804` is pending. No loss, threshold verdict, score-3 authorization, or frontier point may be inferred from submission or scheduler state.

## Why no GPU treatment run or NanoGPT frontier is shown

The causal ladder is:

```text
runtime integrity -> immutable verification -> CPU treatment advantage
                  -> GPU transfer -> NanoGPT confirmation
```

The first two stages passed; the CPU treatment stage did not. The three lanes form this funnel: CompilerGym screens harness mechanics quickly, KernelBench can stress GPU transfer and verification after promotion, and NanoGPT alone confirms the target Track 3 estimand. GPU lane readiness cannot override that gate or substitute one benchmark's score for another.

A scored NanoGPT frontier cannot be reconstructed from current evidence. The production scored adapter and full stock recipe exist, and the candidate-specific smoke passed, but the one-seed full score remains pending. There is no completed threshold verdict, score-3 screen, treatment candidate, or eight-seed replay, so there are zero eligible time, token, evaluator-call, or GPU-hour frontier points. Drawing a curve would imply evidence that does not exist.

## Figures

The two tasks remain separate; there is no cross-task scalar headline.

![Sealed v7 blowfish frontier](../../../.autoresearch/cpu-analysis/v7/frontier-blowfish.svg)

![Sealed v7 bzip2 frontier](../../../.autoresearch/cpu-analysis/v7/frontier-bzip2.svg)

Primary analysis: [v7 report](../../../.autoresearch/cpu-analysis/v7/report.md), [manifest](../../../.autoresearch/cpu-analysis/v7/analysis-manifest.json), [runs](../../../.autoresearch/cpu-analysis/v7/runs.csv), [contrasts](../../../.autoresearch/cpu-analysis/v7/contrasts.csv), and [frontier](../../../.autoresearch/cpu-analysis/v7/frontier.csv).

Exploratory sensitivity: [v5 report](../../../.autoresearch/cpu-analysis/v5/interim-report.md), [blowfish figure](../../../.autoresearch/cpu-analysis/v5/frontier-blowfish.svg), and [bzip2 figure](../../../.autoresearch/cpu-analysis/v5/frontier-bzip2.svg).

## Source audit

The 22-entry source index contains 21 unique works. The literature most strongly supports verifier separation and measured evidence. It supports conditional-negative recall and interaction re-probes as observations, not as proven causal additions. Dense communication and asynchronous shared memory papers measure different outcomes; sparse measured-summary sharing remains an untested synthesis. Tang-Yang and SimpleTES changed materially between revisions. Heuresis is not comparable to Prime Track 3.

The complete claim-by-claim audit, version drift, contradictions, and all 22 dispositions are available as [Markdown](source-evidence-v1.md) and [HTML](source-evidence-v1.html).

## Validation completed

| Validation | Result |
|---|---:|
| OpenAI Codex provider focused suite | 19/19 passed |
| Coding-agent pre-dispatch abort regression | 1/1 passed |
| Sealed compaction tests | 2/2 passed |
| Analysis selector tests | 4/4 passed |
| Measurement reuse tests | 5/5 passed |
| Sidecar controller tests | 16/16 passed, including sanitized model-visible failures plus host-only raw error artifacts |
| Combined-ledger and shared-capacity multi-lane controller regressions | 3/3 passed, including aggregate four-job gating and exact-once delayed merge |
| R resurrection qualification tests | 7/7 passed |
| Host-owned terminalization tests | 5/5 passed |
| Stock-interface parity tests | 6/6 passed |
| Whole-Pareto comparator tests | 7/7 subtests passed |
| Feedback-projection analysis tests | 3/3 passed |
| CompilerGym latency reconstruction tests | 5/5 passed |
| Warm transport matched gate | Exact semantic/accounting parity; negative latency decision |
| C1 v2 sealed faux/fault suite | 53/53 passed |
| C1 v2 sealed dispatch | Terminal post-submit failure; one held root; zero candidate, task, model, CPU-allocation, or GPU work |
| C1 v2 native cleanup recovery | Failed closed on the same frozen `NumNodes=1-1` parser assertion |
| Exact external root cleanup | Verified absent and `CANCELLED/0:0`; `AllocCPUS=0`, `ElapsedRaw=0`, `CPUTimeRAW=0` |
| IR-delta formal qualification | 8/8 fresh allocations passed exact metric, verifier, trace, projection, and overhead gates |
| Paid IR-delta screen suite | 53/53 passed across adapter, faux E2E, model gate, preregistration, protocol, provider parity, runner, and stock-interface tests |
| Late-novelty paid-screen suite | 41/41 passed, including live-gate ordering, zero-dispatch failure, isolated attempt-lock, and sealed source-closure checks |
| Sealed v1 numeric replay | Exact valid aggregate accepted; representation, hash, schema, and trace mutations fail closed |
| Sealed v2 future-taxonomy replay | Scientific-policy nonconformance; zero apparatus failures; 3 provider dispatches, 2 evaluator jobs, 4 fresh task evaluations |
| Late structural-novelty headroom | 7/7 passed; exact 21-ledger input, 14 transitions, deterministic output, and fail-closed drift checks |
| IR-delta and late-novelty faux E2E | 2/2 passed; bounded treatment field reached only call four and raw artifacts matched |
| Root `npm run check` | Passed: formatting, root types, sidecar types, installer, browser smoke |
| FarmShare zero-model recovery v3 | Local result passed the frozen operational environment seal and 20/20 callbacks; external `sacct` reported Slurm `1703328` `COMPLETED/0:0` |
| Durable home-bundle regression | 5/5 passed locally; contemporaneous unsealed remote output reported `EDQUOT` before staging |
| Complete-action-space protocol and runner suites | TypeScript 12/12 and Python evaluator 8/8 passed; root check remained clean |
| Complete-action-space live attempt | V1 zero dispatch; v2 one CPU allocation, raw assessor-valid headroom signal, native terminal accounting rejection, cleanup proved, no admitted result |
| Action-guide visibility protocol, guard, runner, preregistration, and adapter suites | 41/41 passed, including both sampled orders, shared-S12 fail-closed behavior, exact blocked continuations, six-allocation uniqueness, policy/apparatus classification, provider parity, and terminal decision rules |
| Action-guide visibility live pair | Shared S12 passed; 2/2 arm candidates verified; 2 paid calls, 2 tool executions, 6 unique CPU allocations, and 2 exact zero-use blocked continuations; terminal `directional-loss` |
| Proxy-cascade replay and production-default qualification suite | 53/53 focused tests passed; sealed replay `--check` passed |
| Proxy-cascade live model-free wiring audit | 8/8 fresh unique allocations; 24/24 Slurm rows `COMPLETED/0:0`; frontier `[3]` and champion 3 retained; zero retries/reuse/model/provider/RLM/GPU |
| Counterbalanced proxy-cascade resource protocol, preregistration, runner, and adapter suite | 37/37 focused tests passed, including exact AB/BA scheduling, timing boundaries, fresh selection sealing, failure containment, budget terminalization, and source preparation |
| Counterbalanced proxy-cascade resource screen | 28/28 fresh unique allocations; 84/84 root/extern/step rows terminal `COMPLETED/0:0`; eight seals, ten locks, maximum concurrency two; both AB/BA blocks passed every frozen resource and equivalence gate |
| Paid proxy-cascade focused matrix | 60/60 passed across protocol, preregistration, provider, AgentSession, runner, adapter, qualification, and late-novelty compatibility suites |
| Paid proxy-cascade live campaign | V1 and v2 terminal apparatus-invalid; v2 ran 16 physical allocations but durably admitted only 14 online measurements; `assessment=null`, scientific eligibility false, campaign closed with no v3 |
| Repaired proxy-cascade live apparatus qualification | 2/2 overlapping zero-model jobs `1703787/1703788` passed exact root/extern/step accounting and 20/20 semantic callbacks; no provider or session calls |
| NanoGPT scored TypeScript suite | 32/32 passed across protocol, amendment, dataset, stock driver, adapter, and durable transport behavior |
| NanoGPT scored Python worker suite | 12/12 passed under each tested Python 3 and Python 3.12 runtime |
| Production NanoGPT stock smoke | Slurm `1703802` passed exact request/result/receipt, source, scheduler, hardware, step, log, and one-dispatch recovery checks; eight CPUs requested and ten allocated |
| Generated v7 output hashes | Matched analysis manifest |
| R qualification artifact references | 12/12 matched content digests |
| Feedback pair artifact references | 24/24 logical references matched hashes and lengths |

No live credential is stored in the sidecar or FarmShare artifact. OAuth remains on the Mac. FarmShare queue state is live and may drift; the `2026-08-28 20:47–20:50 PDT` capacity observation is not a sealed result. C1 reached its terminal parser failure after authentication and preflight succeeded, before any allocation began.

The report bundle and headline evidence files are pinned in [`campaign-v1.sha256`](campaign-v1.sha256).

## Threats to validity

- One root trajectory per arm cannot estimate policy variance; subscription trajectories are not seedable.
- Stock and sidecar runs differ in prompt, action guide, tool interface, and evaluation depth.
- V5 `M` is not an isolated compaction treatment; only sealed v7 is used for the primary claim.
- V7 had monotonic successful candidates and little conditional-failure evidence for `M` to exploit.
- Two search tasks and one held-out task do not establish broad compiler generalization.
- LLVM IR instruction count is a proxy; the stock IR champion increased object text size.
- Only provider-call count is a hard pre-dispatch budget. Output and time are checkpointed after responses.
- Requested `priority` was locally effective configuration but not acknowledged by the upstream response.
- The stock evaluator boundary was checked post hoc and was not an OS sandbox.
- KernelBench used one fixed task and candidate. Both completed NanoGPT artifacts are one-seed, ten-step apparatus smokes; the production smoke is candidate-specific under the scored verifier but says nothing about the full 3,290-step threshold. Score-1 job `1703804` remains pending/non-evidence.
- The aggregate four-job GPU cap is an in-process controller invariant under the current one-GPU-per-job assumption. It does not reserve cluster capacity, coordinate separate controller processes, or supersede Slurm QoS.
- The late-novelty reconstruction is development-informed and underpowered: its one-sided Fisher sensitivity is approximately `0.143`, only 14/21 ledgers contribute, and the protocol mix, deliberate negative diagnostics, and first-parent binding can change the apparent direction. Dice-LCS similarity is descriptive, not causal.
- The four-call late-novelty result uses a faux provider and deterministic evaluator only. Exact prompt isolation does not imply a live model will follow the guidance or improve the frontier.
- The late-novelty paid v2 trajectory contains one paid dispatch and no accepted measurement or control arm, so it cannot estimate guidance effect. Compaction was disabled and is not revalidated by this attempt.
- The v2 adapter did not retain the underlying failed evaluator stdout/stderr. Later diagnostics strongly implicate filesystem loss, but cannot prove that `1703304` had the same immediate error or reconstruct its missing bytes.
- The recovered CompilerGym payload remains on scratch. Its exact v3 seal is time-local; package metadata alone did not detect removed Gym, compatibility, bitcode, or runtime files, and nightly cleanup is inferred rather than directly observed.
- The environment probe is a frozen operational seal over declared manifests and imports, not a byte-complete hash of every installed Python file. Contemporaneous unsealed remote output reported a quota failure before home staging, so future paid work still depends on the recovered scratch payload and a fresh same-path probe.
- The complete-action-space observation is not admitted evidence. It uses one dijkstra scaffold, one insertion point, and single-flag marginal additions; dijkstra is held out only from the sealed development cohort, not the entire campaign. The scaffold baseline was raw-IR-only, and the 20 callbacks are a benchmark semantic check rather than formal equivalence. Combinations, other positions, and other tasks remain unknown.
- The root accounting mismatch was caused by the memory-per-CPU and whole-core scheduler policy rather than evaluator parallelism, but that explanation is post-attempt and cannot waive an exact preregistered topology field. Treating the raw payload as a verified result would be post hoc contract relaxation.
- The action-guide visibility result is one unseedable, sampled-order first-proposal pair. Its local entropy draw had no external commitment or tamper-evident assignment, so randomized inference and causal claims are explicitly disallowed. Control dominance stops the preregistered pilot but does not estimate general harm from a full action guide.
- The visibility treatment changed guide length and therefore context cost as part of the estimand. It uniquely used 19 omitted-guide flags, but one candidate per arm cannot distinguish which flag choices or prompt-length effects caused the observed vectors.
- Compaction, RLM children, and web access were disabled for the visibility isolation. Its clean one-tool-per-arm routing and exact zero-use blocked continuations do not independently revalidate compaction or child-agent continuity; those remain supported by the earlier sealed canaries.
- The proxy-cascade replay selected its policy retrospectively on the same 13-trajectory cohort, and later candidates had already observed bzip2 feedback. Its summed evaluator-runtime reduction is not feedback latency. The live qualification audited all eight tasks and therefore observed no six-allocation compute or time saving; it establishes production-default wiring only.
- The counterbalanced resource screen uses two blocks over one fixed four-candidate batch on FarmShare CPU. Its measured wall interval includes the online Slurm and adapter path, while environment preparation and admission probes are intentionally outside the timer; evaluator-step CPU excludes root and extern reservation accounting. AB/BA order controls one obvious nuisance but does not estimate broader scheduler, candidate, workload, or agent-policy variance.
- The resource screen had no model, tool, compaction, RLM, GPU, or adaptive proposal loop. Its positive schedule result cannot establish that delayed bzip2 feedback preserves or improves Luna search behavior. The subsequent paid v1/v2 campaign did not supply scientific evidence and is closed under its second-apparatus-failure rule.
- V2's two hidden evaluator steps physically completed, but their measurements, raw streams, external IDs, and terminal failure states were not durably admitted by the frozen runner. Later read-only `sacct` proves scheduler completion and isolates the adapter defect; it cannot reconstruct the missing treatment frontier or convert the 14 online observations into a comparison.
- The repaired live qualification comprises two fixed, model-free bzip2 jobs. It validates role-correct accounting and failure-provenance mechanics only; it neither exercises a paid pair nor authorizes one.
- Measurement reuse has automated contract evidence and retrospective shadow accounting, not a live causal campaign result.
- The R qualifier predates the new actual/reused budget fields and its run manifest does not pin the controller source hash; its ledger and referenced artifacts remain independently valid.
- The stock-versus-typed screen has three valid, unseedable pairs and remains an exploratory directional result, not a noninferiority test.
- The concise-feedback result is one randomized, unseedable pair. Its preregistered failure stops the pilot but cannot estimate causal harm.
- The feedback-byte headline includes the fourth result, which is stored but cannot condition a later proposal because the host stops before another provider call. The first-three sensitivity gives the same compression decision.
- Both sealed arm-local feedback preregistrations inherited legacy five-call fields. The earlier controlling pair preregistration and observed host runtime fixed four calls; the discrepancy is disclosed, the artifacts remain immutable, and the future generator is corrected.
- There is no replicated paired statistical test.
- FarmShare availability is live state and can drift.
- C1 v2 failed on an overly strict representation assertion: the frozen runtime accepted only `NumNodes=1`, while this Slurm version emitted the semantically exact range `1-1`. External cleanup is separately attested because native recovery shared the same parser path. Neither the known repair nor the external attestation can alter the terminal disposition.
- The C1 v2 runtime trusted the local filesystem, and static imports executed before seal verification. Its source closure remained frozen through the terminal attempt and native recovery.
- Paid-screen v1 stopped before treatment feedback became model-visible, so its valid S12 measurement says nothing about search benefit.
- Paid-screen v2 is one unseedable, treatment-first trajectory. Its adaptive 25-action improvement is descriptive only; the 47-action policy failure prevented a control arm and therefore any trace-effect comparison.
- The screen-specific `1..46` tool schema and exact pre-transport binding were added after v2. They prevent that interface contradiction in future code but cannot be used to reinterpret or repeat the sealed experiment.
- The campaign worktree remains uncommitted, so current local bytes are not yet recoverable from a repository commit.

## Explicitly unrun gates

- 24-hour stock Prime NanoGPT trajectory;
- a completed one-seed full stock threshold result; job `1703804` is pending and not evidence;
- score-3 and replay-8 execution, including the eight-seed stock replay;
- any agent-facing GPU treatment transfer;
- KernelBench treatment subset;
- full NanoGPT treatment run;
- matched 24-hour confirmations and exact paired significance testing;
- NanoGPT time, token, evaluator-call, and GPU-hour frontiers;
- `S` sparse sharing;
- concise-feedback replication or GPU transfer, because its quality kill fired;
- the C1–C4 job-step screen, because the one allowed C1 attempt failed terminally;
- the hidden-control arm and pair comparison for paid IR-delta feedback, because v2's randomized first arm terminated on scientific policy;
- completion, control, or replication of the terminal late-novelty paid screen; v1 and v2 are locked historical apparatus outcomes and cannot be rerun;
- replication, causal confirmation, interaction testing, or GPU/NanoGPT transfer of the completed stock-26 versus full-124 visibility pair; its directional-loss stop rule fired;
- any admissible agent-facing proxy-cascade comparison or replication; paid v1/v2 ran but closed apparatus-invalid before assessment, and no v3 is permitted;
- a harness-feature interaction pilot, because fewer than two features promoted.

Except for job `1703804`, these gates are unrun. Job `1703804` is pending compute, not pending success, and contributes no claim until its result and receipt reconcile successfully.

## Next falsifiable gate

Reconcile exact score-1 job `1703804` before widening. Proceed to `score-3` only if its accepted mean loss is strictly below `3.27859`. The historical `[1,2,4,8]` declaration remains immutable; prospective scored execution follows the hash-bound `[1,3,8]` amendment.

Do not spend another model trajectory on concise feedback or warm transport; both declared kill rules fired. Per-candidate task fusion is closed by the historical latency audit, and broad Pareto-summary injection is closed by its `3/21` headroom failure. Do not rerun, replace, or supersede C1 v2: its single post-submit attempt is terminal, candidate-scoped job-step transport is killed, and C1–C4 is closed. Do not rerun, rewrite, or present either paid IR-delta attempt as a completed pair: v1 is terminal apparatus evidence and v2 is terminal scientific-policy evidence.

Parser hardening can be tested as a future correctness repair by accepting only semantically exact one-node encodings such as `1` and `1-1` while rejecting wider ranges. That repair cannot modify the frozen execution or justify repeating its hypothesis.

The bounded screen tool schema is a future correctness repair, not a v3 retry license. Never rerun, rewrite, append to, or present late-novelty paid v1 or v2 as a completed pair. V1 is terminal pre-provider setup evidence; v2 is terminal treatment-first apparatus evidence with one paid tool call, no accepted measurement, and no control. Neither supports promotion.

Any further paid campaign experiment must test a genuinely different hypothesis under a new preregistration, namespace, source/runtime closure, random draw, attempt lock, and output path. It first needs one successful zero-model Slurm smoke under the same frozen environment; prospective runner/preregistration v2 then executes and records the same-path read-only login-node probe before every provider transport. Static package-version metadata is insufficient. Moving the versioned environment out of cleanup-prone scratch or adding deterministic rebuild remains a prerequisite for durable overnight work. Until one agent-facing CPU feature passes its promotion gate, KernelBench and NanoGPT treatment lanes remain gated. A defensible stopping outcome is the current negative result: no tested harness feature beat stock Prime Agent.

Do not rerun or reinterpret complete-action-space v2. Its native terminal accounting rejection is final. The non-admitted raw signal supported exactly one new exploratory stock-26 versus full-124 prompt-visibility pair after a separately reviewed preregistration bound prompt-only isolation, equal candidate/evaluator budgets, the same-path live environment gate before every paid dispatch, one-task step accounting, memory-driven root reservation, strict raw artifacts, and exact-once locks.

That one allowed visibility pair is now complete. Its shared S12 gate passed, the treatment engaged the omitted-guide mechanism, and the verified stock-26 control strictly dominated the verified full-124 treatment. The frozen `directional-loss` decision closes this pilot. Do not rerun, replicate, combine, promote, or transfer it; any future paid CPU work must test a different mechanism under a new protocol and must still clear its own predeclared promotion gate.

The proxy-cascade wiring qualification and distinct counterbalanced model-free resource screen remain complete and exact-once. The resource screen passed every frozen equivalence, allocation, evaluator-step CPU, wall-saving, and non-slowdown gate: median cascade/control wall ratio was `0.6443014367`, median saving `29.6263775 s`, and median evaluator-step CPU ratio `0.6785407264`. Its one paid authorization was consumed by v1/v2. Both attempts are terminal apparatus-invalid, the second-failure stop closes the campaign, and neither may be rerun, replaced, appended to, pooled, or retrospectively admitted. V2's online observations remain diagnostics only.

The role-correct accounting repair and live jobs `1703787` and `1703788` qualify future apparatus only. They do not reopen the campaign or authorize paid dispatch. Any later paid campaign requires separate user authorization and a genuinely new hypothesis, protocol, name, scientific identity, draw, namespace, source/runtime closure, locks, sessions, and fresh measurements. It cannot use v1/v2 candidates, metrics, or trajectory history as model-visible search input. The model-free result itself authorizes no default change, KernelBench transfer, GPU claim, or NanoGPT work.

## Reproduction entry points

```bash
# Static validation
npm run check

# Recheck the production NanoGPT scored protocol, amendment, data, stock driver,
# adapter, and durable transport without contacting FarmShare
npm --prefix research/autoresearch run test:nanogpt-scored

# Recheck the production NanoGPT scored worker locally
npm --prefix research/autoresearch run test:nanogpt-scored-worker

# Recheck the pinned public NanoGPT contract
npm --prefix research/autoresearch run test:nanogpt-contract

# Resume only the already-submitted stock score-1 stage; do not submit a replacement
npm run autoresearch:nanogpt-scored-stock -- \
  --output-dir /Users/duy/Documents/build/prime-agent/.autoresearch/nanogpt-scored/stock-v1 \
  --mode score-1 \
  --reconcile

# Model-free paid-screen protocol, schema, parity, and audit regressions
npm --prefix research/autoresearch run test:ir-delta-screen

# Late-novelty paid-screen sealing, locks, and fail-closed audit regressions
npm --prefix research/autoresearch run test:late-novelty-screen

# Sanitized model-visible adapter errors and host-only raw evidence persistence
npx tsx --test research/autoresearch/test/sidecar.test.ts

# Recheck late-novelty reconstruction and four-call faux isolation
npx tsx --test \
  research/autoresearch/test/compiler-gym-late-novelty-headroom.test.ts \
  research/autoresearch/test/compiler-gym-ir-delta-screen-faux-e2e.test.ts

# Recheck cross-lane progress and the aggregate four-job GPU cap
npx tsx --test research/autoresearch/test/multi-lane-controller.test.ts

# Recheck the zero-model complete-action-space protocol/runner and Python evaluator
npx tsx --test \
  research/autoresearch/test/compiler-gym-complete-action-space-headroom.test.ts \
  research/autoresearch/test/compiler-gym-complete-action-space-headroom-runner.test.ts
python3 research/autoresearch/test/test_compiler_gym_complete_action_space_headroom_eval.py

# Recheck the completed visibility pair's protocol, guard, runner, and adapter locally
npx tsx --test \
  research/autoresearch/test/compiler-gym-action-space-visibility-first-proposal-runner.test.ts \
  research/autoresearch/test/compiler-gym-action-space-visibility-preregistration.test.ts \
  research/autoresearch/test/compiler-gym-action-space-visibility-protocol.test.ts \
  research/autoresearch/test/compiler-gym-action-space-visibility-provider-guard.test.ts \
  research/autoresearch/test/compiler-gym-ir-delta-screen-adapter.test.ts

# Recheck the proxy-cascade apparatus and the immutable 13-trajectory replay
npm --prefix research/autoresearch run test:proxy-cascade
npm --prefix research/autoresearch run proxy-cascade:replay -- --check

# Recheck paid proxy-cascade provider, runner, accounting, and failure-provenance paths locally
npm --prefix research/autoresearch run test:proxy-cascade-paid

# Recheck the counterbalanced full-versus-cascade resource-screen protocol and runner
npm --prefix research/autoresearch run test:proxy-cascade-resource

# Verify that both reports, all local citations, and the campaign hash bundle agree
npx tsx research/autoresearch/src/campaign-report-bundle.ts --check

# Regenerate HTML and the complete hash bundle after an intentional Markdown update
npx tsx research/autoresearch/src/campaign-report-bundle.ts --write

# Verify the sealed C1 v2 runtime without dispatching it
npm run autoresearch:job-step-verify-seal

# Rebuild the sealed v7 analysis and figures from ledgers/artifacts
npm run autoresearch:analyze-cpu-smoke -- \
  --config research/autoresearch/cpu-smoke-v7.analysis.json \
  --output-dir .autoresearch/cpu-analysis/v7

# Rebuild the full-vs-concise decision from sealed sessions and ledgers
npm run autoresearch:analyze-feedback-projection -- \
  --screen-dir .autoresearch/feedback-projection-screen

# Rebuild the frozen 69-candidate latency audit and its hashes
npm run autoresearch:analyze-compiler-gym-latency

# Replay host-owned champion selection over the historical matched screen
npm run autoresearch:host-terminalization-replay

# R 2x2 evaluator-only qualification; this spends FarmShare CPU evaluations
npm run autoresearch:r-resurrection-qualify -- \
  --output-dir .autoresearch/r-resurrection-qualification/new-run

# Stock Prime CPU baseline; this spends subscription inference and FarmShare CPU
npm run autoresearch:stock-cpu-baseline -- \
  --output-dir .autoresearch/stock-cpu-baseline/new-run
```

Do not rerun paid or remote commands merely to regenerate the report. The immutable ledgers and analysis manifests are the evidence inputs.
