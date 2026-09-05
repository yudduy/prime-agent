import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { parseAuthoritativeLlvmFlags } from "../src/compiler-gym-complete-action-space-headroom.js";
import {
	assertCompilerGymProxyCascadePaidLaunchPaths,
	buildCompilerGymProxyCascadePaidPreregistration,
	COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE,
	COMPILER_GYM_PROXY_CASCADE_PAID_IMPLEMENTATION_ENTRYPOINTS,
	COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE,
	COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE,
	type CompilerGymProxyCascadePaidPreregistrationBuildInput,
	canonicalCompilerGymProxyCascadePaidPreregistration,
	captureCompilerGymProxyCascadePaidProviderRegistryClosure,
	parseCompilerGymProxyCascadePaidPreregistration,
} from "../src/compiler-gym-proxy-cascade-paid-preregistration.js";
import { COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS } from "../src/compiler-gym-proxy-cascade-paid-protocol.js";
import { capturePrimeRuntimeWorktreeSnapshot } from "../src/stock-interface-parity.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const CREATED_AT = "2026-08-30T06:00:00.000Z";
const DRAW_HEX = "00".repeat(16);

async function buildInput(overrides: Partial<CompilerGymProxyCascadePaidPreregistrationBuildInput> = {}) {
	const read = (path: string) => readFile(resolve(REPO_ROOT, path), "utf8");
	const [
		resourcePreregistrationContents,
		resourceResultContents,
		resourceLedgerContents,
		rlmResultContents,
		rlmLedgerContents,
		rlmManifestStartContents,
		rlmManifestEndContents,
		previousAttemptPreregistrationContents,
		previousAttemptResultContents,
		previousAttemptLedgerContents,
		previousAttemptTerminalSealContents,
		previousAttemptSessionContents,
		authoritativeEvaluatorContents,
		providerRegistryClosure,
	] = await Promise.all([
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.preregistration.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.result.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RESOURCE_SCREEN_EVIDENCE.ledger.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.result.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.ledger.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestStart.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_RLM_CANARY_EVIDENCE.manifestEnd.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.preregistration.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.result.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.ledger.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.terminalSeal.path),
		read(COMPILER_GYM_PROXY_CASCADE_PAID_APPARATUS_REPAIR_EVIDENCE.session.path),
		read("research/autoresearch/evaluators/compiler_gym_eval.py"),
		captureCompilerGymProxyCascadePaidProviderRegistryClosure(
			resolve(REPO_ROOT, ".autoresearch/proxy-cascade-paid-test-agent"),
		),
	]);
	const implementationClosure = [...COMPILER_GYM_PROXY_CASCADE_PAID_IMPLEMENTATION_ENTRYPOINTS]
		.sort()
		.map((relativePath) => ({ relativePath, sha256: sha256Text(relativePath) }));
	return {
		createdAt: CREATED_AT,
		drawHex: DRAW_HEX,
		repoRoot: REPO_ROOT,
		preregistrationPath: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-paid-test/preregistration.json"),
		outputDir: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-paid-test/execution"),
		resourcePreregistrationContents,
		resourceResultContents,
		resourceLedgerContents,
		rlmResultContents,
		rlmLedgerContents,
		rlmManifestStartContents,
		rlmManifestEndContents,
		previousAttemptPreregistrationContents,
		previousAttemptResultContents,
		previousAttemptLedgerContents,
		previousAttemptTerminalSealContents,
		previousAttemptSessionContents,
		authoritativeActions: parseAuthoritativeLlvmFlags(authoritativeEvaluatorContents),
		implementationClosure,
		runtimeWorktreeSnapshot: capturePrimeRuntimeWorktreeSnapshot(REPO_ROOT),
		providerRegistryClosure,
		...overrides,
	} satisfies CompilerGymProxyCascadePaidPreregistrationBuildInput;
}

