import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import {
	buildCompilerGymIrDeltaScreenPreregistration,
	COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE,
	COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE,
	COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS,
	parseCompilerGymIrDeltaScreenPreregistration,
	verifyCompilerGymIrDeltaScreenApparatusLineage,
	verifyCompilerGymIrDeltaScreenPrerequisites,
	writeCompilerGymIrDeltaScreenPreregistration,
} from "../src/compiler-gym-ir-delta-screen-preregistration.js";
import { buildCompilerGymIrDeltaScreenPrompt } from "../src/compiler-gym-ir-delta-screen-protocol.js";
import { capturePrimeRuntimeWorktreeSnapshot, PRIME_RUNTIME_WORKTREE_PATHS } from "../src/stock-interface-parity.js";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const RUNTIME_WORKTREE_SNAPSHOT = capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT);

const CLOSURE = COMPILER_GYM_IR_DELTA_SCREEN_IMPLEMENTATION_PATHS.map((relativePath) => ({
	relativePath,
	sha256: sha256Text(relativePath),
}));

describe("CompilerGym paid IR-delta screen preregistration", () => {
	it("freezes pair order, exact paid authorization, evidence, and source closure", () => {
		const even = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure: CLOSURE,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		assert.equal(even.schemaVersion, 2);
		assert.equal(even.protocol, "compiler-gym-ir-delta-paid-screen-preregistration-v2");
		assert.equal(even.screenProtocol, "compiler-gym-ir-delta-paid-screen-v1");
		assert.equal(even.pairId, "compiler-gym-ir-delta-paid-screen-pair-v2");
		assert.deepEqual(
			even.arms.map((arm) => arm.runId),
			[
				"compiler-gym-ir-delta-paid-screen-pair-v2:hidden-control",
				"compiler-gym-ir-delta-paid-screen-pair-v2:visible-ir-delta-treatment",
			],
		);
		assert.deepEqual(even.apparatusLineage, COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE);
		assert.deepEqual(even.randomization.armOrder, ["hidden-control", "visible-ir-delta-treatment"]);
		assert.equal(even.authorization.exactActualProviderDispatches, 8);
		assert.equal(even.authorization.maximumActualProviderDispatches, 8);
		assert.equal(even.budgets.pairTotals.evaluatorJobs, 8);
		assert.equal(even.budgets.pairTotals.freshTaskEvaluations, 16);
		assert.equal(even.budgets.pairTotals.reusedTaskEvaluations, 0);
		assert.equal(even.frozenCommon.promptSha256, sha256Text(buildCompilerGymIrDeltaScreenPrompt()));
		assert.deepEqual(even.formalEvidence, COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE);
		assert.equal(even.formalEvidence.preregistration.sha256.startsWith("c9be"), true);
		assert.equal(even.formalEvidence.result.sha256.startsWith("060631"), true);
		assert.equal(even.formalEvidence.ledger.sha256.startsWith("e7dec"), true);
		assert.equal(even.formalEvidence.assessmentEventSha256.startsWith("7b5e"), true);
		assert.equal(even.formalEvidence.terminalEventSha256.startsWith("50e5"), true);
		assert.equal(
			even.frozenCommon.calibrationArtifact.path,
			".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json",
		);
		assert.equal(
			even.implementationClosure.some(
				(record) => record.relativePath === "research/autoresearch/src/stock-interface-parity.ts",
			),
			true,
		);
		assert.equal(
			even.implementationClosure.some(
				(record) => record.relativePath === "research/autoresearch/src/evaluation-adapter-output-error.ts",
			),
			true,
		);
		assert.equal(even.causalClaimAllowed, false);
		assert.equal(even.replicationClaimAllowed, false);
		assert.equal(even.gpuPromotionAllowed, false);
		assert.deepEqual(even.runtimeWorktreeClosure.roots, PRIME_RUNTIME_WORKTREE_PATHS);
		assert.deepEqual(even.runtimeWorktreeClosure.snapshot, RUNTIME_WORKTREE_SNAPSHOT);
		assert.deepEqual(parseCompilerGymIrDeltaScreenPreregistration(even, CLOSURE, RUNTIME_WORKTREE_SNAPSHOT), even);

		const odd = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: `01${"00".repeat(15)}`,
			implementationClosure: CLOSURE,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		assert.deepEqual(odd.randomization.armOrder, ["visible-ir-delta-treatment", "hidden-control"]);
	});

	it("rejects source, authorization, and first-request mutations", () => {
		const original = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure: CLOSURE,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		for (const mutate of [
			(value: typeof original) => {
				value.authorization.maximumActualProviderDispatches = 9 as 8;
			},
			(value: typeof original) => {
				value.firstToolCall.request.hypothesis = "mutated";
			},
			(value: typeof original) => {
				value.implementationClosure[0]!.sha256 = "f".repeat(64);
			},
			(value: typeof original) => {
				value.runtimeWorktreeClosure.snapshot.trackedDiffSha256 = "f".repeat(64);
			},
			(value: typeof original) => {
				(value.apparatusLineage.predecessor.result as { sha256: string }).sha256 = "f".repeat(64);
			},
		]) {
			const changed = structuredClone(original);
			mutate(changed);
			assert.throws(() => parseCompilerGymIrDeltaScreenPreregistration(changed, CLOSURE, RUNTIME_WORKTREE_SNAPSHOT));
		}
	});

	it("writes one canonical create-exclusive mode-0600 preregistration", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-paid-prereg-"));
		const path = join(root, "nested", "preregistration.json");
		const preregistration = buildCompilerGymIrDeltaScreenPreregistration({
			createdAt: "2026-08-29T01:00:00.000Z",
			drawHex: "00".repeat(16),
			implementationClosure: CLOSURE,
			runtimeWorktreeSnapshot: RUNTIME_WORKTREE_SNAPSHOT,
		});
		await writeCompilerGymIrDeltaScreenPreregistration(path, preregistration);
		const contents = await readFile(path, "utf8");
		assert.equal(contents, `${canonicalJson(toJsonValue(preregistration))}\n`);
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		await assert.rejects(writeCompilerGymIrDeltaScreenPreregistration(path, preregistration), /EEXIST/);
	});

	it("verifies the exact private formal and calibration prerequisite bytes", async () => {
		const integrity = await verifyCompilerGymIrDeltaScreenPrerequisites(REPO_ROOT);
		assert.equal(integrity.allFilesMode0600, true);
		assert.equal(integrity.paidScreenEligible, true);
		assert.equal(
			integrity.formalAssessmentEventSha256,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.assessmentEventSha256,
		);
		assert.equal(
			integrity.formalTerminalEventSha256,
			COMPILER_GYM_IR_DELTA_SCREEN_FORMAL_EVIDENCE.terminalEventSha256,
		);
		assert.deepEqual(integrity.apparatusLineage, {
			apparatusEpoch: 2,
			predecessorPreregistrationSha256:
				COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.preregistration.sha256,
			predecessorResultSha256: COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.result.sha256,
			predecessorLedgerSha256: COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.ledger.sha256,
			predecessorTerminalEventSha256: COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.terminalEventSha256,
			predecessorTerminalDisposition: "terminal-apparatus-invalid-not-treatment-result",
			predecessorScientificResultAdmitted: false,
			freshApparatusEpochNotRetryOrReplacement: true,
		});
	});

	it("rejects tampered predecessor bytes before a v2 paid-screen preflight can pass", async () => {
		const root = await mkdtemp(join(tmpdir(), "prime-ir-delta-paid-lineage-"));
		for (const evidence of [
			COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.preregistration,
			COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.result,
			COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.ledger,
		]) {
			const destination = join(root, evidence.path);
			await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
			await writeFile(destination, await readFile(join(REPO_ROOT, evidence.path)), { mode: 0o600 });
			await chmod(destination, 0o600);
		}
		await verifyCompilerGymIrDeltaScreenApparatusLineage(root);
		const resultPath = join(root, COMPILER_GYM_IR_DELTA_SCREEN_APPARATUS_LINEAGE.predecessor.result.path);
		await writeFile(resultPath, `${await readFile(resultPath, "utf8")} `, "utf8");
		await assert.rejects(
			verifyCompilerGymIrDeltaScreenApparatusLineage(root),
			/Prerequisite evidence SHA-256 drifted/,
		);
	});
});
