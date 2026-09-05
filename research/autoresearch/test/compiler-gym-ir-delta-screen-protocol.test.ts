import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Compile } from "typebox/compile";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	assertCompilerGymIrDeltaScreenRequestPolicy,
	assertCompilerGymIrDeltaScreenRequestSequence,
	assessCompilerGymIrDeltaScreenPair,
	COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
	COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
	COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	CompilerGymIrDeltaScreenEvaluationSchema,
	parseCompilerGymIrDeltaAggregateStdout,
	projectCompilerGymIrDeltaScreenFeedback,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import { COMPILER_GYM_IR_DELTA_TRACE_CONTRACT } from "../src/compiler-gym-ir-delta-smoke-protocol.js";
import type { StockInterfaceParityEvaluationEnvelope } from "../src/stock-interface-parity-protocol.js";
import { STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION } from "../src/stock-interface-parity-protocol.js";

const TASKS = ["benchmark://cbench-v1/blowfish", "benchmark://cbench-v1/bzip2"] as const;
const ANCHORS = [
	{ initialIr: 3898, initialObject: 16_573, finalIr: 1970, finalObject: 21_501 },
	{ initialIr: 28_748, initialObject: 122_613, finalIr: 13_838, finalObject: 166_545 },
] as const;

function canonicalLine(value: unknown): string {
	return `${canonicalJson(toJsonValue(value))}\n`;
}

function validation(rejected: boolean): Record<string, unknown> {
	const semanticError = { code: "semantic-mismatch", input_index: 1 };
	return {
		base_callbacks_selected: 20,
		inputs: Array.from({ length: 20 }, (_, index) => ({
			completed: true,
			errors: rejected && index === 0 ? [semanticError] : [],
			input_index: index + 1,
			passed: !(rejected && index === 0),
			walltime_seconds: 0.1,
		})),
		inputs_completed: 20,
		inputs_expected: 20,
		passed: !rejected,
		registered_callback_group_size: 5,
		sanitizer_callbacks_excluded: 80,
		sanitizer_callbacks_selected: 0,
		semantic_errors: rejected ? [semanticError] : [],
		worker_count_source: "SLURM_CPUS_PER_TASK",
		workers: 2,
	};
}

function rawEvaluatorStdout(input: {
	benchmarkId: (typeof TASKS)[number];
	actions: readonly string[];
	anchor: (typeof ANCHORS)[number];
	rejected?: boolean;
	forbiddenMetadata?: boolean;
	brokenTelescope?: boolean;
}): string {
	const rejected = input.rejected ?? false;
	const actionIndices = input.actions.map((_, index) => index);
	const deltas = input.actions.map((_, index) =>
		index === input.actions.length - 1 ? input.anchor.finalIr - input.anchor.initialIr : 0,
	);
	if (input.brokenTelescope && deltas.length > 0) deltas[deltas.length - 1] = 0;
	const trace = {
		action_indices: actionIndices,
		actions: [...input.actions],
		benchmark: input.benchmarkId,
		contract: COMPILER_GYM_IR_DELTA_TRACE_CONTRACT,
		initial_ir_instruction_count: input.anchor.initialIr,
		intermediate_semantic_status: "unverified",
		prefix_conditional: true,
		records: input.actions.map((action, index) => ({
			action,
			action_index: actionIndices[index],
			delta_from_previous: deltas[index],
			index,
		})),
		terminal_semantic_status: "canonical-20-input-verifier",
		zero_delta_semantics:
			"A zero delta means only that the observed IrInstructionCount was unchanged across this action; it does not imply that LLVM IR, module state, or program semantics were unchanged.",
	};
	const value: Record<string, unknown> = {
		action_indices: actionIndices,
		benchmark: input.benchmarkId,
		commandline: `opt ${input.actions.join(" ")} input.bc -o output.bc`,
		contract: COMPILER_GYM_IR_DELTA_EVALUATOR_CONTRACT,
		environment: {},
		metrics: {
			delta_final_minus_initial: {
				IrInstructionCount: input.anchor.finalIr - input.anchor.initialIr,
				ObjectTextSizeBytes: input.anchor.finalObject - input.anchor.initialObject,
			},
			final: { IrInstructionCount: input.anchor.finalIr, ObjectTextSizeBytes: input.anchor.finalObject },
			improvement_fraction: { IrInstructionCount: 0.1, ObjectTextSizeBytes: -0.1 },
			initial: { IrInstructionCount: input.anchor.initialIr, ObjectTextSizeBytes: input.anchor.initialObject },
		},
		ok: !rejected,
		provenance: {},
		request: { actions: [...input.actions], benchmark: input.benchmarkId },
		schema_version: 2,
		status: rejected ? "semantic_validation_failed" : "passed",
		step_info: input.forbiddenMetadata
			? { action_had_no_effect: false, reason: "forbidden", retained: false }
			: { reason: "pass metadata excluded", retained: false },
		terminal_verifier_contract: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
		timings_seconds: { total: 1 },
		validation: validation(rejected),
	};
	if (!rejected) value.action_trace = trace;
	return canonicalLine(value);
}

