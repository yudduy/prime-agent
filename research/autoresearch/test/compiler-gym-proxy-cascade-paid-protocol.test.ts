import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { sha256Json } from "../src/canonical-json.js";
import { parseAuthoritativeLlvmFlags } from "../src/compiler-gym-complete-action-space-headroom.js";
import {
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
} from "../src/compiler-gym-ir-delta-screen-protocol.js";
import {
	assertCompilerGymProxyCascadePaidRequestPolicy,
	assertCompilerGymProxyCascadePaidRequestSequence,
	COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY,
	type CompilerGymProxyCascadePaidArmObservation,
	type CompilerGymProxyCascadePaidCallOrdinal,
	type CompilerGymProxyCascadePaidCandidate,
	type CompilerGymProxyCascadePaidPoint,
	type CompilerGymProxyCascadePaidTaskMeasurement,
	compilerGymProxyCascadePaidArmOrder,
	compilerGymProxyCascadePaidParetoFrontier,
	compilerGymProxyCascadePaidWeaklyCovers,
	evaluateCompilerGymProxyCascadePaidPair,
	selectCompilerGymProxyCascadePaidBzip2Ordinals,
	selectCompilerGymProxyCascadePaidChampion,
} from "../src/compiler-gym-proxy-cascade-paid-protocol.js";
import { STOCK_CPU_TASKS, type StockCpuEvaluationRequest } from "../src/stock-cpu-protocol.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const BLOWFISH = STOCK_CPU_TASKS[0];
const BZIP2 = STOCK_CPU_TASKS[1];

async function authoritativeActions(): Promise<string[]> {
	return parseAuthoritativeLlvmFlags(
		await readFile(resolve(REPO_ROOT, "research/autoresearch/evaluators/compiler_gym_eval.py"), "utf8"),
	);
}

function requests(): [
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
	StockCpuEvaluationRequest,
] {
	return [
		structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
		{
			...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actions: [...COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.actions, "-dce"],
		},
		{
			...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actions: [...COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.actions, "-bdce"],
		},
		{
			...structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actions: [...COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST.actions, "-licm"],
		},
	];
}

function task(input: {
	benchmarkId: typeof BLOWFISH | typeof BZIP2;
	ir: number;
	objectBytes: number;
	phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"];
	providerVisibleAtDispatchOrdinal: 2 | 3 | 4 | null;
	cpu?: number;
	outcome?: CompilerGymProxyCascadePaidTaskMeasurement["outcome"];
}): CompilerGymProxyCascadePaidTaskMeasurement {
	return {
		benchmarkId: input.benchmarkId,
		outcome: input.outcome ?? "verified",
		irInstructionCount: input.ir,
		objectTextSizeBytes: input.objectBytes,
		verifierInputsCompleted: 20,
		measurementState: "fresh-never-reused",
		phase: input.phase,
		providerVisibleAtDispatchOrdinal: input.providerVisibleAtDispatchOrdinal,
		stepCpuSeconds: input.cpu ?? 10,
	};
}

function candidate(input: {
	ordinal: CompilerGymProxyCascadePaidCallOrdinal;
	request: StockCpuEvaluationRequest;
	blowfishIr: number;
	bzip2Ir: number;
	bzip2Phase: CompilerGymProxyCascadePaidTaskMeasurement["phase"];
	selected: boolean;
	blowfishCpu?: number;
	bzip2Cpu?: number;
	bzip2ProviderVisibleAtDispatchOrdinal?: 2 | 3 | 4 | null;
}): CompilerGymProxyCascadePaidCandidate {
	const isS12 = input.ordinal === 1;
	return {
		ordinal: input.ordinal,
		candidateSha256: sha256Json(input.request.actions),
		request: structuredClone(input.request),
		blowfish: task({
			benchmarkId: BLOWFISH,
			ir: input.blowfishIr,
			objectBytes: isS12 ? COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[BLOWFISH].objectTextSizeBytes : 20_000,
			phase: "online-tool-result",
			providerVisibleAtDispatchOrdinal: input.ordinal < 4 ? ((input.ordinal + 1) as 2 | 3 | 4) : null,
			cpu: input.blowfishCpu,
		}),
		bzip2: task({
			benchmarkId: BZIP2,
			ir: input.bzip2Ir,
			objectBytes: isS12 ? COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS[BZIP2].objectTextSizeBytes : 160_000,
			phase: input.bzip2Phase,
			providerVisibleAtDispatchOrdinal:
				input.bzip2Phase === "post-terminal-agent-inaccessible-hidden-audit"
					? null
					: input.bzip2ProviderVisibleAtDispatchOrdinal === undefined
						? input.ordinal < 4
							? ((input.ordinal + 1) as 2 | 3 | 4)
							: null
						: input.bzip2ProviderVisibleAtDispatchOrdinal,
			cpu: input.bzip2Cpu,
		}),
		selectedForOnlineBzip2: input.selected,
	};
}

