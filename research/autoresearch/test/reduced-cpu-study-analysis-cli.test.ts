import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import { canonicalJson, sha256Text, toJsonValue } from "../src/canonical-json.js";
import { REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS, type ReducedCpuCompactionAudit } from "../src/reduced-cpu-study.js";
import {
	deriveReducedCpuAuthoritativeDecision,
	reconcileReducedCpuArmUsage,
	verifyReducedCpuCompactionEvidence,
	verifyReducedCpuEvaluationIdentities,
	writeReducedCpuStudyAnalysisExclusive,
} from "../src/reduced-cpu-study-analysis-cli.js";
import { REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS } from "../src/reduced-cpu-study-preregistration.js";

function identity(index: number, externalJobId: string | null = null) {
	return {
		scope: `scope-${index}`,
		jobId: `job-${index}`,
		manifestDigest: index.toString(16).padStart(64, "0"),
		externalJobId,
	};
}

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function plusUsage(left: Usage, right: Usage): Usage {
	return usage(
		left.input + right.input,
		left.output + right.output,
		left.cacheRead + right.cacheRead,
		left.cacheWrite + right.cacheWrite,
	);
}

function compactionAudit(): ReducedCpuCompactionAudit {
	const summary = "Measured evidence and the bounded continuation contract are preserved.";
	return {
		instruction: REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
		keepRecentTokens: REDUCED_CPU_COMPACTION_KEEP_RECENT_TOKENS,
		summary,
		summarySha256: sha256Text(summary),
		firstKeptEntryId: "cutpoint-entry",
		expectedFirstKeptEntryId: "cutpoint-entry",
		tokensBefore: 1_024,
		fromHook: false,
		paidProviderCalls: 1,
		transportAttempts: 1,
		providerPayloadSha256: "a".repeat(64),
		providerPayloadPriority: true,
		providerPayloadToolsAbsent: true,
		providerResponseStatus: 200,
		usage: usage(100, 10, 5),
		usageAvailable: true,
		startEvents: 1,
		endEvents: 1,
		extensionErrors: [],
		passed: true,
	};
}

