import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { runCompilerGymActionSpaceVisibilityCli } from "../src/compiler-gym-action-space-visibility-first-proposal-cli.js";
import {
	buildCompilerGymActionSpaceVisibilityPreregistration,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
	canonicalCompilerGymActionSpaceVisibilityPreregistration,
	compilerGymActionSpaceVisibilityArmOrder,
	compilerGymActionSpaceVisibilityScientificLockIdentitySha256,
	writeCompilerGymActionSpaceVisibilityPreregistration,
} from "../src/compiler-gym-action-space-visibility-preregistration.js";
import {
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES,
	COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
} from "../src/compiler-gym-action-space-visibility-protocol.js";

describe("CompilerGym action-space visibility preregistration", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
	});

	it("freezes a sampled execution order, exact guide-only prompt delta, remote locks, and pair budgets before SSH", async () => {
		const root = await mkdtemp(join(tmpdir(), "visibility-prereg-"));
		roots.push(root);
		const path = join(root, "preregistration.json");
		const repoRoot = resolve(import.meta.dirname, "../../..");
		const written = await writeCompilerGymActionSpaceVisibilityPreregistration({
			repoRoot,
			path,
			createdAt: "2026-08-29T22:00:00.000Z",
		});
		assert.deepEqual(
			new Set(written.record.executionOrder.armOrder),
			new Set([
				COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
				COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
			]),
		);
		assert.equal(written.record.executionOrder.frozenBeforeSsh, true);
		assert.match(written.record.executionOrder.drawHex, /^[0-9a-f]{32}$/);
		assert.equal(written.record.executionOrder.method, "local-os-entropy-16-byte-parity-v1");
		assert.equal(written.record.executionOrder.externalCommitmentBeforeRun, false);
		assert.equal(written.record.executionOrder.tamperEvidentRandomAssignment, false);
		assert.equal(written.record.randomizedInferenceAllowed, false);
		assert.equal(written.record.tamperEvidentRandomAssignment, false);
		assert.equal(written.record.claimClass, "directional-single-order-sampled-first-proposal-pair");
		assert.match(written.record.question, /sampled-order directional pair/);
		assert.match(written.record.hypothesis, /sampled-order directional pair/);
		assert.doesNotMatch(`${written.record.question} ${written.record.hypothesis}`, /\bcauses?\b/i);
		assert.equal(written.record.prompts.guideDeltaBytes, COMPILER_GYM_ACTION_SPACE_VISIBILITY_GUIDE_DELTA_BYTES);
		assert.equal(written.record.prompts.normalizedSha256.length, 64);
		assert.notEqual(
			written.record.prompts.promptSha256ByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM],
			written.record.prompts.promptSha256ByArm[COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM],
		);
		assert.equal(
			written.record.sharedS12Gate.attemptLock,
			"separate-create-only-remote-lock-before-s12-evaluator-dispatch",
		);
		assert.equal(written.record.sharedS12Gate.retries, 0);
		assert.notEqual(written.record.remoteLocks.sharedS12GatePath, written.record.remoteLocks.globalPath);
		assert.equal(
			written.record.remoteLocks.root,
			`${written.record.remoteLocks.parentRoot}/${written.record.remoteLocks.scientificIdentitySha256.slice(0, 32)}`,
		);
		assert.ok(written.record.remoteLocks.sharedS12GatePath.startsWith(written.record.remoteLocks.root));
		assert.equal(written.record.remoteLocks.createOnly, true);
		assert.equal(written.record.budgets.providerDispatchesTotal, 2);
		assert.equal(written.record.budgets.candidateEvaluationsTotal, 2);
		assert.equal(written.record.budgets.freshTaskEvaluationsTotal, 4);
		assert.equal(written.record.budgets.totalCpuAllocationsIncludingSmoke, 6);
		assert.equal(written.record.budgets.gpus, 0);
		assert.equal(
			written.record.budgets.outputTokensPerArmPostResponseMaximum,
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_OUTPUT_TOKEN_LIMIT,
		);
		assert.equal(written.record.decisionPolicy.noUniqueOmittedFlagWithoutDominance, "kill-broad-list-visibility");
		assert.equal(written.record.decisionPolicy.dominanceWithoutUniqueOmittedFlag, "inconclusive");
		assert.equal(written.record.nanogptPromotionAllowed, false);
		assert.equal(written.record.frozenCommon.accountingEvidenceVersion, "exact-three-row-v1");
		assert.equal(written.record.frozenCommon.accountingMode, "required");
		assert.equal(written.record.launch.runtimeMode, "production-defaults-no-dependency-injection");
		assert.equal(written.record.launch.runArgv[2], "run");
		assert.equal(written.record.launch.runArgv.at(-1), resolve(root, "paid-pair-output"));
		assert.ok(
			written.record.implementationClosure.some(
				(record) =>
					record.relativePath === "research/autoresearch/src/compiler-gym-complete-action-space-headroom.ts",
			),
		);
		assert.deepEqual(
			written.record.implementationClosure.map((record) => record.relativePath),
			[...written.record.implementationClosure.map((record) => record.relativePath)].sort(),
		);
		const evaluator = await readFile(
			resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_eval.py"),
			"utf8",
		);
		const resampled = buildCompilerGymActionSpaceVisibilityPreregistration({
			createdAt: "2026-08-30T00:00:00.000Z",
			drawHex: "01".repeat(16),
			repoRoot,
			preregistrationPath: join(root, "other-preregistration.json"),
			outputDir: join(root, "other-output"),
			authoritativeEvaluatorContents: evaluator,
			implementationClosure: written.record.implementationClosure.map((record, index) =>
				index === 0 ? { ...record, sha256: "f".repeat(64) } : record,
			),
			runtimeWorktreeSnapshot: written.record.runtimeWorktreeClosure.snapshot,
		});
		assert.equal(resampled.remoteLocks.root, written.record.remoteLocks.root);
		assert.notEqual(resampled.implementationBundleSha256, written.record.implementationBundleSha256);
		assert.notEqual(
			compilerGymActionSpaceVisibilityScientificLockIdentitySha256({
				...written.record.prompts,
				normalizedSha256: "f".repeat(64),
			}),
			written.record.remoteLocks.scientificIdentitySha256,
		);
		assert.throws(
			() =>
				buildCompilerGymActionSpaceVisibilityPreregistration({
					createdAt: "2026-08-30T00:00:00.000Z",
					drawHex: "01".repeat(16),
					repoRoot,
					preregistrationPath: path,
					outputDir: root,
					authoritativeEvaluatorContents: evaluator,
					implementationClosure: written.record.implementationClosure,
					runtimeWorktreeSnapshot: written.record.runtimeWorktreeClosure.snapshot,
				}),
			/disjoint/,
		);
		const contents = await readFile(path, "utf8");
		assert.equal(contents, canonicalCompilerGymActionSpaceVisibilityPreregistration(written.record));
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		await assert.rejects(
			writeCompilerGymActionSpaceVisibilityPreregistration({
				repoRoot,
				path,
				createdAt: "2026-08-29T22:00:00.000Z",
			}),
			/exists|EEXIST/,
		);
	});

	it("uses byte parity without allowing malformed execution-order draws", () => {
		assert.deepEqual(compilerGymActionSpaceVisibilityArmOrder("01".repeat(16)), [
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_TREATMENT_ARM,
			COMPILER_GYM_ACTION_SPACE_VISIBILITY_CONTROL_ARM,
		]);
		assert.throws(() => compilerGymActionSpaceVisibilityArmOrder("0".repeat(31)), /lowercase-hex/);
		assert.throws(() => compilerGymActionSpaceVisibilityArmOrder("gg".repeat(16)), /lowercase-hex/);
	});

	it("does not expose deterministic entropy through the sealed CLI", async () => {
		await assert.rejects(
			runCompilerGymActionSpaceVisibilityCli([
				"preregister",
				"--repo-root",
				resolve(import.meta.dirname, "../../.."),
				"--preregistration",
				"/tmp/visibility-preregistration.json",
				"--output-dir",
				"/tmp/visibility-output",
				"--draw-hex",
				"00".repeat(16),
			]),
			/Usage/,
		);
	});
});