function armBase(
	arm: CompilerGymProxyCascadePaidArmObservation["arm"],
	candidates: CompilerGymProxyCascadePaidCandidate[],
): CompilerGymProxyCascadePaidArmObservation {
	return {
		arm,
		requests: requests(),
		candidates,
		actualProviderDispatches: 4,
		actualToolCalls: 4,
		successfulToolCallAssistantMessages: 4,
		blockedProviderDispatchesAfterTerminal: 1,
		abortedContinuationPersisted: true,
		abortedContinuationUsageTokens: 0,
		abortedContinuationTransportDispatches: 0,
		liveEnvironmentGatePasses: 4,
		providerRetries: 0,
		providerReplacements: 0,
		measurementReuseCount: 0,
		duplicateDispatchCount: 0,
		compactionCount: 0,
		rlmChildCount: 0,
		forbiddenToolCallCount: 0,
		terminalToolOutputsPersistedBeforeNextRequest: true,
		sessionContinuityPassed: true,
		providerTranscriptHistoryGuardPassed: true,
		modelAuthSystemToolParityPassed: true,
		sessionLedgerArtifactSourceWorktreeIntegrityPassed: true,
		outputTokens: 10_000,
		outputTokenCheckpointExceeded: false,
		onlineEvaluatorWaitMicros: arm === "full-control" ? 100_000_000 : 80_000_000,
		providerWallMicros: arm === "full-control" ? 30_000_000 : 90_000_000,
		totalWallMicros: arm === "full-control" ? 130_000_000 : 170_000_000,
	};
}

function pair() {
	const requestSet = requests();
	const control = [
		candidate({
			ordinal: 1,
			request: requestSet[0],
			blowfishIr: 1970,
			bzip2Ir: 13_838,
			bzip2Phase: "online-tool-result",
			selected: true,
		}),
		candidate({
			ordinal: 2,
			request: requestSet[1],
			blowfishIr: 1950,
			bzip2Ir: 13_820,
			bzip2Phase: "online-tool-result",
			selected: true,
		}),
		candidate({
			ordinal: 3,
			request: requestSet[2],
			blowfishIr: 1940,
			bzip2Ir: 13_810,
			bzip2Phase: "online-tool-result",
			selected: true,
		}),
		candidate({
			ordinal: 4,
			request: requestSet[3],
			blowfishIr: 1930,
			bzip2Ir: 13_800,
			bzip2Phase: "online-tool-result",
			selected: true,
		}),
	];
	const treatment = [
		candidate({
			ordinal: 1,
			request: requestSet[0],
			blowfishIr: 1970,
			bzip2Ir: 13_838,
			bzip2Phase: "post-terminal-agent-inaccessible-hidden-audit",
			selected: false,
			blowfishCpu: 8,
			bzip2Cpu: 30,
		}),
		candidate({
			ordinal: 2,
			request: requestSet[1],
			blowfishIr: 1900,
			bzip2Ir: 13_700,
			bzip2Phase: "online-agent-inaccessible-selected-confirmation",
			selected: true,
			blowfishCpu: 8,
			bzip2Cpu: 15,
			bzip2ProviderVisibleAtDispatchOrdinal: null,
		}),
		candidate({
			ordinal: 3,
			request: requestSet[2],
			blowfishIr: 1910,
			bzip2Ir: 13_720,
			bzip2Phase: "online-agent-inaccessible-selected-confirmation",
			selected: true,
			blowfishCpu: 8,
			bzip2Cpu: 15,
			bzip2ProviderVisibleAtDispatchOrdinal: null,
		}),
		candidate({
			ordinal: 4,
			request: requestSet[3],
			blowfishIr: 1980,
			bzip2Ir: 13_900,
			bzip2Phase: "post-terminal-agent-inaccessible-hidden-audit",
			selected: false,
			blowfishCpu: 8,
			bzip2Cpu: 30,
		}),
	];
	return { control: armBase("full-control", control), treatment: armBase("proxy-cascade", treatment) };
}

