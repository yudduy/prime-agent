import {
	COMPILER_GYM_COMPLETE_ACTION_SPACE_ALLOWED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_BENCHMARK,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_EVALUATOR_CONTRACT,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_MINIMUM_VERIFIED_FLAGS,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_OMITTED_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_PROTOCOL,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SCAFFOLD,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_SHOWN_FLAGS_SHA256,
	COMPILER_GYM_COMPLETE_ACTION_SPACE_TERMINAL_VERIFIER_CONTRACT,
	type CompilerGymCompleteActionSpaceProtocol,
} from "../../src/compiler-gym-complete-action-space-headroom.js";

export function completeActionSpaceValidation(passed: boolean): Record<string, unknown> {
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

export function completeActionSpaceValidResult(
	protocol: CompilerGymCompleteActionSpaceProtocol,
): Record<string, unknown> {
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
			verification: verificationStatus === "verified" ? completeActionSpaceValidation(true) : null,
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