function sessionText(
	input: { compaction?: ReducedCpuCompactionAudit; normalUsages?: Usage[]; blockedUsages?: Usage[] } = {},
): string {
	const compaction = input.compaction ?? compactionAudit();
	const records: unknown[] = [
		{ type: "session", version: 3, id: "session-id", timestamp: "2026-08-30T00:00:00.000Z" },
		...(input.normalUsages ?? [usage(20, 2), usage(30, 3)]).map((messageUsage, index) => ({
			type: "message",
			id: `normal-${index}`,
			message: { role: "assistant", stopReason: "toolUse", usage: messageUsage },
		})),
		...(input.blockedUsages ?? [usage(0, 0), usage(0, 0)]).map((messageUsage, index) => ({
			type: "message",
			id: `blocked-${index}`,
			message: { role: "assistant", stopReason: "aborted", usage: messageUsage },
		})),
		{
			type: "compaction",
			id: "compaction-entry",
			summary: compaction.summary,
			firstKeptEntryId: compaction.firstKeptEntryId,
			tokensBefore: compaction.tokensBefore,
			fromHook: false,
			customInstructions: REDUCED_CPU_STUDY_COMPACTION_INSTRUCTIONS,
		},
	];
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

describe("reduced CPU authoritative analysis CLI", () => {
	it("requires unique durable jobs and manifests while documenting cold-adapter null external IDs", () => {
		const summary = verifyReducedCpuEvaluationIdentities([
			identity(1),
			identity(2, "slurm-200"),
			identity(3, "slurm-300"),
		]);
		assert.deepEqual(summary, {
			count: 3,
			jobIdsUnique: true,
			manifestDigestsUnique: true,
			externalJobIdsUniqueWhenPresent: true,
			externalJobIdsPresent: 2,
			externalJobIdsAbsent: 1,
			coldAdapterExternalIdentityLimitation: "null-allowed-dispatch-claims-are-the-exclusive-attempt-identity",
		});
		assert.throws(
			() => verifyReducedCpuEvaluationIdentities([identity(1), { ...identity(2), jobId: "job-1" }]),
			/duplicate job ID/,
		);
		assert.throws(
			() =>
				verifyReducedCpuEvaluationIdentities([
					identity(1),
					{ ...identity(2), manifestDigest: identity(1).manifestDigest },
				]),
			/duplicate manifest digest/,
		);
		assert.throws(
			() => verifyReducedCpuEvaluationIdentities([identity(1, "slurm-1"), identity(2, "slurm-1")]),
			/duplicate external job ID/,
		);
		assert.throws(() => verifyReducedCpuEvaluationIdentities([identity(1, "")]), /non-empty string/);
	});

	it("alone authorizes a treatment transfer and ignores the runner's preliminary decision", () => {
		const treatment = deriveReducedCpuAuthoritativeDecision({
			overall: {
				status: "selected",
				selectedArm: "M",
				reason: "M wins against Stock",
				mPlusRIncrementalWinAgainstM: false,
				mPlusRWinAgainstStock: false,
			},
		});
		assert.equal(treatment.gpuTransferAuthorized, true);
		assert.equal(treatment.gpuTransferEligibleArm, "M");
		assert.equal(treatment.authority, "post-run-model-free-analyzer-only");
		assert.equal(treatment.runnerBlockDecisionDisposition, "ignored-preliminary-nonauthoritative");

		const inconclusive = deriveReducedCpuAuthoritativeDecision({
			overall: {
				status: "inconclusive",
				selectedArm: "stock",
				reason: "no treatment clears the comparisons",
				mPlusRIncrementalWinAgainstM: false,
				mPlusRWinAgainstStock: false,
			},
		});
		assert.equal(inconclusive.winnerArm, "stock");
		assert.equal(inconclusive.gpuTransferAuthorized, false);
		assert.equal(inconclusive.gpuTransferEligibleArm, null);
	});

	it("rejects every audited compaction transport, summary, and cutpoint tamper", () => {
		const valid = compactionAudit();
		verifyReducedCpuCompactionEvidence(valid, sessionText({ compaction: valid }));

		const noPriority = { ...valid, providerPayloadPriority: false };
		assert.throws(
			() => verifyReducedCpuCompactionEvidence(noPriority, sessionText({ compaction: noPriority })),
			/priority/,
		);
		const toolsPresent = { ...valid, providerPayloadToolsAbsent: false };
		assert.throws(
			() => verifyReducedCpuCompactionEvidence(toolsPresent, sessionText({ compaction: toolsPresent })),
			/exposed tools/,
		);
		const failedResponse = { ...valid, providerResponseStatus: 503 };
		assert.throws(
			() => verifyReducedCpuCompactionEvidence(failedResponse, sessionText({ compaction: failedResponse })),
			/not 2xx/,
		);
		const badSummaryHash = { ...valid, summarySha256: "b".repeat(64) };
		assert.throws(
			() => verifyReducedCpuCompactionEvidence(badSummaryHash, sessionText({ compaction: badSummaryHash })),
			/summary hash/,
		);
		const badCutpoint = { ...valid, expectedFirstKeptEntryId: "different-entry" };
		assert.throws(
			() => verifyReducedCpuCompactionEvidence(badCutpoint, sessionText({ compaction: badCutpoint })),
			/cutpoint/,
		);
		const persistedCutpoint = sessionText({ compaction: valid }).replace("cutpoint-entry", "foreign-entry");
		assert.throws(() => verifyReducedCpuCompactionEvidence(valid, persistedCutpoint), /persisted compaction entry/);
	});

	it("recomputes paid arm usage from persisted assistant messages plus compaction", () => {
		const compaction = compactionAudit();
		const normalUsages = [usage(20, 2), usage(30, 3)];
		const normalUsage = plusUsage(normalUsages[0], normalUsages[1]);
		const armUsage = plusUsage(normalUsage, compaction.usage);
		const persisted = sessionText({ compaction, normalUsages });
		const reconciled = reconcileReducedCpuArmUsage({
			sessionText: persisted,
			compactionUsage: compaction.usage,
			rawArmUsage: armUsage,
			rawOutputTokens: armUsage.output,
			expectedAgentProviderCalls: 2,
		});
		assert.equal(reconciled.normalAssistantMessageCount, 2);
		assert.equal(reconciled.blockedAssistantMessageCount, 2);
		assert.deepEqual(reconciled.normalAssistantUsage, normalUsage);
		assert.deepEqual(reconciled.recomputedArmUsage, armUsage);

		assert.throws(
			() =>
				reconcileReducedCpuArmUsage({
					sessionText: persisted,
					compactionUsage: compaction.usage,
					rawArmUsage: normalUsage,
					rawOutputTokens: normalUsage.output,
					expectedAgentProviderCalls: 2,
				}),
			/persisted assistant plus compaction usage/,
		);
		const tamperedCompactionUsage = usage(
			compaction.usage.input,
			compaction.usage.output + 1,
			compaction.usage.cacheRead,
			compaction.usage.cacheWrite,
		);
		assert.throws(
			() =>
				reconcileReducedCpuArmUsage({
					sessionText: persisted,
					compactionUsage: tamperedCompactionUsage,
					rawArmUsage: armUsage,
					rawOutputTokens: armUsage.output,
					expectedAgentProviderCalls: 2,
				}),
			/persisted assistant plus compaction usage/,
		);
		assert.throws(
			() =>
				reconcileReducedCpuArmUsage({
					sessionText: sessionText({ compaction, normalUsages, blockedUsages: [usage(1, 0)] }),
					compactionUsage: compaction.usage,
					rawArmUsage: armUsage,
					rawOutputTokens: armUsage.output,
					expectedAgentProviderCalls: 2,
				}),
			/blocked assistant message contains paid usage/,
		);
	});

	it("writes one canonical mode-0600 analysis file and refuses replacement", async () => {
		const directory = await mkdtemp(join(tmpdir(), "reduced-cpu-analysis-"));
		try {
			const path = join(directory, "analysis.json");
			const value = { z: 2, a: { result: "authoritative" } };
			await writeReducedCpuStudyAnalysisExclusive(path, value);
			assert.equal(await readFile(path, "utf8"), `${canonicalJson(toJsonValue(value))}\n`);
			assert.equal((await stat(path)).mode & 0o777, 0o600);
			await assert.rejects(() => writeReducedCpuStudyAnalysisExclusive(path, value), /EEXIST|exist/i);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
