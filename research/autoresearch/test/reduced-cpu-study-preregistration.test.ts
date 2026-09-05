import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FROZEN_CAMPAIGN } from "../src/campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { COMPILER_GYM_VERIFIER_EPOCH } from "../src/compiler-gym-adapter.js";
import { runReducedCpuCalibration } from "../src/reduced-cpu-study-calibration.js";
import {
	buildReducedCpuStudyPreregistration,
	captureReducedCpuStudyCalibrationBinding,
	parseReducedCpuStudyPreregistration,
	REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
	REDUCED_CPU_STUDY_LIMITS,
	REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT,
	REDUCED_CPU_STUDY_SOURCE_PATHS,
	type ReducedCpuStudyCalibrationBinding,
	type ReducedCpuStudyPreregistration,
	writeReducedCpuStudyPreregistration,
} from "../src/reduced-cpu-study-preregistration.js";
import {
	REDUCED_CPU_ALL_TASKS,
	REDUCED_CPU_EXPECTED_HARDWARE,
	REDUCED_CPU_EXPECTED_PROVENANCE,
	REDUCED_CPU_REQUIRED_VERIFIER_CHECKS,
	REDUCED_CPU_STUDY_PROTOCOL_VERSION,
	type ReducedCpuCalibration,
} from "../src/reduced-cpu-study-protocol.js";
import type { EvaluationAdapter, EvaluationJob, EvaluationOutcome } from "../src/types.js";

function calibrationBinding(): ReducedCpuStudyCalibrationBinding {
	const calibrationDirectory = "/tmp/reduced-cpu-calibration";
	const parsed: ReducedCpuCalibration = {
		protocolVersion: REDUCED_CPU_STUDY_PROTOCOL_VERSION,
		verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
		jobId: "job_0123456789abcdef01234567",
		manifestDigest: "0123456789abcdef".repeat(4),
		tasks: REDUCED_CPU_ALL_TASKS.map((benchmarkId, index) => ({
			benchmarkId,
			irInstructionCount: 10_000 + index,
			objectTextSizeBytes: 20_000 + index,
			verifierPassed: true,
		})),
		hardware: { ...REDUCED_CPU_EXPECTED_HARDWARE },
		provenance: { ...REDUCED_CPU_EXPECTED_PROVENANCE },
	};
	return {
		absolutePath: join(calibrationDirectory, "calibration.json"),
		byteSha256: "a".repeat(64),
		parsedSha256: sha256Json(parsed),
		attempt: {
			attemptId: "00000000-0000-4000-8000-000000000001",
			identitySha256: "b".repeat(64),
			lock: { absolutePath: join(calibrationDirectory, "attempt.lock"), byteSha256: "c".repeat(64) },
			startIntent: {
				absolutePath: join(calibrationDirectory, "start-intent.json"),
				byteSha256: "d".repeat(64),
			},
		},
		terminal: {
			absolutePath: join(calibrationDirectory, "result.json"),
			byteSha256: "e".repeat(64),
			outcome: "success",
			verifiedArtifactRefs: 3,
		},
		ledger: {
			absolutePath: join(calibrationDirectory, "evidence.jsonl"),
			byteSha256: "f".repeat(64),
			byteLength: 1_024,
			eventCount: 6,
			terminalEventSequence: 5,
			terminalEventSha256: "1".repeat(64),
		},
		protocolVersion: parsed.protocolVersion,
		jobId: parsed.jobId,
		manifestDigest: parsed.manifestDigest,
		verifier: {
			epoch: parsed.verifierEpoch,
			requiredChecks: [...REDUCED_CPU_REQUIRED_VERIFIER_CHECKS],
		},
		hardware: { ...parsed.hardware },
		provenance: { ...parsed.provenance },
		tasks: parsed.tasks.map((task) => ({ ...task })),
	};
}

function acceptedCalibrationTask(benchmarkId: string, index: number) {
	return {
		benchmarkId,
		status: "accepted" as const,
		metrics: { IrInstructionCount: 1_000 + index, ObjectTextSizeBytes: 2_000 + index },
		verifier: { passed: true, checks: [...REDUCED_CPU_REQUIRED_VERIFIER_CHECKS], errors: [] },
		runtimeMs: 1,
	};
}