describe("CompilerGym paid proxy-cascade protocol", () => {
	it("binds exact S12, the complete action inventory, four distinct requests, and a 16-byte arm-order draw", async () => {
		const allowed = await authoritativeActions();
		assert.deepEqual(assertCompilerGymProxyCascadePaidRequestSequence(requests(), allowed), requests());
		assert.deepEqual(compilerGymProxyCascadePaidArmOrder("00".repeat(16)), ["full-control", "proxy-cascade"]);
		assert.deepEqual(compilerGymProxyCascadePaidArmOrder(`01${"00".repeat(15)}`), ["proxy-cascade", "full-control"]);
		assert.throws(() => compilerGymProxyCascadePaidArmOrder("00".repeat(15)), /16 lowercase hexadecimal bytes/);
		assert.throws(
			() =>
				assertCompilerGymProxyCascadePaidRequestPolicy({
					request: { ...requests()[1], actions: ["-definitely-unsupported"] },
					callOrdinal: 2,
					priorRequests: [requests()[0]],
					authoritativeActions: allowed,
				}),
			/outside the authoritative LLVM-10 inventory/,
		);
		const duplicate = requests();
		duplicate[3] = structuredClone(duplicate[2]);
		assert.throws(() => assertCompilerGymProxyCascadePaidRequestSequence(duplicate, allowed), /must be distinct/);
	});

	it("selects exact top two accepted blowfish results by IR then ordinal without expanding ties", () => {
		assert.deepEqual(
			selectCompilerGymProxyCascadePaidBzip2Ordinals([
				{ ordinal: 1, blowfish: { outcome: "verified", irInstructionCount: 100 } },
				{ ordinal: 2, blowfish: { outcome: "verified", irInstructionCount: 90 } },
				{ ordinal: 3, blowfish: { outcome: "verified", irInstructionCount: 90 } },
				{ ordinal: 4, blowfish: { outcome: "verified", irInstructionCount: 90 } },
			]),
			[2, 3],
		);
		assert.deepEqual(
			selectCompilerGymProxyCascadePaidBzip2Ordinals([
				{ ordinal: 1, blowfish: { outcome: "complete-semantic-rejection", irInstructionCount: 1 } },
				{ ordinal: 2, blowfish: { outcome: "verified", irInstructionCount: 90 } },
				{ ordinal: 3, blowfish: { outcome: "complete-semantic-rejection", irInstructionCount: 1 } },
				{ ordinal: 4, blowfish: { outcome: "verified", irInstructionCount: 80 } },
			]),
			[4, 2],
		);
	});

	it("uses unique raw Pareto vectors and exact normalized-minimax champion tie-breakers", () => {
		const points: CompilerGymProxyCascadePaidPoint[] = [
			{ ordinal: 1, candidateSha256: "b".repeat(64), blowfishIr: 1949, bzip2Ir: 14_000 },
			{ ordinal: 2, candidateSha256: "a".repeat(64), blowfishIr: 1950, bzip2Ir: 13_000 },
			{ ordinal: 3, candidateSha256: "c".repeat(64), blowfishIr: 1949, bzip2Ir: 14_000 },
		];
		assert.equal(selectCompilerGymProxyCascadePaidChampion(points)?.ordinal, 1);
		assert.deepEqual(compilerGymProxyCascadePaidParetoFrontier(points), [
			{ blowfishIr: 1949, bzip2Ir: 14_000 },
			{ blowfishIr: 1950, bzip2Ir: 13_000 },
		]);
		assert.equal(
			compilerGymProxyCascadePaidWeaklyCovers(
				[{ blowfishIr: 1900, bzip2Ir: 13_000 }],
				compilerGymProxyCascadePaidParetoFrontier(points),
			),
			true,
		);
	});

	it("passes only with 8-vs-6 online work, post-pair hidden audits, frontier retention, and adaptive S12 improvement", async () => {
		const allowed = await authoritativeActions();
		const arms = pair();
		const assessment = evaluateCompilerGymProxyCascadePaidPair({
			...arms,
			authoritativeActions: allowed,
			armOrderDrawHex: "00".repeat(16),
			armExecutionOrder: ["full-control", "proxy-cascade"],
			hiddenAuditsStartedAfterBothOnlineArmsTerminal: true,
			hiddenAuditEvidenceWasAgentInaccessible: true,
		});
		assert.equal(assessment.disposition, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalWin);
		assert.equal(Object.values(assessment.operationalGates).every(Boolean), true);
		assert.equal(Object.values(assessment.resourceGates).every(Boolean), true);
		assert.equal(Object.values(assessment.qualityGates).every(Boolean), true);
		assert.deepEqual(assessment.selection.expectedSelectedOrdinals, [2, 3]);
		assert.deepEqual(assessment.selection.omittedAcceptedOrdinals, [1, 4]);
		assert.deepEqual(assessment.accounting, {
			controlOnlineTaskEvaluations: 8,
			treatmentOnlineTaskEvaluations: 6,
			treatmentHiddenAuditEvaluations: 2,
			pairTotalTaskEvaluations: 16,
			controlOnlineStepCpuSeconds: 80,
			treatmentOnlineStepCpuSeconds: 62,
			controlOnlineEvaluatorWaitMicros: 100_000_000,
			treatmentOnlineEvaluatorWaitMicros: 80_000_000,
			providerWallMicrosDescriptive: { control: 30_000_000, treatment: 90_000_000 },
			totalWallMicrosDescriptive: { control: 130_000_000, treatment: 170_000_000 },
		});
	});

	it("classifies S12 drift as apparatus-invalid and quality/resource misses as directional nonwins", async () => {
		const allowed = await authoritativeActions();
		const drift = pair();
		drift.treatment.candidates[0]!.bzip2!.irInstructionCount++;
		assert.equal(
			evaluateCompilerGymProxyCascadePaidPair({
				...drift,
				authoritativeActions: allowed,
				armOrderDrawHex: "00".repeat(16),
				armExecutionOrder: ["full-control", "proxy-cascade"],
				hiddenAuditsStartedAfterBothOnlineArmsTerminal: true,
				hiddenAuditEvidenceWasAgentInaccessible: true,
			}).disposition,
			COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.apparatusInvalid,
		);
		const slow = pair();
		slow.treatment.onlineEvaluatorWaitMicros = 95_000_000;
		assert.equal(
			evaluateCompilerGymProxyCascadePaidPair({
				...slow,
				authoritativeActions: allowed,
				armOrderDrawHex: "00".repeat(16),
				armExecutionOrder: ["full-control", "proxy-cascade"],
				hiddenAuditsStartedAfterBothOnlineArmsTerminal: true,
				hiddenAuditEvidenceWasAgentInaccessible: true,
			}).disposition,
			COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalNonWin,
		);
	});

	it("retains a complete 20-callback semantic rejection as valid negative evidence", async () => {
		const allowed = await authoritativeActions();
		const arms = pair();
		arms.treatment.candidates[3]!.blowfish.outcome = "complete-semantic-rejection";
		arms.treatment.candidates[3]!.bzip2 = null;
		const assessment = evaluateCompilerGymProxyCascadePaidPair({
			...arms,
			authoritativeActions: allowed,
			armOrderDrawHex: "00".repeat(16),
			armExecutionOrder: ["full-control", "proxy-cascade"],
			hiddenAuditsStartedAfterBothOnlineArmsTerminal: true,
			hiddenAuditEvidenceWasAgentInaccessible: true,
		});
		assert.equal(assessment.disposition, COMPILER_GYM_PROXY_CASCADE_PAID_TERMINAL_TAXONOMY.directionalWin);
		assert.equal(assessment.accounting.treatmentHiddenAuditEvaluations, 1);
		assert.equal(assessment.accounting.pairTotalTaskEvaluations, 15);
	});
});
