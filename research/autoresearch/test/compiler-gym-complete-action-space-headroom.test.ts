import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	analyzeCompilerGymCompleteActionSpace,
	assessCompilerGymCompleteActionSpaceResult,
	buildCompilerGymCompleteActionSpaceProtocol,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_CONTRACT,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT,
	type CompilerGymCompleteActionSpaceLedgerSource,
	type CompilerGymCompleteActionSpaceProtocol,
	type CompilerGymCompleteActionSpaceSources,
	loadCompilerGymCompleteActionSpaceSources,
} from "../src/compiler-gym-complete-action-space-headroom.js";

function cloneLedger(source: CompilerGymCompleteActionSpaceLedgerSource): CompilerGymCompleteActionSpaceLedgerSource {
	return { path: source.path, contents: source.contents, artifacts: { ...source.artifacts } };
}

function cloneSources(sources: CompilerGymCompleteActionSpaceSources): CompilerGymCompleteActionSpaceSources {
	return { ...sources, ledgers: sources.ledgers.map(cloneLedger) };
}

function validation(passed: boolean): Record<string, unknown> {
	return {
		passed,
		inputs_expected: 20,
		inputs_completed: 20,
		base_callbacks_selected: 20,
		sanitizer_callbacks_selected: 0,
		sanitizer_callbacks_excluded: 80,
		registered_callback_group_size: 5,
		workers: 1,
		worker_count_source: "SLURM_CPUS_PER_TASK",
		semantic_errors: passed ? [] : [{ input_index: 20, type: "Mismatch", data: {} }],
		inputs: Array.from({ length: 20 }, (_, index) => ({
			input_index: index + 1,
			completed: true,
			passed: passed || index !== 19,
			errors: passed || index !== 19 ? [] : [{ input_index: 20, type: "Mismatch", data: {} }],
			walltime_seconds: 0,
		})),
	};
}