class DeterministicCalibrationAdapter implements EvaluationAdapter {
	readonly lane = "compiler-gym" as const;

	async evaluate(job: EvaluationJob): Promise<EvaluationOutcome> {
		return {
			verifierEpoch: COMPILER_GYM_VERIFIER_EPOCH,
			tasks: job.benchmarkIds.map(acceptedCalibrationTask),
			hardware: { ...REDUCED_CPU_EXPECTED_HARDWARE },
			provenance: { ...REDUCED_CPU_EXPECTED_PROVENANCE },
			stdout: "calibration fixture stdout",
			stderr: "",
		};
	}
}

function buildRecord(
	overrides: {
		createdAt?: string;
		campaignRoot?: string;
		executionOrder?: readonly ["stock" | "M" | "M+R", "stock" | "M" | "M+R", "stock" | "M" | "M+R"];
	} = {},
): ReducedCpuStudyPreregistration {
	return buildReducedCpuStudyPreregistration({
		createdAt: overrides.createdAt ?? "2026-08-30T18:00:00.000Z",
		repoRoot: "/tmp/prime-agent",
		currentHead: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
		campaignRoot: overrides.campaignRoot ?? "/tmp/reduced-cpu-study-v1",
		calibration: calibrationBinding(),
		executionOrder: overrides.executionOrder ?? ["stock", "M", "M+R"],
		implementationSources: [...REDUCED_CPU_STUDY_SOURCE_PATHS]
			.sort()
			.map((relativePath) => ({ relativePath, byteSha256: sha256Text(relativePath) })),
	});
}