function accounting(slurmId: string, jobName: string, exitCode: 0 | 5): Record<string, unknown> {
	return {
		allocCpus: 2,
		cpuTimeRawSeconds: 2,
		elapsedRawSeconds: 1,
		endAt: "2026-08-28T18:00:01",
		exitCode: exitCode === 0 ? "0:0" : "5:0",
		jobIdRaw: slurmId,
		jobName,
		nTasks: null,
		nodeList: "barley-01",
		startAt: "2026-08-28T18:00:00",
		state: exitCode === 0 ? "COMPLETED" : "FAILED",
	};
}

function fixture(
	input: {
		request?: StockInterfaceParityEvaluationEnvelope["request"];
		rejectedTask?: number;
		forbiddenTask?: number;
		brokenTelescopeTask?: number;
		metricDriftTask?: number;
	} = {},
): { details: StockInterfaceParityEvaluationEnvelope; aggregate: string } {
	const request = structuredClone(input.request ?? COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST);
	const candidateSha256 = sha256Json(request.actions);
	const jobId = "job_0123456789abcdef01234567";
	const manifestDigest = "1".repeat(64);
	const rawTasks = TASKS.map((benchmarkId, index) => {
		const anchor = { ...ANCHORS[index] };
		if (input.metricDriftTask === index) anchor.finalIr++;
		const rejected = input.rejectedTask === index;
		const stdout = rawEvaluatorStdout({
			benchmarkId,
			actions: request.actions,
			anchor,
			rejected,
			forbiddenMetadata: input.forbiddenTask === index,
			brokenTelescope: input.brokenTelescopeTask === index,
		});
		const stderr = "";
		const slurmId = `${1703000 + index}`;
		const jobName = `pids-fixture-${index + 1}`;
		return {
			accounting: accounting(slurmId, jobName, rejected ? 5 : 0),
			benchmarkId,
			evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			exitCode: rejected ? 5 : 0,
			jobName,
			requestSha256: sha256Text(canonicalLine({ actions: request.actions, benchmark: benchmarkId })),
			slurmId,
			stderr,
			stderrSha256: sha256Text(stderr),
			stdout,
			stdoutSha256: sha256Text(stdout),
			transientCache: `/tmp/prime-ir-screen-fixture-${index + 1}`,
			wallMs: 1000,
		};
	});
	const sourceDirectory = `/scratch/private/sources/${COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256}`;
	const aggregate = canonicalLine({
		actionsSha256: candidateSha256,
		candidateSha256,
		contract: COMPILER_GYM_IR_DELTA_SCREEN_ADAPTER_OUTPUT_PROTOCOL,
		evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
		jobId,
		manifestDigest,
		measurementReuse: false,
		remoteEvaluatorPath: `${sourceDirectory}/compiler_gym_ir_delta_eval.py`,
		sourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
		sourceDirectory,
		tasks: rawTasks,
		verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	});
	const stdoutRef = {
		digest: sha256Text(aggregate),
		byteLength: Buffer.byteLength(aggregate),
		mediaType: "application/json",
	};
	const details: StockInterfaceParityEvaluationEnvelope = {
		type: "typed_sync_compiler_gym_evaluation",
		protocolVersion: STOCK_FEEDBACK_PROJECTION_PROTOCOL_VERSION,
		request,
		submitted: { jobId, acceptedAt: "2026-08-28T18:00:00.000Z", manifestDigest, duplicate: false },
		job: {
			jobId,
			manifestDigest,
			parentJobIds: [],
			candidateDigest: candidateSha256,
			state: {
				jobId,
				status: input.rejectedTask === undefined ? "succeeded" : "failed",
				statusAt: "2026-08-28T18:00:02.000Z",
				externalJobId: null,
				reason: null,
			},
			measurement: {
				jobId,
				manifestDigest,
				verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
				measuredAt: "2026-08-28T18:00:02.000Z",
				tasks: TASKS.map((benchmarkId, index) => {
					const anchor = { ...ANCHORS[index] };
					if (input.metricDriftTask === index) anchor.finalIr++;
					const rejected = input.rejectedTask === index;
					return {
						benchmarkId,
						status: rejected ? "rejected" : "accepted",
						metrics: { IrInstructionCount: anchor.finalIr, ObjectTextSizeBytes: anchor.finalObject },
						verifier: {
							passed: !rejected,
							checks: ["20-base-semantic-callbacks"],
							errors: rejected ? ["semantic"] : [],
						},
						runtimeMs: 1000,
					};
				}),
				hardware: { cluster: "Stanford FarmShare" },
				provenance: {
					adapter: "farmshare-compiler-gym-ir-delta-screen",
					evaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
					canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
				},
				stdout: stdoutRef,
				stderr: null,
			},
		},
		budget: {
			branchId: "fixture",
			submissions: 1,
			taskEvaluations: 2,
			actualTaskEvaluations: 2,
			reusedTaskEvaluations: 0,
			unevaluatedTaskEvaluations: 0,
			maxSubmissions: 4,
			maxTaskEvaluations: 8,
			remainingSubmissions: 3,
			remainingTaskEvaluations: 6,
		},
	};
	return { details, aggregate };
}