function validResult(protocol: CompilerGymCompleteActionSpaceProtocol): Record<string, unknown> {
	const baselineIr = 1_000;
	const requiredImprovement = 5;
	const verified = protocol.audit.omittedFlags.slice(0, 2);
	const candidates = protocol.audit.omittedFlags.map((flag, index) => {
		const actions: string[] = [...COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD];
		actions.splice(2, 0, flag);
		const improvement = index < 3 ? 5 + index : 0;
		const qualified = improvement >= requiredImprovement;
		const verificationStatus =
			index < 2 ? "verified" : qualified ? "not-needed-after-positive-gate" : "not-qualified";
		return {
			flag,
			actions,
			action_indices: actions.map((action) => protocol.audit.allowedFlags.indexOf(action)),
			commandline: `opt ${actions.join(" ")}`,
			prefilter: {
				status: "measured",
				final_ir_instruction_count: baselineIr - improvement,
				improvement_instructions: improvement,
				required_improvement_instructions: requiredImprovement,
				qualified,
				info: {},
			},
			verification_status: verificationStatus,
			terminal_object_text_size_bytes: verificationStatus === "verified" ? 123 : null,
			verification: verificationStatus === "verified" ? validation(true) : null,
			verified: verificationStatus === "verified",
		};
	});
	return {
		schema_version: 1,
		contract: COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_CONTRACT,
		protocol: COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
		terminal_verifier_contract: COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT,
		ok: true,
		status: "passed",
		apparatus_completed: true,
		benchmark: COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK,
		request_sha256: protocol.requestSha256,
		cohort: {
			allowed_flag_count: 124,
			allowed_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
			shown_flag_count: 26,
			shown_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
			omitted_flag_count: 98,
			omitted_flags_sha256: COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
		},
		baseline: {
			actions: [...COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD],
			action_indices: COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD.map((action) =>
				protocol.audit.allowedFlags.indexOf(action),
			),
			commandline: "opt fixed-scaffold",
			ir_instruction_count: baselineIr,
			semantic_status: "raw-prefilter-only",
		},
		prefilter: {
			metric: "IrInstructionCount",
			minimum_absolute_improvement: 3,
			minimum_fraction_numerator: 1,
			minimum_fraction_denominator: 200,
			required_improvement_instructions: requiredImprovement,
			semantic_status: "unverified-unless-qualified",
		},
		candidates,
		sweep_complete: true,
		verified_omitted_flags: verified,
		verifier_schedule: {
			order: "qualified-candidates-in-omitted-flag-order",
			policy: "stop-after-two-verified-passes-else-verify-all-qualifiers",
			qualified_flag_count: 3,
			verified_qualifier_count: 2,
			not_needed_after_positive_count: 1,
			not_run_budget_exhausted_count: 0,
			early_positive_stop: true,
			negative_verification_complete: false,
		},
		pass_gate: {
			minimum_distinct_verified_omitted_flags: COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS,
			observed_distinct_verified_omitted_flags: verified.length,
			passed: true,
		},
		budget: {
			model_calls: 0,
			allocation_count: 1,
			cpus_per_task: 1,
			evaluator_cpu_minutes_limit: 10,
			task_wall_minutes_limit: 10,
			scheduler_logical_cpus_per_allocation: 2,
			scheduler_logical_cpu_minutes_maximum: 20,
			cpu_seconds_soft_limit: 540,
			wall_seconds_soft_limit: 540,
			allocation_time_limit: "00:10:00",
			cpu_seconds_observed: 12.5,
			wall_seconds_observed: 12.5,
			within_cpu_cap: true,
			within_wall_cap: true,
			soft_limit_exhausted: false,
		},
		environment: {
			slurm_job_id: "12345",
			slurm_cpus_per_task: "1",
			slurm_ntasks: "1",
			python_version: "3.10.19",
			compiler_gym_version: "0.2.5",
			compiler_gym_service_version: "0.2.5",
			llvm_compiler_version: "10.0.0",
			environment_id: "llvm-v0",
			action_space: "PassesAll",
			seal: {
				python_version: "3.10.19",
				distribution_manifest_sha256: "4b84dea7461512ef8fdadb99a992066484119fc91b7d8f0d3b33b5598fa870dd",
				distribution_count: 30,
				upstream_cbench_source_sha256: "e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88",
				cbench_patch_sha256: "259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00",
				installed_cbench_source_sha256: "6e38fd10d4bfd7816dbe6f959ff8ae97a3c10ab94cadde883926d83c0db521ed",
				ld_library_path: "/scratch/users/duynguy/prime-autoresearch/compiler-gym-libs/lib",
				libtinfo_sha256: "d82654b2615eb347e8f15a63862c9234f452187250b75d36dce8bd964541f02e",
				compatibility_tree_manifest_sha256: "c43abf7ca127d96a72b3f83f3185246ce4194d49481ed7264e7806a0788f71c1",
				compatibility_tree_entries: 2749,
				compatibility_tree_manifest_bytes: 215462,
			},
		},
		provenance: {
			compiler_gym_release: "v0.2.5",
			contract_upstream_commit: "64bdd6cd39967d3d2fe5e6c72deb15e830b838bb",
			upstream_cbench_source_sha256: "e6337c70f9a3e83abc8f54d9b4193e7ba51fe853a555fa78e472b2fc87920d88",
			cbench_patch_sha256: "259956ea61364336dbc3e326cd27c7b6a0342fadbeba32b6c29da7024a4ccc00",
			ci_two_input_shortcut_neutralized: false,
			terminal_validation_contract: "first non-sanitized callback from each known 20-input group",
		},
		timings_seconds: { wall: 12.5, cpu: 12.5 },
	};
}

const sourcesPromise = loadCompilerGymCompleteActionSpaceSources();