describe("reduced CPU study preregistration", () => {
	it("binds the exact three-arm typed-tool, compaction, budget, and transfer contract", () => {
		const record = buildRecord();
		assert.equal(
			record.status,
			"preregistered-after-calibration-but-before-any-study-arm-provider-or-evaluator-dispatch",
		);
		assert.deepEqual(record.executionOrder, ["stock", "M", "M+R"]);
		assert.deepEqual(
			record.arms.map((arm) => ({ id: arm.id, branchLabel: arm.branchLabel, output: arm.absoluteOutputDir })),
			[
				{
					id: "stock",
					branchLabel: "reduced-cpu-study-v1-slot-1",
					output: "/tmp/reduced-cpu-study-v1/arms/slot-1",
				},
				{
					id: "M",
					branchLabel: "reduced-cpu-study-v1-slot-2",
					output: "/tmp/reduced-cpu-study-v1/arms/slot-2",
				},
				{
					id: "M+R",
					branchLabel: "reduced-cpu-study-v1-slot-3",
					output: "/tmp/reduced-cpu-study-v1/arms/slot-3",
				},
			],
		);
		for (const arm of record.arms) {
			for (const runtimePath of [
				arm.absoluteOutputDir,
				join(arm.absoluteOutputDir, "workspace"),
				join(arm.absoluteOutputDir, "sessions"),
			]) {
				assert.doesNotMatch(runtimePath, /(?:^|[/_-])(?:stock|m-plus-r|M\+R)(?:$|[/_-])/);
			}
		}
		assert.deepEqual(record.tasks.search, [
			"benchmark://cbench-v1/qsort",
			"benchmark://cbench-v1/blowfish",
			"benchmark://cbench-v1/bzip2",
		]);
		assert.deepEqual(record.tasks.validation, ["benchmark://cbench-v1/dijkstra"]);
		assert.deepEqual(
			record.arms.map((arm) => arm.registeredCustomTools),
			[
				["autoresearch_evaluate"],
				["autoresearch_evaluate", "autoresearch_recall"],
				["autoresearch_evaluate", "autoresearch_recall"],
			],
		);
		assert.deepEqual(
			record.arms.map((arm) => arm.activeToolSetByPhase.preCompaction),
			[["autoresearch_evaluate"], ["autoresearch_evaluate"], ["autoresearch_evaluate"]],
		);
		assert.deepEqual(record.arms[0].activeToolSetByPhase.postCompactionBeforeRecall, ["autoresearch_evaluate"]);
		assert.deepEqual(record.arms[1].activeToolSetByPhase.postCompactionBeforeRecall, [
			"autoresearch_evaluate",
			"autoresearch_recall",
		]);
		assert.deepEqual(record.arms[1].activeToolSetByPhase.postCompactionAfterRecall, ["autoresearch_evaluate"]);
		assert.equal(record.commonRuntime.noTools, "builtin");
		assert.deepEqual(record.commonRuntime.defaultPrimeSystemPrompt, {
			enabled: true,
			customSystemPromptAppend: false,
		});
		assert.deepEqual(record.commonRuntime.typedEvaluatorTool.response, {
			content: {
				blocks: "exactly-one-text-block",
				encoding: "JSON.stringify",
				schema: "ReducedCpuProviderCandidateMeasurement",
				exactKeys: [
					"schemaVersion",
					"type",
					"candidateDigest",
					"actions",
					"verifierValid",
					"tasks",
					"invalidReasons",
				],
				type: "reduced_cpu_candidate_measurement",
				excludedHostFields: [
					"arm",
					"branchId",
					"ordinal",
					"jobId",
					"manifestDigest",
					"parentJobIds",
					"treatment",
					"path",
					"executionOrder",
					"branchLabel",
				],
			},
			details: { schema: "ReducedCpuStudyEvaluationEnvelope", visibility: "host-only" },
		});
		assert.deepEqual(record.commonRuntime.providerVisibleEqualityThroughCandidate3.arms, ["M", "M+R"]);
		assert.equal(
			record.commonRuntime.providerVisibleEqualityThroughCandidate3.continuationPrompt.text,
			REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT,
		);
		assert.equal(
			record.commonRuntime.providerVisibleEqualityThroughCandidate3.continuationPrompt.byteSha256,
			sha256Text(REDUCED_CPU_STUDY_MEASURED_CONTINUATION_PROMPT),
		);
		assert.deepEqual(record.commonRuntime.providerVisibleEqualityThroughCandidate3.forbiddenProviderSignals, [
			"arm-id",
			"branch-id",
			"treatment",
			"path",
			"execution-order",
			"branch-label",
			"m-plus-r",
			"retest",
		]);
		assert.equal(record.commonRuntime.typedRecallTool.request, "exact-empty-object");
		assert.deepEqual(record.commonRuntime.forbiddenTools, ["ipython", "bash", "edit", "write", "read"]);
		assert.equal(record.commonRuntime.forcedCompaction.method, "native-agent-session-compact");
		assert.equal(record.commonRuntime.forcedCompaction.keepRecentTokens, 1);
		assert.equal(record.commonRuntime.forcedCompaction.reserveTokens, 2048);
		assert.equal(record.commonRuntime.forcedCompaction.agentCallable, false);
		assert.equal(record.commonRuntime.forcedCompaction.instructions, REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS);
		assert.equal(record.commonRuntime.forcedCompaction.paidModelCallsPerArm, 1);
		assert.equal(record.commonRuntime.forcedCompaction.customCompactionHook, false);
		assert.deepEqual(record.limits, REDUCED_CPU_STUDY_LIMITS);
		assert.equal(record.limits.paidModelCalls.campaignWhenRetestInstantiated, 16);
		assert.equal(record.limits.paidModelCalls.campaignMaximum, 17);
		assert.equal(record.limits.perArm.nonCachedOutputTokens, 32_000);
		assert.equal(record.limits.campaign.nonCachedOutputTokens, 96_000);
		assert.equal(record.arms[0].features.recallAfterCompaction, "forbidden");
		assert.equal(record.arms[1].features.recallAfterCompaction, "exactly-once-before-candidate-3");
		for (const arm of record.arms) {
			assert.equal(arm.features.candidateTwoPolicy, "exact-single-pass-insertion-into-candidate-1");
		}
		assert.equal(
			record.arms[1].features.measuredEvidenceAcrossCompaction,
			"append-only-ledger-plus-exact-post-compaction-typed-recall",
		);
		assert.equal(record.arms[2].features.ineligibleRetestDisposition, "treatment-uninstantiated-no-r-credit");
		assert.equal(record.calibration.terminal.outcome, "success");
		assert.equal(record.calibration.ledger.terminalEventSequence, record.calibration.ledger.eventCount - 1);
		for (const arm of record.arms) {
			assert.equal(arm.operationClaims.writeFlag, "wx");
			assert.equal(arm.operationClaims.fileMode, "0600");
			assert.equal(arm.operationClaims.durability, "file-handle-sync-before-close");
			assert.equal(arm.operationClaims.candidates.length, 4);
			assert.equal(arm.operationClaims.retest.intentPath, arm.operationClaims.candidates[3].intentPath);
			assert.equal(arm.operationClaims.retest.resultPath, arm.operationClaims.candidates[3].resultPath);
			assert.match(arm.operationClaims.validation.intentPath, /champion-validation\.intent\.json$/);
			assert.match(arm.operationClaims.validation.resultPath, /champion-validation\.result\.json$/);
		}
		for (const path of [
			"packages/ai/src/providers/openai-codex-responses.ts",
			"packages/coding-agent/src/core/agent-session.ts",
			"packages/coding-agent/src/core/compaction/compaction.ts",
			"packages/coding-agent/src/core/extensions/runner.ts",
			"packages/coding-agent/src/core/index.ts",
			"packages/coding-agent/src/core/sdk.ts",
			"packages/coding-agent/src/index.ts",
			"research/autoresearch/src/compiler-gym-hardened-paid-provider.ts",
			"research/autoresearch/src/reduced-cpu-study-analysis-cli.ts",
			"research/autoresearch/src/stock-interface-parity.ts",
		]) {
			assert.ok(record.implementationSources.some((source) => source.relativePath === path));
		}
		assert.match(record.decision.standardTransferGate, /all-three-search-tasks/);
		assert.match(record.decision.earlyDominanceTransferGate, /candidate-3/);
		assert.match(record.decision.nanoGptTransfer, /only-one-cpu-transfer-eligible-treatment/);
		const { preregistrationSha256, ...body } = record;
		assert.equal(preregistrationSha256, sha256Json(body));
		assert.deepEqual(parseReducedCpuStudyPreregistration(record), record);
	});

	it("keeps the scientific identity path-independent while binding order and source bytes", () => {
		const first = buildRecord();
		const moved = buildRecord({
			createdAt: "2026-08-31T18:00:00.000Z",
			campaignRoot: "/tmp/reduced-cpu-study-v1-moved",
		});
		assert.equal(moved.scientificIdentitySha256, first.scientificIdentitySha256);
		assert.notEqual(moved.preregistrationSha256, first.preregistrationSha256);
		const reordered = buildRecord({ executionOrder: ["M", "stock", "M+R"] });
		assert.notEqual(reordered.scientificIdentitySha256, first.scientificIdentitySha256);
		const changed = structuredClone(first);
		changed.implementationSources[0]!.byteSha256 = "f".repeat(64);
		assert.throws(() => parseReducedCpuStudyPreregistration(changed));
	});

	it("strictly rejects drift and unknown fields", () => {
		const mutations: Array<(record: ReducedCpuStudyPreregistration) => void> = [
			(record) => {
				Object.assign(record.model, { transport: "websocket" });
			},
			(record) => {
				record.executionOrder = ["stock", "M", "M"];
			},
			(record) => {
				Object.assign(record.limits.perArm, { nonCachedOutputTokens: 31_999 });
			},
			(record) => {
				record.commonRuntime.forcedCompaction.keepRecentTokens = 2 as 1;
			},
			(record) => {
				Object.assign(record.arms[1].activeToolSetByPhase, {
					postCompactionBeforeRecall: ["autoresearch_evaluate"],
				});
			},
			(record) => {
				Object.assign(record.arms[0].operationClaims, { durability: "none" });
			},
			(record) => {
				record.calibration.byteSha256 = "b".repeat(64);
			},
			(record) => {
				record.preregistrationSha256 = "c".repeat(64);
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(buildRecord());
			mutate(changed);
			assert.throws(() => parseReducedCpuStudyPreregistration(changed));
		}
		const extra = { ...buildRecord(), surprise: true };
		assert.throws(() => parseReducedCpuStudyPreregistration(extra));
	});

	it("captures only a private successful calibration with matching attempt, job, and strict terminal ledger", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "reduced-cpu-prereg-calibration-"));
		try {
			const result = await runReducedCpuCalibration({
				outputDir: join(root, "calibration"),
				adapter: new DeterministicCalibrationAdapter(),
			});
			const captured = await captureReducedCpuStudyCalibrationBinding(result.resultPath);
			assert.equal(captured.absolutePath, result.resultPath);
			assert.equal(captured.terminal.absolutePath, result.terminalResultPath);
			assert.equal(captured.terminal.outcome, "success");
			assert.equal(captured.attempt.attemptId, result.terminal.attemptId);
			assert.equal(captured.jobId, result.calibration.jobId);
			assert.equal(captured.ledger.eventCount, result.terminal.knownLedgerState.eventCount);
			assert.equal(captured.ledger.terminalEventSequence, captured.ledger.eventCount - 1);

			const resultPath = result.terminalResultPath;
			const ledgerPath = captured.ledger.absolutePath;
			const originalResult = await readFile(resultPath);
			const originalLedger = await readFile(ledgerPath);

			await chmod(resultPath, 0o644);
			await assert.rejects(
				captureReducedCpuStudyCalibrationBinding(result.resultPath),
				/calibration result must be mode 0600/,
			);
			await chmod(resultPath, 0o600);

			const hiddenResultPath = join(root, "hidden-result.json");
			await rename(resultPath, hiddenResultPath);
			await assert.rejects(captureReducedCpuStudyCalibrationBinding(result.resultPath), /ENOENT/);
			await rename(hiddenResultPath, resultPath);

			type MutableTerminal = {
				outcome: string;
				attemptId: string;
				calibrationPath: string | null;
				ledgerTerminalManifestError: string | null;
				submitted: { jobId: string } | null;
			};
			const terminalMutations: Array<{ pattern: RegExp; mutate: (value: MutableTerminal) => void }> = [
				{
					pattern: /did not succeed/,
					mutate: (value) => {
						value.outcome = "apparatus-invalid";
					},
				},
				{
					pattern: /attempt lock identity does not match/,
					mutate: (value) => {
						value.attemptId = "different-attempt";
					},
				},
				{
					pattern: /submitted job drifted/,
					mutate: (value) => {
						assert.ok(value.submitted);
						value.submitted.jobId = "job_000000000000000000000000";
					},
				},
				{
					pattern: /path does not match calibration.json/,
					mutate: (value) => {
						value.calibrationPath = join(root, "wrong-calibration.json");
					},
				},
				{
					pattern: /terminal ledger manifest reported an error/,
					mutate: (value) => {
						value.ledgerTerminalManifestError = "fixture terminalization failure";
					},
				},
			];
			for (const mutation of terminalMutations) {
				const changed = JSON.parse(originalResult.toString("utf8")) as MutableTerminal;
				mutation.mutate(changed);
				await writeFile(resultPath, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });
				await assert.rejects(captureReducedCpuStudyCalibrationBinding(result.resultPath), mutation.pattern);
				await writeFile(resultPath, originalResult, { mode: 0o600 });
			}

			await writeFile(ledgerPath, Buffer.concat([originalLedger, Buffer.from(" ")]), { mode: 0o600 });
			await assert.rejects(captureReducedCpuStudyCalibrationBinding(result.resultPath), /Strict ledger/);
			await writeFile(ledgerPath, originalLedger, { mode: 0o600 });
			assert.deepEqual(await captureReducedCpuStudyCalibrationBinding(result.resultPath), captured);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("writes one exclusive mode-0600 canonical preregistration", async () => {
		const root = await mkdtemp(join(tmpdir(), "reduced-cpu-prereg-"));
		try {
			const path = join(root, "preregistration.json");
			const record = buildRecord({ campaignRoot: root });
			const written = await writeReducedCpuStudyPreregistration(path, record);
			const contents = await readFile(path, "utf8");
			assert.equal(contents, `${canonicalJson(toJsonValue(record))}\n`);
			assert.equal(written.fileSha256, sha256Text(contents));
			assert.equal((await stat(path)).mode & 0o777, 0o600);
			await assert.rejects(() => writeReducedCpuStudyPreregistration(path, record));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