function testRecord(value: unknown, path: string): Record<string, unknown> {
	assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${path} must be an object`);
	return value as Record<string, unknown>;
}

function mutateFirstRawEvaluatorStdout(
	mutate: (stdout: string) => string,
	options: { updateHash?: boolean } = {},
): { details: StockInterfaceParityEvaluationEnvelope; aggregate: string } {
	const source = fixture();
	const details = structuredClone(source.details);
	const aggregateRecord = testRecord(JSON.parse(source.aggregate), "aggregate");
	assert.ok(Array.isArray(aggregateRecord.tasks));
	const firstTask = testRecord(aggregateRecord.tasks[0], "aggregate.tasks[0]");
	const rawStdout = firstTask.stdout;
	if (typeof rawStdout !== "string") throw new Error("aggregate.tasks[0].stdout must be a string");
	const stdout = mutate(rawStdout);
	assert.notEqual(stdout, rawStdout, "test mutation must change raw evaluator stdout");
	firstTask.stdout = stdout;
	if (options.updateHash !== false) firstTask.stdoutSha256 = sha256Text(stdout);
	const aggregate = canonicalLine(aggregateRecord);
	assert.ok(details.job.measurement);
	details.job.measurement.stdout = {
		digest: sha256Text(aggregate),
		byteLength: Buffer.byteLength(aggregate),
		mediaType: "application/json",
	};
	return { details, aggregate };
}

function reorderFirstTwoTopLevelKeys(stdout: string): string {
	const parsed = testRecord(JSON.parse(stdout), "raw evaluator stdout");
	const keys = Object.keys(parsed).sort();
	assert.ok(keys.length >= 2);
	[keys[0], keys[1]] = [keys[1]!, keys[0]!];
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(toJsonValue(parsed[key]))}`).join(",")}}\n`;
}

describe("CompilerGym paid IR-delta screen protocol", () => {
	it("strictly parses accepted aggregate evidence and exposes exactly one treatment field", async () => {
		const { details, aggregate } = fixture();
		const parsed = parseCompilerGymIrDeltaAggregateStdout(aggregate, details, 1);
		assert.deepEqual(
			parsed.tasks.map((task) => task.outcome),
			["verified", "verified"],
		);
		assert.equal(parsed.tasks[0]?.initialIrInstructionCount, 3898);
		assert.equal(
			parsed.tasks[0]?.irDeltas?.reduce((sum, delta) => sum + delta, 3898),
			1970,
		);
		const readArtifact = async (): Promise<string> => aggregate;
		const control = await projectCompilerGymIrDeltaScreenFeedback({
			details,
			arm: "hidden-control",
			callIndex: 1,
			readArtifact,
		});
		const treatment = await projectCompilerGymIrDeltaScreenFeedback({
			details,
			arm: "visible-ir-delta-treatment",
			callIndex: 1,
			readArtifact,
		});
		assert.equal("irDeltaTrace" in control, false);
		assert.equal("irDeltaTrace" in treatment, true);
		const reconstructed = structuredClone(treatment) as unknown as Record<string, unknown>;
		delete reconstructed.irDeltaTrace;
		assert.deepEqual(reconstructed, control);
		assert.equal(JSON.stringify(control).includes("delta_from_previous"), false);
	});

	it("accepts exact Python exponent spellings without weakening artifact hashes", async () => {
		const exponent = mutateFirstRawEvaluatorStdout((stdout) =>
			stdout
				.replace('"walltime_seconds":0.1', '"walltime_seconds":3.6e-05')
				.replace('"reason":"pass metadata excluded"', '"reason":"3.6e-05 remains string data"'),
		);
		assert.doesNotThrow(() => parseCompilerGymIrDeltaAggregateStdout(exponent.aggregate, exponent.details, 1));
		await assert.doesNotReject(() =>
			projectCompilerGymIrDeltaScreenFeedback({
				details: exponent.details,
				arm: "visible-ir-delta-treatment",
				callIndex: 1,
				readArtifact: async () => exponent.aggregate,
			}),
		);

		const staleHash = mutateFirstRawEvaluatorStdout(
			(stdout) => stdout.replace('"walltime_seconds":0.1', '"walltime_seconds":3.6e-05'),
			{ updateHash: false },
		);
		assert.throws(
			() => parseCompilerGymIrDeltaAggregateStdout(staleHash.aggregate, staleHash.details, 1),
			/stdoutSha256/,
		);
	});

	it("keeps whitespace, key order, and string spellings byte-strict", () => {
		for (const testCase of [
			{
				name: "whitespace",
				value: mutateFirstRawEvaluatorStdout((stdout) => stdout.replace(/^\{/, "{ ")),
			},
			{
				name: "key order",
				value: mutateFirstRawEvaluatorStdout(reorderFirstTwoTopLevelKeys),
			},
			{
				name: "string escape",
				value: mutateFirstRawEvaluatorStdout((stdout) => stdout.replace("benchmark://", "benchmark:\\/\\/")),
			},
		]) {
			assert.throws(
				() => parseCompilerGymIrDeltaAggregateStdout(testCase.value.aggregate, testCase.value.details, 1),
				/not canonical JSON/,
				testCase.name,
			);
		}
	});

	it("fails closed on malformed, non-finite, unsafe, and lossy number spellings", () => {
		for (const testCase of [
			{
				name: "malformed",
				value: mutateFirstRawEvaluatorStdout((stdout) =>
					stdout.replace('"walltime_seconds":0.1', '"walltime_seconds":3.6e-'),
				),
				error: /not valid JSON/,
			},
			{
				name: "non-finite",
				value: mutateFirstRawEvaluatorStdout((stdout) =>
					stdout.replace('"walltime_seconds":0.1', '"walltime_seconds":1e309'),
				),
				error: /Non-finite|non-finite/,
			},
			{
				name: "unsafe integer rewrite",
				value: mutateFirstRawEvaluatorStdout((stdout) =>
					stdout.replace('"walltime_seconds":0.1', '"walltime_seconds":9007199254740992.0'),
				),
				error: /unsafe rewritten JSON integer/,
			},
			{
				name: "lossy decimal rewrite",
				value: mutateFirstRawEvaluatorStdout((stdout) =>
					stdout.replace('"walltime_seconds":0.1', '"walltime_seconds":0.10000000000000001'),
				),
				error: /lossy JSON number rewrite/,
			},
		]) {
			assert.throws(
				() => parseCompilerGymIrDeltaAggregateStdout(testCase.value.aggregate, testCase.value.details, 1),
				testCase.error,
				testCase.name,
			);
		}
	});

	it("admits an exact complete semantic rejection after S12 with a null trace", async () => {
		const request = { ...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST), hypothesis: "adaptive call two" };
		const { details, aggregate } = fixture({ request, rejectedTask: 0 });
		const parsed = parseCompilerGymIrDeltaAggregateStdout(aggregate, details, 2);
		assert.deepEqual(
			parsed.tasks.map((task) => task.outcome),
			["complete-semantic-rejection", "verified"],
		);
		const treatment = await projectCompilerGymIrDeltaScreenFeedback({
			details,
			arm: "visible-ir-delta-treatment",
			callIndex: 2,
			readArtifact: async () => aggregate,
		});
		assert.equal("irDeltaTrace" in treatment, true);
		assert.equal("irDeltaTrace" in treatment ? treatment.irDeltaTrace : undefined, null);
	});

	it("fails closed on forbidden metadata, broken telescoping, and S12 drift", () => {
		for (const testCase of [
			{ name: "forbidden", value: fixture({ forbiddenTask: 0 }) },
			{ name: "telescope", value: fixture({ brokenTelescopeTask: 0 }) },
			{ name: "S12 drift", value: fixture({ metricDriftTask: 0 }) },
		]) {
			assert.throws(
				() => parseCompilerGymIrDeltaAggregateStdout(testCase.value.aggregate, testCase.value.details, 1),
				testCase.name,
			);
		}
	});

	it("deep-binds the first request and caps every sequence at 46 actions", () => {
		const validator = Compile(CompilerGymIrDeltaScreenEvaluationSchema);
		const requestWithActions = (actions: string[]) => ({
			...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actions,
		});
		assert.equal(validator.Check(requestWithActions(["-adce"])), true);
		assert.equal(validator.Check(requestWithActions(Array.from({ length: 46 }, () => "-adce"))), true);
		assert.equal(validator.Check(requestWithActions([])), false);
		assert.equal(validator.Check(requestWithActions(Array.from({ length: 47 }, () => "-adce"))), false);
		assert.deepEqual(CompilerGymIrDeltaScreenEvaluationSchema.properties.actions, {
			type: "array",
			items: { type: "string" },
			minItems: 1,
			maxItems: 46,
		});
		assert.doesNotThrow(() =>
			assertCompilerGymIrDeltaScreenRequestPolicy(1, COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
		);
		assert.throws(() =>
			assertCompilerGymIrDeltaScreenRequestPolicy(1, {
				...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
				hypothesis: "changed",
			}),
		);
		assert.throws(() =>
			assertCompilerGymIrDeltaScreenRequestPolicy(2, {
				...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
				actions: Array.from({ length: 47 }, () => "-adce"),
			}),
		);
		assert.throws(() =>
			assertCompilerGymIrDeltaScreenRequestPolicy(2, {
				...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
				actions: [],
			}),
		);
		const adaptive = [2, 3, 4].map((callIndex) => ({
			...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actions: ["-adce", ...Array.from({ length: callIndex - 1 }, () => "-dce")],
			hypothesis: `adaptive ${callIndex}`,
		}));
		assert.doesNotThrow(() =>
			assertCompilerGymIrDeltaScreenRequestSequence([
				structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
				...adaptive,
			]),
		);
		assert.throws(
			() =>
				assertCompilerGymIrDeltaScreenRequestSequence([
					structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
					adaptive[0]!,
					{ ...adaptive[0]!, hypothesis: "changed prose does not change the action vector" },
					adaptive[2]!,
				]),
			/scientific-policy-nonconformance/,
		);
	});

	it("requires strict witnesses beyond shared S12 and freezes carry-forward prefix AUC", () => {
		const shared = { callIndex: 1 as const, outcome: "verified" as const, blowfishIr: 1970, bzip2Ir: 13_838 };
		const notPromising = assessCompilerGymIrDeltaScreenPair({
			control: {
				arm: "hidden-control",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1950, bzip2Ir: 13_800 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "verified", blowfishIr: 1940, bzip2Ir: 13_790 },
				],
			},
			treatment: {
				arm: "visible-ir-delta-treatment",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1960, bzip2Ir: 13_820 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "verified", blowfishIr: 1950, bzip2Ir: 13_810 },
				],
			},
		});
		assert.equal(notPromising.primary.passed, false);
		assert.equal(notPromising.secondary.treatmentPrefixBest[2], notPromising.secondary.treatmentPrefixBest[1]);
		assert.equal(notPromising.decision, "not-promising");
		const promising = assessCompilerGymIrDeltaScreenPair({
			control: {
				arm: "hidden-control",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1950, bzip2Ir: 13_800 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "verified", blowfishIr: 1940, bzip2Ir: 13_790 },
				],
			},
			treatment: {
				arm: "visible-ir-delta-treatment",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1900, bzip2Ir: 13_700 },
					{ callIndex: 3, outcome: "verified", blowfishIr: 1880, bzip2Ir: 13_650 },
					{ callIndex: 4, outcome: "verified", blowfishIr: 1870, bzip2Ir: 13_640 },
				],
			},
		});
		assert.equal(promising.primary.passed, true);
		assert.equal(promising.secondary.passed, true);
		assert.equal(promising.decision, "directionally-promising-requires-fresh-replication");
		assert.equal(promising.causalClaimAllowed, false);
		assert.equal(promising.gpuPromotionAllowed, false);
		const aucTieStillPromising = assessCompilerGymIrDeltaScreenPair({
			control: {
				arm: "hidden-control",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
				],
			},
			treatment: {
				arm: "visible-ir-delta-treatment",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1970, bzip2Ir: 13_800 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
				],
			},
		});
		assert.equal(aucTieStillPromising.secondary.treatmentAuc, aucTieStillPromising.secondary.controlAuc);
		assert.equal(aucTieStillPromising.decision, "directionally-promising-requires-fresh-replication");
		const inconclusive = assessCompilerGymIrDeltaScreenPair({
			control: {
				arm: "hidden-control",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 1900, bzip2Ir: 14_000 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
				],
			},
			treatment: {
				arm: "visible-ir-delta-treatment",
				candidates: [
					shared,
					{ callIndex: 2, outcome: "verified", blowfishIr: 2000, bzip2Ir: 13_700 },
					{ callIndex: 3, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
					{ callIndex: 4, outcome: "complete-semantic-rejection", blowfishIr: null, bzip2Ir: null },
				],
			},
		});
		assert.equal(inconclusive.decision, "inconclusive");
	});
});