describe("CompilerGym paid proxy-cascade preregistration", () => {
	it("semantically binds the passed resource screen, live RLM canary, exact protocol, and hidden audit", async () => {
		const input = await buildInput();
		const record = buildCompilerGymProxyCascadePaidPreregistration(input);
		assert.equal(record.classification, "prospective-single-randomized-order-paid-directional-pilot");
		assert.deepEqual(record.randomization.armOrder, ["full-control", "proxy-cascade"]);
		assert.equal(record.randomization.entropyBytes, 16);
		assert.equal(record.randomization.drawHex, DRAW_HEX);
		assert.equal(record.sourceEvidence.resourceScreen.semanticJoinPassed, true);
		assert.equal(record.sourceEvidence.rlmCanary.semanticJoinPassed, true);
		assert.equal(record.sourceEvidence.rlmCanary.measurementsReusableInPaidPair, false);
		assert.equal(record.sourceEvidence.apparatusRepair.semanticJoinPassed, true);
		assert.equal(record.sourceEvidence.apparatusRepair.countsAsPaidPair, false);
		assert.equal(record.sourceEvidence.apparatusRepair.measurementsReusableInReplacement, false);
		assert.equal(record.sourceEvidence.apparatusRepair.providerVisibleInReplacement, false);
		assert.equal(
			record.sourceEvidence.apparatusRepair.rejectedProviderRequestBodySha256,
			"0787ea6032c07a90f3b0ad84474b92fcea7a8f9ecbfc1f84fbfa92b3dd7acdf2",
		);
		assert.equal(record.frozenCommon.authoritativeActions.length, 124);
		assert.equal(record.frozenCommon.prompt, record.providerSpec.prompt);
		assert.equal(record.providerSpecSha256, sha256Json(record.providerSpec));
		assert.equal(record.turnContract.actualProviderCallsPerArm, 4);
		assert.equal(record.budgets.controlFreshOnlineTaskEvaluations, 8);
		assert.equal(record.budgets.treatmentFreshOnlineTaskEvaluationsNormal, 6);
		assert.equal(record.budgets.treatmentPostTerminalHiddenAuditEvaluationsMaximum, 2);
		assert.match(record.allocation.treatment, /inside-call-four/);
		assert.match(record.allocation.treatment, /outside-the-tool-four-envelope/);
		assert.match(record.allocation.hiddenAudit, /after-both-online-arms-terminal/);
		assert.match(record.allocation.hiddenAuditAccounting, /excluded-online-resource-metrics/);
		assert.equal(record.stopPolicy.outputReadinessProbeBeforeAttemptLock, true);
		assert.match(record.stopPolicy.postLockPersistenceAtomicityLimit, /attempt-lock-as-sole-durable-evidence/);
		assert.deepEqual(record.claimLimits, COMPILER_GYM_PROXY_CASCADE_PAID_CLAIM_LIMITS);
		assert.equal(record.claimLimits.causalClaimAllowed, false);
		assert.equal(record.claimLimits.winNextGate, "authorize-one-fresh-randomized-order-replication-only");
		assert.match(
			record.localAttemptLock.path,
			new RegExp(`proxy-cascade-paid-${record.scientificIdentitySha256}\\.lock$`),
		);
		assert.equal(
			record.localAttemptLock.path,
			resolve(
				homedir(),
				".local/state/prime-agent-autoresearch/attempt-locks",
				`proxy-cascade-paid-${record.scientificIdentitySha256}.lock`,
			),
		);
		assert.equal(record.remoteLocks.armPaths["full-control"].endsWith("/full-control.lock"), true);
		assert.equal(record.remoteLocks.selectionPath.endsWith("/selection.lock"), true);
		assert.equal(record.remoteLocks.onlineTerminalPath.endsWith("/online-terminal.lock"), true);
		assert.equal(record.remoteLocks.auditPath.endsWith("/hidden-audit.lock"), true);
		assert.equal(record.localSeals.auditPath.endsWith("/hidden-audit.json"), true);
		assert.doesNotThrow(() => assertCompilerGymProxyCascadePaidLaunchPaths(record.launchPaths));
		assert.deepEqual(parseCompilerGymProxyCascadePaidPreregistration({ value: record, expected: input }), record);
	});

	it("excludes timestamp and launch paths from identity but binds entropy, source closure, runtime, and provider spec", async () => {
		const input = await buildInput();
		const first = buildCompilerGymProxyCascadePaidPreregistration(input);
		const moved = buildCompilerGymProxyCascadePaidPreregistration({
			...input,
			createdAt: "2026-08-31T06:00:00.000Z",
			preregistrationPath: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-paid-moved/preregistration.json"),
			outputDir: resolve(REPO_ROOT, ".autoresearch/proxy-cascade-paid-moved/execution"),
		});
		assert.equal(moved.scientificIdentitySha256, first.scientificIdentitySha256);
		assert.equal(moved.localAttemptLock.path, first.localAttemptLock.path);
		assert.notEqual(moved.localSeals.root, first.localSeals.root);
		const newDraw = buildCompilerGymProxyCascadePaidPreregistration({ ...input, drawHex: `01${"00".repeat(15)}` });
		assert.notEqual(newDraw.scientificIdentitySha256, first.scientificIdentitySha256);
		const closureDrift = structuredClone(input);
		closureDrift.implementationClosure[0]!.sha256 = "f".repeat(64);
		assert.notEqual(
			buildCompilerGymProxyCascadePaidPreregistration(closureDrift).scientificIdentitySha256,
			first.scientificIdentitySha256,
		);
	});

	it("fails closed on prerequisite bytes, action inventory, closure, runtime, provider registry, and record drift", async () => {
		const input = await buildInput();
		const mutations: Array<(value: CompilerGymProxyCascadePaidPreregistrationBuildInput) => void> = [
			(value) => {
				value.resourceResultContents += " ";
			},
			(value) => {
				value.resourceLedgerContents += " ";
			},
			(value) => {
				value.rlmResultContents += " ";
			},
			(value) => {
				value.rlmManifestEndContents += " ";
			},
			(value) => {
				value.previousAttemptResultContents += " ";
			},
			(value) => {
				value.previousAttemptLedgerContents += " ";
			},
			(value) => {
				value.previousAttemptTerminalSealContents += " ";
			},
			(value) => {
				value.previousAttemptSessionContents += " ";
			},
			(value) => {
				value.authoritativeActions = ["-unsupported", ...value.authoritativeActions.slice(1)];
			},
			(value) => {
				value.implementationClosure = value.implementationClosure.filter(
					(source) =>
						source.relativePath !== "research/autoresearch/src/compiler-gym-proxy-cascade-paid-runner.ts",
				);
			},
			(value) => {
				value.runtimeWorktreeSnapshot.coreWorktreeDigest = "f".repeat(64);
			},
			(value) => {
				value.providerRegistryClosure.modelsJsonPresent = true as false;
			},
		];
		for (const mutate of mutations) {
			const changed = structuredClone(input);
			mutate(changed);
			assert.throws(() => buildCompilerGymProxyCascadePaidPreregistration(changed));
		}
		const record = buildCompilerGymProxyCascadePaidPreregistration(input);
		const changedRecord = structuredClone(record);
		changedRecord.budgets = { ...changedRecord.budgets, perArmActualProviderDispatches: 3 as 4 };
		assert.throws(() => parseCompilerGymProxyCascadePaidPreregistration({ value: changedRecord, expected: input }));
	});

	it("serializes one canonical newline-terminated preregistration and rejects overlapping launch paths", async () => {
		const record = buildCompilerGymProxyCascadePaidPreregistration(await buildInput());
		assert.equal(
			canonicalCompilerGymProxyCascadePaidPreregistration(record),
			`${canonicalJson(toJsonValue(record))}\n`,
		);
		const paths = structuredClone(record.launchPaths);
		paths.controlOutputDir = paths.treatmentOutputDir;
		assert.throws(
			() => assertCompilerGymProxyCascadePaidLaunchPaths(paths),
			/derived launch paths drifted|must be disjoint/,
		);
	});
});