describe("CompilerGym complete legal action-space headroom gate", () => {
	it("reconstructs the exact sealed cohort and deterministic 98-flag complement", async () => {
		const audit = analyzeCompilerGymCompleteActionSpace(await sourcesPromise);
		assert.equal(audit.sources.ledgerCount, 21);
		assert.equal(audit.sources.proposalCount, 69);
		assert.equal(audit.sources.uniqueCandidateArtifactCount, 54);
		assert.equal(audit.sources.candidateArtifactSetSha256, COMPILER_GYM_COMPLETE_ACTION_SPACE_ARTIFACT_SET_SHA256);
		assert.equal(audit.allowedFlags.length, 124);
		assert.equal(audit.shownFlags.length, 26);
		assert.equal(audit.observedFlags.length, 25);
		assert.equal(audit.omittedFlags.length, 98);
		assert.deepEqual(audit.shownButUnobservedFlags, ["-loop-unroll"]);
		assert.equal(audit.digests.observedFlagsSha256, COMPILER_GYM_COMPLETE_ACTION_SPACE_OBSERVED_FLAGS_SHA256);
		assert.deepEqual(new Set([...audit.shownFlags, ...audit.omittedFlags]), new Set(audit.allowedFlags));
		assert.equal(new Set(audit.shownFlags).size, 26);
		assert.equal(new Set(audit.omittedFlags).size, 98);
		assert.equal(audit.eligibleForOneAllocationHeadroomGate, true);
		assert.equal(audit.gates.dijkstraAbsentFromDevelopmentCohort, true);
		assert.deepEqual(audit.authorizations, {
			model: false,
			provider: false,
			dispatch: false,
			paid: false,
			promotion: false,
			gpu: false,
		});
	});

	it("builds one exact zero-model single-CPU request without authorizing dispatch", async () => {
		const sources = await sourcesPromise;
		const first = buildCompilerGymCompleteActionSpaceProtocol(sources);
		const second = buildCompilerGymCompleteActionSpaceProtocol(sources);
		assert.equal(JSON.stringify(first), JSON.stringify(second));
		assert.equal(first.design.modelCalls, 0);
		assert.equal(first.design.allocationCount, 1);
		assert.equal(first.design.allocationRetries, 0);
		assert.equal(first.design.cpusPerTask, 1);
		assert.equal(first.design.evaluatorTaskCount, 1);
		assert.equal(first.design.evaluatorCpuMinutesMaximum, 10);
		assert.equal(first.design.taskWallMinutesMaximum, 10);
		assert.equal(first.design.schedulerLogicalCpusPerAllocation, 2);
		assert.equal(first.design.schedulerLogicalCpuMinutesMaximum, 20);
		assert.equal(first.design.allocationTimeLimit, "00:10:00");
		assert.equal(first.design.cpuSecondsSoftLimit, 540);
		assert.equal(first.design.wallSecondsSoftLimit, 540);
		assert.equal(first.design.benchmarkKnowledge, "dijkstra-held-out-from-sealed-development-cohort-zero-model");
		assert.equal(first.request.benchmark, COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK);
		assert.deepEqual(first.request.omitted_flags, first.audit.omittedFlags);
		assert.equal(first.request.omitted_flags_sha256, COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256);
		assert.deepEqual(first.request.scaffold_without_x, COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD);
		assert.equal(first.request.insertion_index, 2);
		assert.equal(first.request.prefilter.minimum_absolute_improvement, 3);
		assert.equal(first.request.prefilter.minimum_fraction_denominator, 200);
		assert.equal(first.request.pass_gate.minimum_distinct_verified_omitted_flags, 2);
		assert.equal(first.execution.sources.length, 2);
		assert.equal(first.execution.sources[0].remoteName, "compiler_gym_eval.py");
		assert.equal(first.execution.sources[1].remoteName, "compiler_gym_complete_action_space_headroom_eval.py");
		assert.equal(first.execution.argv.filter((value) => value === "/usr/bin/srun").length, 1);
		assert.ok(first.execution.argv.includes("--ntasks=1"));
		assert.ok(first.execution.argv.includes("--cpus-per-task=1"));
		assert.ok(first.execution.argv.includes("--time=00:10:00"));
		assert.ok(first.execution.argv.includes("--export=NONE"));
		assert.ok(first.execution.argv.includes(`--job-name=${first.execution.jobName}`));
		assert.ok(first.execution.argv.includes(`COMPILER_GYM_TRANSIENT_CACHE=${first.execution.transientCache}`));
		assert.equal(first.execution.sourceDirectory.endsWith(`/${first.execution.sourceBundleSha256}`), true);
		assert.equal(first.authorizations.dispatch, false);
	});

	it("rejects tampered callback, budget, environment, provenance, and source-binding evidence", async () => {
		const protocol = buildCompilerGymCompleteActionSpaceProtocol(await sourcesPromise);

		const callbackTamper = validResult(protocol);
		const callbackCandidates = callbackTamper.candidates as Array<Record<string, unknown>>;
		const callbackVerification = callbackCandidates[0]!.verification as Record<string, unknown>;
		callbackVerification.inputs_completed = 19;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(callbackTamper, protocol),
			/inputs_completed contradicts/,
		);

		const perInputTamper = validResult(protocol);
		const perInputCandidates = perInputTamper.candidates as Array<Record<string, unknown>>;
		const perInputVerification = perInputCandidates[0]!.verification as Record<string, unknown>;
		const perInputOutcomes = perInputVerification.inputs as Array<Record<string, unknown>>;
		perInputOutcomes[0]!.errors = [{ input_index: 1, type: "Mismatch", data: {} }];
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(perInputTamper, protocol),
			/passed contradicts completed\/errors/,
		);

		const semanticTamper = validResult(protocol);
		const semanticCandidates = semanticTamper.candidates as Array<Record<string, unknown>>;
		const semanticVerification = semanticCandidates[0]!.verification as Record<string, unknown>;
		semanticVerification.semantic_errors = [{ type: "tampered" }];
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(semanticTamper, protocol),
			/semantic_errors contradicts the per-input errors/,
		);

		const incompleteTamper = validResult(protocol);
		const incompleteCandidates = incompleteTamper.candidates as Array<Record<string, unknown>>;
		const incompleteVerification = incompleteCandidates[0]!.verification as Record<string, unknown>;
		const incompleteInputs = incompleteVerification.inputs as Array<Record<string, unknown>>;
		incompleteInputs[0] = {
			input_index: 1,
			completed: false,
			passed: false,
			errors: [],
			exception: { type: "TimeoutError", message: "fixture" },
			walltime_seconds: 0,
		};
		incompleteVerification.inputs_completed = 19;
		incompleteVerification.passed = false;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(incompleteTamper, protocol),
			/incomplete authoritative callback/,
		);

		const thirdVerifierTamper = validResult(protocol);
		const thirdVerifierCandidates = thirdVerifierTamper.candidates as Array<Record<string, unknown>>;
		thirdVerifierCandidates[2]!.verification_status = "verified";
		thirdVerifierCandidates[2]!.terminal_object_text_size_bytes = 123;
		thirdVerifierCandidates[2]!.verification = validation(true);
		thirdVerifierCandidates[2]!.verified = true;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(thirdVerifierTamper, protocol),
			/resumed verification after a terminal verifier stop/,
		);

		const verifierMetadataTamper = validResult(protocol);
		const verifierMetadataCandidates = verifierMetadataTamper.candidates as Array<Record<string, unknown>>;
		const verifierMetadata = verifierMetadataCandidates[0]!.verification as Record<string, unknown>;
		verifierMetadata.workers = 2;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(verifierMetadataTamper, protocol),
			/verifier metadata escaped/,
		);

		const budgetTamper = validResult(protocol);
		const budget = budgetTamper.budget as Record<string, unknown>;
		budget.wall_seconds_observed = 550;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(budgetTamper, protocol),
			/soft-budget status is inconsistent/,
		);

		const environmentTamper = validResult(protocol);
		const environment = environmentTamper.environment as Record<string, unknown>;
		const seal = environment.seal as Record<string, unknown>;
		seal.distribution_count = 31;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(environmentTamper, protocol),
			/environment package\/source seal drifted/,
		);

		const provenanceTamper = validResult(protocol);
		const provenance = provenanceTamper.provenance as Record<string, unknown>;
		provenance.contract_upstream_commit = "0".repeat(40);
		assert.throws(() => assessCompilerGymCompleteActionSpaceResult(provenanceTamper, protocol), /provenance drifted/);

		const sourceTamper = structuredClone(protocol);
		sourceTamper.execution.sources[1].sha256 = "0".repeat(64);
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(validResult(protocol), sourceTamper),
			/execution\/source seal drifted/,
		);

		const argvTamper = structuredClone(protocol);
		argvTamper.execution.argv.push("--overcommit");
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(validResult(protocol), argvTamper),
			/execution\/source seal drifted/,
		);

		const requestTamper = structuredClone(protocol);
		requestTamper.request.insertion_index = 3 as 2;
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(validResult(protocol), requestTamper),
			/execution\/source seal drifted/,
		);
	});

	it("accepts only a complete 98-flag result with two distinct 20-callback verifier passes", async () => {
		const protocol = buildCompilerGymCompleteActionSpaceProtocol(await sourcesPromise);
		const result = validResult(protocol);
		const assessment = assessCompilerGymCompleteActionSpaceResult(result, protocol);
		assert.equal(assessment.gatePassed, true);
		assert.equal(assessment.apparatusCompleted, true);
		assert.equal(assessment.baselineIrInstructionCount, 1_000);
		assert.equal(assessment.requiredImprovementInstructions, 5);
		assert.deepEqual(assessment.qualifiedFlags, protocol.audit.omittedFlags.slice(0, 3));
		assert.deepEqual(assessment.verifiedFlags, protocol.audit.omittedFlags.slice(0, 2));
		assert.equal(assessment.observedCpuSeconds, 12.5);
		assert.equal(assessment.observedWallSeconds, 12.5);
	});

	it("rejects semantic verification below the raw-IR prefilter", async () => {
		const protocol = buildCompilerGymCompleteActionSpaceProtocol(await sourcesPromise);
		const result = validResult(protocol);
		const candidates = result.candidates as Array<Record<string, unknown>>;
		candidates[3]!.verification = validation(true);
		assert.throws(
			() => assessCompilerGymCompleteActionSpaceResult(result, protocol),
			/attached verifier evidence to an unqualified candidate/,
		);
	});

	it("fails closed on ledger, artifact, evaluator, and action-guide drift", async () => {
		const sources = await sourcesPromise;
		const ledgerDrift = cloneSources(sources);
		const ledgerDriftLedgers = [...ledgerDrift.ledgers];
		ledgerDriftLedgers[0] = { ...ledgerDriftLedgers[0]!, contents: `${ledgerDriftLedgers[0]!.contents} ` };
		assert.throws(
			() => analyzeCompilerGymCompleteActionSpace({ ...ledgerDrift, ledgers: ledgerDriftLedgers }),
			/pinned ledger hash drifted/,
		);

		const artifactDrift = cloneSources(sources);
		const artifactDriftLedgers = [...artifactDrift.ledgers];
		const firstLedger = artifactDriftLedgers[0]!;
		const firstDigest = Object.keys(firstLedger.artifacts)[0]!;
		artifactDriftLedgers[0] = {
			...firstLedger,
			artifacts: { ...firstLedger.artifacts, [firstDigest]: `${firstLedger.artifacts[firstDigest]} ` },
		};
		assert.throws(
			() => analyzeCompilerGymCompleteActionSpace({ ...artifactDrift, ledgers: artifactDriftLedgers }),
			/candidate artifact hash drifted/,
		);

		assert.throws(
			() =>
				analyzeCompilerGymCompleteActionSpace({
					...sources,
					authoritativeEvaluatorContents: `${sources.authoritativeEvaluatorContents} `,
				}),
			/Authoritative CompilerGym evaluator hash drifted/,
		);
		assert.throws(
			() =>
				analyzeCompilerGymCompleteActionSpace({
					...sources,
					actionGuideSourceContents: `${sources.actionGuideSourceContents} `,
				}),
			/Stock prompt action-guide source hash drifted/,
		);
	});
});
