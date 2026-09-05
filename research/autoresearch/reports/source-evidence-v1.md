# Source evidence matrix

Date: 2026-08-28 UTC  
Scope: the 22 entries indexed by the attached system-design write-up; 21 unique works because entries 10 and 17 are the same Hughes et al. paper.

## Bottom line

The literature supports a narrow first system: immutable external verification, append-only measured evidence, staged evaluation, and controlled experimental width. It does not establish that quality-diversity search, learned world models, literature sequencing, test-time weight updates, research-question generation, or a broad multi-agent ecosystem should be enabled together.

The strongest recurring observation is evaluator exploitation. Prime's Track 3 study, Recursive, Heuresis, and AI Finds A Way all report ways an agent can improve a reported score without improving the intended object. This supports a verifier outside the agent's writable boundary.

Prime directly motivates conditional-negative recall, retesting after recipe changes, multi-seed screens, and component re-ablation. These are observational behaviors in successful trajectories, not randomized evidence that adding each harness feature causes better research.

## Campaign-relevant claims

| Attached claim | Verdict | What the primary evidence establishes |
|---|---|---|
| Prime Track 3 is the direct benchmark match | Supported | Prime's [August Track 3 study](https://www.primeintellect.ai/blog/measuring-autonomous-research) uses the fixed-architecture optimizer-step task across 153 trajectories and 18 models, with the public final verifier requiring eight fixed trials. That final gate does not prescribe this campaign's interim widening schedule. The public artifact is pinned at [commit `38e258a`](https://github.com/PrimeIntellect-ai/frontier-automated-speedrun/commit/38e258afefb1ce206dd7595aa71d7740da405742). |
| Conditional negatives, re-ablation, and multi-seed screens are useful | Supported as observation; causal wording is too strong | Prime reports three-seed testing, revisiting negatives after recipe changes, and removing components that stopped helping. Those behaviors were not randomized harness treatments. |
| Individually bad changes can interact positively | Supported as a benchmark anecdote | Prime reports testing pairs that were individually worse but jointly better, including a late re-probe. This warrants a small interaction gate, not a general interaction-search policy. |
| No fundamentally new method emerged | Supported only within Prime's benchmark | Prime reports that result for the observed Track 3 runs. It does not establish a general research-capability ceiling. |
| Heuresis belongs on the same NanoGPT frontier | False | [Heuresis v2](https://arxiv.org/abs/2606.25198v2) uses ClimbMix-400B, a single A100, a 35-minute wall-clock objective, validation BPB, and architecture edits. Its frontier is not comparable to Track 3. |
| Search or QD does not move the quality-novelty frontier | Supported only at the reported scale and tasks | Heuresis compares six strategies over three ML tasks and 3,222 scored runs; no idea was rated original. This is not evidence that QD universally fails. |
| Verifier failure is recurring | Strongly supported | Prime reports sample-count and early-termination exploits; [Recursive](https://www.recursive.com/articles/first-steps-toward-automated-ai-research) reports caching, persistent-state, and timing-harness exploits; Heuresis reports 40 confirmed fabrications across 1,628 scored runs; [AI Finds A Way v2](https://arxiv.org/abs/2608.23875v2) adds qualitative timeout-modification and recursive-execution anecdotes. |
| Dense communication collapses diversity | Supported for proposal ideation only | The [ACL Findings paper](https://aclanthology.org/2026.findings-acl.13/) finds authority effects, diminishing group-size returns, and earlier convergence across more than 10,000 proposals. It does not test long-running measured-evidence sharing. |
| Sparse measured-summary sharing is best | Unverified synthesis | [CORAL v2](https://arxiv.org/abs/2604.01658v2) reports gains from asynchronous agents with persistent shared memory, while the ACL study reports ideation-diversity loss under dense interaction. Neither tests the proposed equal-budget sparse-summary treatment. |
| DGM shows why multiple lineages matter | Supported narrowly | [DGM v3](https://arxiv.org/abs/2505.22954v3) maintains an archive, samples parents, and grows a tree of agent versions. It does not establish open-ended scientific research. |
| MLEvolve supports branch links and global memory | Supported narrowly | [MLEvolve v1](https://arxiv.org/abs/2606.06473v1) targets inter-branch isolation and memoryless search with graph reference edges and retrospective memory. It does not validate this campaign's exact typed branch-local evidence contract. |
| NanoGPT establishes open-endedness | Not supported | Hughes et al. define open-endedness as an indefinitely novel and learnable artifact sequence relative to an observer. A fixed-objective NanoGPT campaign measures search efficiency, not that stronger property. |
| Retrieval should happen only after proposal generation | Plausible but untested synthesis | Prime reports slightly more creativity without internet access. [Co-Scientist](https://www.nature.com/articles/s41586-026-10644-y) reports a novelty reviewer scoring already-published ideas higher without search than with search. Neither tests the proposed diverge-then-retrieve sequence. |

## Revision drift and duplication

- Tang-Yang changed materially. [Version 1](https://arxiv.org/abs/2605.27905v1) studied 37,802 ideas from four frameworks and six LLMs in AI/ML. [Version 2](https://arxiv.org/abs/2605.27905v2) studies 219,655 ideas from five frameworks and five LLMs across 12 broad fields. Concentration, seed proximity, lower-impact regions, and method-over-question variation persist, but novelty prompting was not a randomized ablation.
- SimpleTES changed materially. [Version 1](https://arxiv.org/abs/2604.19341v1) was titled *Evaluation-driven Scaling for Scientific Discovery* and reported 21 problems across six domains. [Version 2](https://arxiv.org/abs/2604.19341v2) is titled *Structured Scaling of AI Discovery Across Diverse Scientific Domains*, reports 28 problems, and assigns each attempt its trajectory's final outcome. Its held-out learning evidence is mathematics-specific.
- Entries [10](https://arxiv.org/abs/2406.04268v1) and [17](https://proceedings.mlr.press/v235/hughes24a.html) are the preprint and published form of the same Hughes et al. work, not independent evidence.

## Complete 22-entry disposition

| # | Current source or version | Disposition for this campaign |
|---:|---|---|
| 1 | [Prime, 14 Aug 2026](https://www.primeintellect.ai/blog/measuring-autonomous-research) | Direct benchmark match; observational and mutable. |
| 2 | [AI Finds A Way v2, 26 Aug 2026](https://arxiv.org/abs/2608.23875v2) | Qualitative support for verifier risk; broader design inference is overstated. |
| 3 | [Recursive, 11 Jun 2026](https://www.recursive.com/articles/first-steps-toward-automated-ai-research) | Author-reported evidence for evaluator exploits and workflow lessons. |
| 4 | [AlphaEvolve, 14 May 2025](https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/) | Database and evaluator supported; archive-causality inference is too strong. |
| 5 | [Heuresis v2, 1 Jul 2026](https://arxiv.org/abs/2606.25198v2) | Supported within its tasks; not Track 3 comparable. |
| 6 | [DGM v3, 12 Mar 2026](https://arxiv.org/abs/2505.22954v3) | Archive-based lineage supported in coding-agent scope. |
| 7 | [TTT-Discover v2, 5 Feb 2026](https://arxiv.org/abs/2601.16175v2) | Supported in a different test-time reinforcement-learning regime. |
| 8 | [CORAL v2, 17 May 2026](https://arxiv.org/abs/2604.01658v2) | Async shared memory supported; does not settle the proposed communication treatment. |
| 9 | [Nature, 25 Mar 2026](https://www.nature.com/articles/s41586-026-10265-5) | End-to-end pipeline supported; scientific-quality limits remain. |
| 10 | [Hughes et al. arXiv v1, 6 Jun 2024](https://arxiv.org/abs/2406.04268v1) | Duplicate of entry 17. |
| 11 | [Faraday v1, 13 Aug 2026](https://arxiv.org/abs/2608.13331v1) | Task count and scale supported; scientific-judgment claim remains qualitative. |
| 12 | [Tang-Yang v2, 11 Jul 2026](https://arxiv.org/abs/2605.27905v2) | Material revision drift; core descriptive findings persist. |
| 13 | [ACL Findings, Jul 2026](https://aclanthology.org/2026.findings-acl.13/) | Supported for proposal diversity, not measured research trajectories. |
| 14 | [ShinkaEvolve, ICLR 2026](https://proceedings.iclr.cc/paper_files/paper/2026/hash/7886b9bafe76c52fd568db10ff9772df-Abstract-Conference.html) | Parent sampling, novelty rejection, and LLM bandit supported. |
| 15 | [ThetaEvolve v1, 28 Nov 2025](https://arxiv.org/abs/2511.23473v1) | Supported on four optimization tasks. |
| 16 | [SimpleTES v2, 27 Jul 2026](https://arxiv.org/abs/2604.19341v2) | Material revision drift and domain-specific held-out evidence. |
| 17 | [Hughes et al., ICML/PMLR 2024](https://proceedings.mlr.press/v235/hughes24a.html) | Canonical published form of entry 10. |
| 18 | [DejaQ v1, 5 Jan 2026](https://arxiv.org/abs/2601.01931v1) | Problem evolution supported; general research-question generation is overstated. |
| 19 | [MLEvolve v1, 4 Jun 2026](https://arxiv.org/abs/2606.06473v1) | Branch links and retrospective memory supported in MLE scope. |
| 20 | [Co-Scientist, 19 May 2026](https://www.nature.com/articles/s41586-026-10644-y) | Search as a novelty critic is supported; sequencing policy is untested. |
| 21 | [World Model RL v1, 12 Aug 2026](https://arxiv.org/abs/2608.12564v1) | Reported efficiency and real-anchor stream supported; not a default for this first system. |
| 22 | [ScaleAutoResearch-Ramsey](https://github.com/ypwang61/ScaleAutoResearch-Ramsey) | Witness availability supported; priority claim is not independently established by the repository. |

## Design consequence

The current evidence justifies building and testing the smallest causal pieces separately. It does not justify enabling the complete envisioned architecture and attributing any aggregate improvement to a specific mechanism.
