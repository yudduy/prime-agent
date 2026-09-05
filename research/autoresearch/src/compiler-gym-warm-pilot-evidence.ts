import { type JsonValue, sha256Json, toJsonValue } from "./canonical-json.js";
import {
	type CompilerGymWarmPilotRecordEvidence,
	validateCompilerGymWarmPilotRecordEvidence,
} from "./compiler-gym-warm-pilot-record-evidence.js";
import type {
	CompilerGymWarmAcquisitionCleanupVerification,
	CompilerGymWarmCleanupVerification,
} from "./compiler-gym-warm-transport.js";

export const COMPILER_GYM_WARM_PILOT_PROTOCOL = "compiler-gym-warm-pilot-block-v1" as const;

export type CompilerGymWarmPilotOutcome = "succeeded" | "failed" | "aborted";
export type CompilerGymWarmPilotEvidenceKind =
	| "block-started"
	| "evaluation-terminal"
	| "cleanup-started"
	| "cleanup-verified"
	| "cleanup-failed"
	| "block-ended";

export interface CompilerGymWarmPilotEvidenceRecord {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_WARM_PILOT_PROTOCOL;
	blockId: string;
	sequence: number;
	kind: CompilerGymWarmPilotEvidenceKind;
	monotonicNs: string;
	data: JsonValue;
}

export interface CompilerGymWarmPilotBlockMarks {
	blockStartedNs: bigint;
	resourcesReadyNs: bigint;
	controllerReadyNs: bigint;
	submitStartedNs: bigint;
	submittedNs: bigint;
	evaluationTerminalNs: bigint;
	cleanupStartedNs: bigint;
	cleanupVerifiedNs: bigint;
	blockEndedNs: bigint;
}

export interface CompilerGymWarmPilotTransportMarks {
	prepareStartedNs?: bigint;
	preparedNs?: bigint;
	publishStartedNs?: bigint;
	resultsReceivedNs?: bigint;
}

export interface CompilerGymWarmPilotCandidateMarks {
	position: number;
	firstWarmRequest: boolean;
	submitStartedNs: bigint;
	submittedNs: bigint;
	evaluationTerminalNs: bigint;
	transport: CompilerGymWarmPilotTransportMarks;
}

export interface CompilerGymWarmPilotInterval {
	clockId: "host-monotonic-v1";
	source: "process.hrtime.bigint";
	startedNs: string;
	finishedNs: string;
	durationNs: string;
}

export interface CompilerGymWarmPilotTimingSnapshot {
	timepointsNs: {
		blockStarted: string;
		resourcesReady: string;
		controllerReady: string;
		submitStarted: string;
		submitted: string;
		evaluationTerminal: string;
		cleanupStarted: string;
		cleanupVerified: string;
		blockEnded: string;
	};
	intervalsNs: {
		resourceCreation: string;
		controllerOpen: string;
		preSubmit: string;
		submit: string;
		evaluationWait: string;
		candidateWall: string;
		candidateAccounted: string;
		preCleanup: string;
		cleanup: string;
		finalize: string;
		blockTotal: string;
		accountedTotal: string;
	};
	transport: {
		prepareStarted: string | null;
		prepared: string | null;
		publishStarted: string | null;
		resultsReceived: string | null;
		allocationAndPrepare: string | null;
		preparedToPublish: string | null;
		publishedResultWait: string | null;
		observedTotal: string | null;
		accountedTotal: string | null;
	};
	candidates: Array<{
		position: number;
		firstWarmRequest: boolean;
		candidateWall: CompilerGymWarmPilotInterval;
		submit: CompilerGymWarmPilotInterval;
		evaluationWait: CompilerGymWarmPilotInterval;
		poolAcquireDurationNs: string | null;
		evaluationExcludingAcquireNs: string;
		transport: CompilerGymWarmPilotTimingSnapshot["transport"];
	}>;
}

const BLOCK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} keys mismatch: expected ${wanted.join(",")}, received ${actual.join(",")}`);
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	return value;
}

function decimal(value: unknown, label: string): bigint {
	const source = string(value, label);
	if (!DECIMAL_PATTERN.test(source)) throw new Error(`${label} must be a canonical non-negative bigint decimal`);
	return BigInt(source);
}

function nullableDecimal(value: unknown, label: string): bigint | null {
	return value === null ? null : decimal(value, label);
}

function difference(later: bigint, earlier: bigint, label: string): bigint {
	if (later <= earlier) throw new Error(`${label} timepoints must be strictly increasing`);
	return later - earlier;
}

function decimalString(value: bigint): string {
	if (value < 0n) throw new Error("Timing interval cannot be negative");
	return value.toString(10);
}

function optionalDecimalString(value: bigint | undefined): string | null {
	return value === undefined ? null : decimalString(value);
}

function optionalDifference(later: bigint | undefined, earlier: bigint | undefined): string | null {
	if (later === undefined || earlier === undefined) return null;
	return decimalString(difference(later, earlier, "Transport"));
}

function interval(startedNs: bigint, finishedNs: bigint, label: string): CompilerGymWarmPilotInterval {
	return {
		clockId: "host-monotonic-v1",
		source: "process.hrtime.bigint",
		startedNs: decimalString(startedNs),
		finishedNs: decimalString(finishedNs),
		durationNs: decimalString(difference(finishedNs, startedNs, label)),
	};
}

function transportTiming(
	transport: CompilerGymWarmPilotTransportMarks,
): CompilerGymWarmPilotTimingSnapshot["transport"] {
	const allocationAndPrepare = optionalDifference(transport.preparedNs, transport.prepareStartedNs);
	const preparedToPublish = optionalDifference(transport.publishStartedNs, transport.preparedNs);
	const publishedResultWait = optionalDifference(transport.resultsReceivedNs, transport.publishStartedNs);
	const observedTotal = optionalDifference(transport.resultsReceivedNs, transport.prepareStartedNs);
	let accountedTotal: string | null = null;
	if (allocationAndPrepare !== null && preparedToPublish !== null && publishedResultWait !== null) {
		accountedTotal = decimalString(
			BigInt(allocationAndPrepare) + BigInt(preparedToPublish) + BigInt(publishedResultWait),
		);
		if (accountedTotal !== observedTotal) throw new Error("Transport timing equation does not close exactly");
	}
	return {
		prepareStarted: optionalDecimalString(transport.prepareStartedNs),
		prepared: optionalDecimalString(transport.preparedNs),
		publishStarted: optionalDecimalString(transport.publishStartedNs),
		resultsReceived: optionalDecimalString(transport.resultsReceivedNs),
		allocationAndPrepare,
		preparedToPublish,
		publishedResultWait,
		observedTotal,
		accountedTotal,
	};
}

export function buildCompilerGymWarmPilotTiming(
	block: CompilerGymWarmPilotBlockMarks,
	candidateMarks: readonly CompilerGymWarmPilotCandidateMarks[],
	poolAcquireDurationNs?: bigint,
): CompilerGymWarmPilotTimingSnapshot {
	if (candidateMarks.length < 1 || candidateMarks.length > 4)
		throw new Error("Warm-pilot timing requires one through four candidates");
	for (let position = 0; position < candidateMarks.length; position++) {
		const candidate = candidateMarks[position];
		if (candidate.position !== position || candidate.firstWarmRequest !== (position === 0)) {
			throw new Error("Warm-pilot candidate timing positions are inconsistent");
		}
	}
	const transport = candidateMarks[0].transport;
	const resourceCreation = difference(block.resourcesReadyNs, block.blockStartedNs, "Resource creation");
	const controllerOpen = difference(block.controllerReadyNs, block.resourcesReadyNs, "Controller open");
	const submit = difference(block.submittedNs, block.submitStartedNs, "Submit");
	const evaluationWait = difference(block.evaluationTerminalNs, block.submittedNs, "Evaluation wait");
	const candidateWall = difference(block.evaluationTerminalNs, block.submitStartedNs, "Candidate wall");
	const candidateAccounted = submit + evaluationWait;
	if (candidateAccounted !== candidateWall) throw new Error("Candidate-wall timing equation does not close exactly");
	const preCleanup = difference(block.cleanupStartedNs, block.evaluationTerminalNs, "Pre-cleanup");
	const cleanup = difference(block.cleanupVerifiedNs, block.cleanupStartedNs, "Cleanup");
	const finalize = difference(block.blockEndedNs, block.cleanupVerifiedNs, "Finalize");
	const blockTotal = difference(block.blockEndedNs, block.blockStartedNs, "Block");
	const preSubmit = difference(block.submitStartedNs, block.controllerReadyNs, "Pre-submit");
	const accountedTotal =
		resourceCreation + controllerOpen + preSubmit + submit + evaluationWait + preCleanup + cleanup + finalize;
	if (accountedTotal !== blockTotal) throw new Error("Block timing equation does not close exactly");
	if (transport.preparedNs !== undefined && transport.prepareStartedNs === undefined) {
		throw new Error("Transport prepared time requires a prepare-start time");
	}
	if (transport.publishStartedNs !== undefined && transport.preparedNs === undefined) {
		throw new Error("Transport publish time requires a prepared time");
	}
	if (transport.resultsReceivedNs !== undefined && transport.publishStartedNs === undefined) {
		throw new Error("Transport result time requires a publish-start time");
	}
	const orderedTransportPoints = [
		transport.prepareStartedNs,
		transport.preparedNs,
		transport.publishStartedNs,
		transport.resultsReceivedNs,
	].filter((point): point is bigint => point !== undefined);
	for (let index = 1; index < orderedTransportPoints.length; index++) {
		if (orderedTransportPoints[index] <= orderedTransportPoints[index - 1]) {
			throw new Error("Transport timepoints must be strictly increasing");
		}
	}
	if (orderedTransportPoints.some((point) => point <= block.submitStartedNs || point >= block.evaluationTerminalNs)) {
		throw new Error("Transport timepoints must stay inside the host candidate wall interval");
	}

	const firstTransport = transportTiming(transport);
	const candidates = candidateMarks.map((candidate) => {
		const candidateWall = interval(candidate.submitStartedNs, candidate.evaluationTerminalNs, "Candidate wall");
		const submitInterval = interval(candidate.submitStartedNs, candidate.submittedNs, "Candidate submit");
		const evaluationWaitInterval = interval(
			candidate.submittedNs,
			candidate.evaluationTerminalNs,
			"Candidate evaluation wait",
		);
		if (
			BigInt(submitInterval.durationNs) + BigInt(evaluationWaitInterval.durationNs) !==
			BigInt(candidateWall.durationNs)
		) {
			throw new Error("Per-candidate timing equation does not close exactly");
		}
		const acquisition = candidate.firstWarmRequest ? poolAcquireDurationNs : undefined;
		if (acquisition !== undefined && (acquisition < 0n || acquisition > BigInt(candidateWall.durationNs))) {
			throw new Error("Pool acquisition duration is outside the first candidate wall interval");
		}
		return {
			position: candidate.position,
			firstWarmRequest: candidate.firstWarmRequest,
			candidateWall,
			submit: submitInterval,
			evaluationWait: evaluationWaitInterval,
			poolAcquireDurationNs: acquisition?.toString(10) ?? null,
			evaluationExcludingAcquireNs: (BigInt(candidateWall.durationNs) - (acquisition ?? 0n)).toString(10),
			transport: transportTiming(candidate.transport),
		};
	});

	return {
		timepointsNs: {
			blockStarted: decimalString(block.blockStartedNs),
			resourcesReady: decimalString(block.resourcesReadyNs),
			controllerReady: decimalString(block.controllerReadyNs),
			submitStarted: decimalString(block.submitStartedNs),
			submitted: decimalString(block.submittedNs),
			evaluationTerminal: decimalString(block.evaluationTerminalNs),
			cleanupStarted: decimalString(block.cleanupStartedNs),
			cleanupVerified: decimalString(block.cleanupVerifiedNs),
			blockEnded: decimalString(block.blockEndedNs),
		},
		intervalsNs: {
			resourceCreation: decimalString(resourceCreation),
			controllerOpen: decimalString(controllerOpen),
			preSubmit: decimalString(preSubmit),
			submit: decimalString(submit),
			evaluationWait: decimalString(evaluationWait),
			candidateWall: decimalString(candidateWall),
			candidateAccounted: decimalString(candidateAccounted),
			preCleanup: decimalString(preCleanup),
			cleanup: decimalString(cleanup),
			finalize: decimalString(finalize),
			blockTotal: decimalString(blockTotal),
			accountedTotal: decimalString(accountedTotal),
		},
		transport: firstTransport,
		candidates,
	};
}

export function validateCompilerGymWarmPilotTiming(value: unknown): CompilerGymWarmPilotTimingSnapshot {
	const root = record(value, "timing");
	exactKeys(root, ["candidates", "timepointsNs", "intervalsNs", "transport"], "timing");
	const timepoints = record(root.timepointsNs, "timing.timepointsNs");
	exactKeys(
		timepoints,
		[
			"blockStarted",
			"resourcesReady",
			"controllerReady",
			"submitStarted",
			"submitted",
			"evaluationTerminal",
			"cleanupStarted",
			"cleanupVerified",
			"blockEnded",
		],
		"timing.timepointsNs",
	);
	const block: CompilerGymWarmPilotBlockMarks = {
		blockStartedNs: decimal(timepoints.blockStarted, "timing.timepointsNs.blockStarted"),
		resourcesReadyNs: decimal(timepoints.resourcesReady, "timing.timepointsNs.resourcesReady"),
		controllerReadyNs: decimal(timepoints.controllerReady, "timing.timepointsNs.controllerReady"),
		submitStartedNs: decimal(timepoints.submitStarted, "timing.timepointsNs.submitStarted"),
		submittedNs: decimal(timepoints.submitted, "timing.timepointsNs.submitted"),
		evaluationTerminalNs: decimal(timepoints.evaluationTerminal, "timing.timepointsNs.evaluationTerminal"),
		cleanupStartedNs: decimal(timepoints.cleanupStarted, "timing.timepointsNs.cleanupStarted"),
		cleanupVerifiedNs: decimal(timepoints.cleanupVerified, "timing.timepointsNs.cleanupVerified"),
		blockEndedNs: decimal(timepoints.blockEnded, "timing.timepointsNs.blockEnded"),
	};
	if (!Array.isArray(root.candidates)) throw new Error("timing.candidates must be an array");
	const parseInterval = (value: unknown, label: string): { startedNs: bigint; finishedNs: bigint } => {
		const intervalRoot = record(value, label);
		exactKeys(intervalRoot, ["clockId", "source", "startedNs", "finishedNs", "durationNs"], label);
		if (intervalRoot.clockId !== "host-monotonic-v1" || intervalRoot.source !== "process.hrtime.bigint") {
			throw new Error(`${label} clock identity is invalid`);
		}
		const startedNs = decimal(intervalRoot.startedNs, `${label}.startedNs`);
		const finishedNs = decimal(intervalRoot.finishedNs, `${label}.finishedNs`);
		if (difference(finishedNs, startedNs, label) !== decimal(intervalRoot.durationNs, `${label}.durationNs`)) {
			throw new Error(`${label} duration equation does not close exactly`);
		}
		return { startedNs, finishedNs };
	};
	const parseTransport = (value: unknown, label: string): CompilerGymWarmPilotTransportMarks => {
		const transportRoot = record(value, label);
		exactKeys(
			transportRoot,
			[
				"prepareStarted",
				"prepared",
				"publishStarted",
				"resultsReceived",
				"allocationAndPrepare",
				"preparedToPublish",
				"publishedResultWait",
				"observedTotal",
				"accountedTotal",
			],
			label,
		);
		return {
			prepareStartedNs: nullableDecimal(transportRoot.prepareStarted, `${label}.prepareStarted`) ?? undefined,
			preparedNs: nullableDecimal(transportRoot.prepared, `${label}.prepared`) ?? undefined,
			publishStartedNs: nullableDecimal(transportRoot.publishStarted, `${label}.publishStarted`) ?? undefined,
			resultsReceivedNs: nullableDecimal(transportRoot.resultsReceived, `${label}.resultsReceived`) ?? undefined,
		};
	};
	const candidateMarks = root.candidates.map((candidateValue, position): CompilerGymWarmPilotCandidateMarks => {
		const candidate = record(candidateValue, `timing.candidates[${position}]`);
		exactKeys(
			candidate,
			[
				"position",
				"firstWarmRequest",
				"candidateWall",
				"submit",
				"evaluationWait",
				"poolAcquireDurationNs",
				"evaluationExcludingAcquireNs",
				"transport",
			],
			`timing.candidates[${position}]`,
		);
		if (candidate.position !== position || candidate.firstWarmRequest !== (position === 0)) {
			throw new Error("timing candidate position is invalid");
		}
		const wall = parseInterval(candidate.candidateWall, `timing.candidates[${position}].candidateWall`);
		const submit = parseInterval(candidate.submit, `timing.candidates[${position}].submit`);
		const wait = parseInterval(candidate.evaluationWait, `timing.candidates[${position}].evaluationWait`);
		if (
			submit.startedNs !== wall.startedNs ||
			wait.finishedNs !== wall.finishedNs ||
			submit.finishedNs !== wait.startedNs
		) {
			throw new Error("timing candidate subintervals do not partition candidate wall");
		}
		return {
			position,
			firstWarmRequest: position === 0,
			submitStartedNs: wall.startedNs,
			submittedNs: submit.finishedNs,
			evaluationTerminalNs: wall.finishedNs,
			transport: parseTransport(candidate.transport, `timing.candidates[${position}].transport`),
		};
	});
	const firstCandidate = record(root.candidates[0], "timing.candidates[0]");
	const poolAcquireDurationNs =
		nullableDecimal(firstCandidate.poolAcquireDurationNs, "timing.candidates[0].poolAcquireDurationNs") ?? undefined;
	const expected = buildCompilerGymWarmPilotTiming(block, candidateMarks, poolAcquireDurationNs);
	if (sha256Json(expected) !== sha256Json(root))
		throw new Error("Warm-pilot timing fields or equations are inconsistent");
	return expected;
}

function validateAcquisitionCleanupVerification(
	value: Record<string, unknown>,
): CompilerGymWarmAcquisitionCleanupVerification {
	exactKeys(
		value,
		[
			"mode",
			"protocol",
			"poolDigest",
			"action",
			"submissionAttempted",
			"discoveredSlurmIds",
			"schedulerAbsent",
			"accounting",
			"detail",
		],
		"acquisition cleanup verification",
	);
	if (value.mode !== "acquisition" || value.protocol !== "compiler-gym-warm-acquisition-cleanup-v1") {
		throw new Error("acquisition cleanup verification protocol is invalid");
	}
	const poolDigest = string(value.poolDigest, "acquisition cleanup verification poolDigest");
	if (!SHA256_PATTERN.test(poolDigest)) throw new Error("acquisition cleanup verification poolDigest is invalid");
	if (
		value.action !== "not-submitted" &&
		value.action !== "verified-absent" &&
		value.action !== "cancelled-and-verified"
	) {
		throw new Error("acquisition cleanup verification action is invalid");
	}
	if (boolean(value.schedulerAbsent, "acquisition cleanup verification schedulerAbsent") !== true) {
		throw new Error("acquisition cleanup verification did not prove scheduler absence");
	}
	const submissionAttempted = boolean(
		value.submissionAttempted,
		"acquisition cleanup verification submissionAttempted",
	);
	if (!Array.isArray(value.discoveredSlurmIds)) throw new Error("acquisition cleanup discovered IDs are invalid");
	const discoveredSlurmIds = value.discoveredSlurmIds.map((id) => {
		const observed = string(id, "acquisition cleanup discovered ID");
		if (!/^[1-9][0-9]*$/.test(observed)) throw new Error("acquisition cleanup discovered ID is invalid");
		return observed;
	});
	if (new Set(discoveredSlurmIds).size !== discoveredSlurmIds.length) {
		throw new Error("acquisition cleanup discovered IDs contain duplicates");
	}
	if (!Array.isArray(value.accounting)) throw new Error("acquisition cleanup accounting is invalid");
	return {
		mode: "acquisition",
		protocol: value.protocol,
		poolDigest,
		action: value.action,
		submissionAttempted,
		discoveredSlurmIds,
		schedulerAbsent: true,
		accounting: [...value.accounting],
		detail: string(value.detail, "acquisition cleanup detail"),
	};
}

function validateCleanupVerification(value: unknown): CompilerGymWarmCleanupVerification {
	const root = record(value, "cleanup verification");
	if (root.mode === "acquisition") return validateAcquisitionCleanupVerification(root);
	exactKeys(
		root,
		["mode", "poolDigest", "slurmId", "schedulerAbsent", "accountingState", "acknowledgedRanks"],
		"cleanup verification",
	);
	if (root.mode !== "shutdown" && root.mode !== "cancel") throw new Error("cleanup verification mode is invalid");
	const poolDigest = string(root.poolDigest, "cleanup verification poolDigest");
	if (!SHA256_PATTERN.test(poolDigest)) throw new Error("cleanup verification poolDigest must be a SHA-256");
	const slurmId = string(root.slurmId, "cleanup verification slurmId");
	if (!/^[1-9][0-9]*$/.test(slurmId)) throw new Error("cleanup verification slurmId is invalid");
	if (boolean(root.schedulerAbsent, "cleanup verification schedulerAbsent") !== true) {
		throw new Error("cleanup verification did not prove scheduler absence");
	}
	if (!Array.isArray(root.acknowledgedRanks) || root.acknowledgedRanks.some((rank) => rank !== 0 && rank !== 1)) {
		throw new Error("cleanup verification acknowledgedRanks is invalid");
	}
	return {
		mode: root.mode,
		poolDigest,
		slurmId,
		schedulerAbsent: true,
		accountingState: string(root.accountingState, "cleanup verification accountingState"),
		acknowledgedRanks: [...root.acknowledgedRanks] as (0 | 1)[],
	};
}

function validateEventData(event: CompilerGymWarmPilotEvidenceRecord): void {
	const data = record(event.data, `${event.kind}.data`);
	switch (event.kind) {
		case "block-started": {
			exactKeys(
				data,
				["arm", "candidateCount", "candidateSetSha256", "candidates", "maxInflight", "requireFreshMeasurement"],
				`${event.kind}.data`,
			);
			string(data.arm, `${event.kind}.data.arm`);
			if (
				!Number.isInteger(data.candidateCount) ||
				Number(data.candidateCount) < 1 ||
				Number(data.candidateCount) > 4
			) {
				throw new Error("block-started candidateCount must be an integer from one through four");
			}
			const digest = string(data.candidateSetSha256, `${event.kind}.data.candidateSetSha256`);
			if (!SHA256_PATTERN.test(digest)) throw new Error("block-started candidateSetSha256 must be a SHA-256");
			if (!Array.isArray(data.candidates) || data.candidates.length !== data.candidateCount) {
				throw new Error("block-started candidates do not match candidateCount");
			}
			for (let index = 0; index < data.candidates.length; index++) {
				const candidate = record(data.candidates[index], `block-started.data.candidates[${index}]`);
				exactKeys(
					candidate,
					["candidateId", "candidateSha256", "position"],
					`block-started.data.candidates[${index}]`,
				);
				if (candidate.position !== index) throw new Error("block-started candidate positions are not contiguous");
				string(candidate.candidateId, `block-started.data.candidates[${index}].candidateId`);
				if (
					!SHA256_PATTERN.test(
						string(candidate.candidateSha256, `block-started.data.candidates[${index}].candidateSha256`),
					)
				) {
					throw new Error("block-started candidate digest is invalid");
				}
			}
			if (sha256Json(data.candidates) !== digest) throw new Error("block-started candidate-set digest mismatch");
			if (data.maxInflight !== 1) throw new Error("Warm pilot maxInflight must be exactly one");
			if (data.requireFreshMeasurement !== true) throw new Error("Warm pilot must require a fresh measurement");
			return;
		}
		case "evaluation-terminal": {
			exactKeys(
				data,
				[
					"candidateId",
					"candidatePosition",
					"firstWarmRequest",
					"jobId",
					"manifestDigest",
					"measurementDigest",
					"outcome",
					"stateStatus",
				],
				`${event.kind}.data`,
			);
			string(data.candidateId, `${event.kind}.data.candidateId`);
			if (
				!Number.isInteger(data.candidatePosition) ||
				Number(data.candidatePosition) < 0 ||
				Number(data.candidatePosition) > 3
			) {
				throw new Error("evaluation-terminal candidatePosition is invalid");
			}
			if (data.firstWarmRequest !== (data.candidatePosition === 0)) {
				throw new Error("evaluation-terminal firstWarmRequest is inconsistent with position");
			}
			string(data.jobId, `${event.kind}.data.jobId`);
			for (const key of ["manifestDigest", "measurementDigest"] as const) {
				if (!SHA256_PATTERN.test(string(data[key], `${event.kind}.data.${key}`))) {
					throw new Error(`${event.kind}.data.${key} must be a SHA-256`);
				}
			}
			if (data.outcome !== "succeeded" && data.outcome !== "failed" && data.outcome !== "aborted") {
				throw new Error("evaluation-terminal outcome is invalid");
			}
			if (typeof data.stateStatus !== "string") throw new Error("evaluation-terminal stateStatus is invalid");
			return;
		}
		case "cleanup-started":
			exactKeys(data, ["allocationAttempted"], `${event.kind}.data`);
			boolean(data.allocationAttempted, `${event.kind}.data.allocationAttempted`);
			return;
		case "cleanup-verified":
			exactKeys(data, ["allocationAttempted", "recordEvidence", "verification"], `${event.kind}.data`);
			if (boolean(data.allocationAttempted, `${event.kind}.data.allocationAttempted`)) {
				const verification = validateCleanupVerification(data.verification);
				if (verification.mode === "acquisition") {
					if (data.recordEvidence !== null) {
						throw new Error("Acquisition-only cleanup cannot claim record-eligibility evidence");
					}
				} else {
					validateCompilerGymWarmPilotRecordEvidence(
						data.recordEvidence as unknown as CompilerGymWarmPilotRecordEvidence,
					);
				}
			} else if (data.verification !== null) {
				throw new Error("A non-acquired block cannot claim scheduler cleanup evidence");
			} else if (data.recordEvidence !== null) {
				throw new Error("A non-acquired block cannot claim record-eligibility evidence");
			}
			return;
		case "cleanup-failed":
			exactKeys(data, ["allocationAttempted", "error"], `${event.kind}.data`);
			boolean(data.allocationAttempted, `${event.kind}.data.allocationAttempted`);
			string(data.error, `${event.kind}.data.error`);
			return;
		case "block-ended": {
			exactKeys(
				data,
				["blockRecord", "candidateSetSha256", "completedJobIds", "outcome", "timing", "timingSha256", "trials"],
				`${event.kind}.data`,
			);
			if (!SHA256_PATTERN.test(string(data.candidateSetSha256, `${event.kind}.data.candidateSetSha256`))) {
				throw new Error("block-ended candidateSetSha256 must be a SHA-256");
			}
			if (
				!Array.isArray(data.completedJobIds) ||
				!data.completedJobIds.every((jobId) => typeof jobId === "string")
			) {
				throw new Error("block-ended completedJobIds is invalid");
			}
			if (!Array.isArray(data.trials) || data.trials.length !== data.completedJobIds.length) {
				throw new Error("block-ended trials do not match completedJobIds");
			}
			for (let position = 0; position < data.trials.length; position++) {
				const trial = record(data.trials[position], `block-ended.data.trials[${position}]`);
				exactKeys(
					trial,
					[
						"block",
						"arm",
						"position",
						"candidateDigest",
						"jobId",
						"manifestDigest",
						"firstWarmRequest",
						"candidateWall",
						"poolAcquire",
						"evaluationExcludingAcquireNs",
						"tasks",
					],
					`block-ended.data.trials[${position}]`,
				);
				if (trial.position !== position || trial.firstWarmRequest !== (position === 0)) {
					throw new Error("block-ended trial position is invalid");
				}
				for (const key of ["candidateDigest", "manifestDigest"] as const) {
					if (!SHA256_PATTERN.test(string(trial[key], `block-ended.data.trials[${position}].${key}`))) {
						throw new Error("block-ended trial digest is invalid");
					}
				}
				string(trial.block, `block-ended.data.trials[${position}].block`);
				string(trial.arm, `block-ended.data.trials[${position}].arm`);
				string(trial.jobId, `block-ended.data.trials[${position}].jobId`);
				decimal(
					trial.evaluationExcludingAcquireNs,
					`block-ended.data.trials[${position}].evaluationExcludingAcquireNs`,
				);
				if (!Array.isArray(trial.tasks) || trial.tasks.length !== 2)
					throw new Error("block-ended trial tasks are invalid");
			}
			if (data.outcome !== "succeeded" && data.outcome !== "failed" && data.outcome !== "aborted") {
				throw new Error("block-ended outcome is invalid");
			}
			const timing = validateCompilerGymWarmPilotTiming(data.timing);
			if (string(data.timingSha256, `${event.kind}.data.timingSha256`) !== sha256Json(timing)) {
				throw new Error("block-ended timing digest mismatch");
			}
			const blockTelemetry = record(data.blockRecord, "block-ended.data.blockRecord");
			exactKeys(
				blockTelemetry,
				[
					"block",
					"arm",
					"poolDigest",
					"slurmId",
					"serviceSpan",
					"closeCall",
					"blockOperational",
					"schedulerAbsentAtHostNs",
					"cleanup",
					"accounting",
				],
				"block-ended.data.blockRecord",
			);
			for (const key of ["block", "arm", "poolDigest", "slurmId"] as const) {
				string(blockTelemetry[key], `block-ended.data.blockRecord.${key}`);
			}
			decimal(blockTelemetry.schedulerAbsentAtHostNs, "block-ended.data.blockRecord.schedulerAbsentAtHostNs");
		}
	}
}

export function compilerGymWarmPilotEvidenceRecord(
	blockId: string,
	sequence: number,
	kind: CompilerGymWarmPilotEvidenceKind,
	monotonicNs: bigint,
	data: unknown,
): CompilerGymWarmPilotEvidenceRecord {
	if (!BLOCK_ID_PATTERN.test(blockId)) throw new Error("Warm-pilot blockId is invalid");
	if (!Number.isInteger(sequence) || sequence < 0) throw new Error("Warm-pilot evidence sequence is invalid");
	const event: CompilerGymWarmPilotEvidenceRecord = {
		schemaVersion: 1,
		protocol: COMPILER_GYM_WARM_PILOT_PROTOCOL,
		blockId,
		sequence,
		kind,
		monotonicNs: decimalString(monotonicNs),
		data: toJsonValue(data),
	};
	validateEventData(event);
	return event;
}

export function verifyCompilerGymWarmPilotEvidence(
	values: readonly unknown[],
	options: { requireEnd?: boolean } = {},
): readonly CompilerGymWarmPilotEvidenceRecord[] {
	const events = values.map((value, index) => {
		const root = record(value, `evidence[${index}]`);
		exactKeys(
			root,
			["schemaVersion", "protocol", "blockId", "sequence", "kind", "monotonicNs", "data"],
			`evidence[${index}]`,
		);
		if (root.schemaVersion !== 1 || root.protocol !== COMPILER_GYM_WARM_PILOT_PROTOCOL) {
			throw new Error(`evidence[${index}] has an unsupported protocol`);
		}
		if (!BLOCK_ID_PATTERN.test(string(root.blockId, `evidence[${index}].blockId`))) {
			throw new Error(`evidence[${index}] blockId is invalid`);
		}
		if (root.sequence !== index) throw new Error(`Warm-pilot evidence sequence mismatch at ${index}`);
		const kind = root.kind;
		if (
			kind !== "block-started" &&
			kind !== "evaluation-terminal" &&
			kind !== "cleanup-started" &&
			kind !== "cleanup-verified" &&
			kind !== "cleanup-failed" &&
			kind !== "block-ended"
		) {
			throw new Error(`evidence[${index}] kind is invalid`);
		}
		const event: CompilerGymWarmPilotEvidenceRecord = {
			schemaVersion: 1,
			protocol: COMPILER_GYM_WARM_PILOT_PROTOCOL,
			blockId: root.blockId as string,
			sequence: index,
			kind,
			monotonicNs: string(root.monotonicNs, `evidence[${index}].monotonicNs`),
			data: toJsonValue(root.data),
		};
		decimal(event.monotonicNs, `evidence[${index}].monotonicNs`);
		validateEventData(event);
		return event;
	});
	if (events.length === 0) {
		if (options.requireEnd) throw new Error("Warm-pilot evidence is empty");
		return events;
	}
	const blockId = events[0].blockId;
	for (let index = 0; index < events.length; index++) {
		if (events[index].blockId !== blockId) throw new Error("Warm-pilot evidence crosses block IDs");
		if (index > 0 && BigInt(events[index].monotonicNs) <= BigInt(events[index - 1].monotonicNs)) {
			throw new Error(`Warm-pilot evidence monotonic time did not increase at ${index}`);
		}
	}
	const kinds = events.map((event) => event.kind);
	const startData = record(events[0].data, "block-started.data");
	const candidateCount = Number(startData.candidateCount);
	const terminalCount = events.filter((event) => event.kind === "evaluation-terminal").length;
	const successfulOrder = [
		"block-started",
		...Array.from({ length: terminalCount }, () => "evaluation-terminal"),
		"cleanup-started",
		"cleanup-verified",
		"block-ended",
	];
	const failedCleanupOrder = [
		"block-started",
		...Array.from({ length: terminalCount }, () => "evaluation-terminal"),
		"cleanup-started",
		"cleanup-failed",
	];
	const matchesPrefix = (expected: readonly string[]): boolean =>
		kinds.length <= expected.length && kinds.every((kind, index) => kind === expected[index]);
	if (!matchesPrefix(successfulOrder) && !matchesPrefix(failedCleanupOrder)) {
		throw new Error(`Warm-pilot evidence lifecycle is invalid: ${kinds.join(" -> ")}`);
	}
	const ended = events.at(-1)?.kind === "block-ended";
	if (options.requireEnd && !ended) throw new Error("Warm-pilot evidence has no verified block end");
	if (ended) {
		if (events.at(-2)?.kind !== "cleanup-verified") {
			throw new Error("Warm-pilot block end was emitted before cleanup verification");
		}
		if (terminalCount < 1 || terminalCount > candidateCount) {
			throw new Error("Warm-pilot terminal count is inconsistent with the planned candidate count");
		}
		const terminalEvents = events.slice(1, 1 + terminalCount);
		for (let index = 0; index < terminalEvents.length; index++) {
			const terminalData = record(terminalEvents[index].data, `evaluation-terminal[${index}].data`);
			if (terminalData.candidatePosition !== index)
				throw new Error("Warm-pilot terminal positions are not contiguous");
			const candidates = startData.candidates;
			if (!Array.isArray(candidates)) throw new Error("Warm-pilot candidate manifest is invalid");
			const candidate = record(candidates[index], `block-started.data.candidates[${index}]`);
			if (terminalData.candidateId !== candidate.candidateId) {
				throw new Error("Warm-pilot terminal candidate does not match the planned position");
			}
		}
		const endData = record(events.at(-1)?.data, "block-ended.data");
		if (endData.candidateSetSha256 !== startData.candidateSetSha256) {
			throw new Error("Warm-pilot end does not bind the planned candidate set");
		}
		const completedJobIds = terminalEvents.map((event) => record(event.data, "evaluation-terminal.data").jobId);
		if (sha256Json(completedJobIds) !== sha256Json(endData.completedJobIds)) {
			throw new Error("Warm-pilot end does not bind the completed jobs");
		}
		if (!Array.isArray(endData.trials)) throw new Error("Warm-pilot end trials are invalid");
		for (let position = 0; position < terminalEvents.length; position++) {
			const terminal = record(terminalEvents[position].data, `evaluation-terminal[${position}].data`);
			const trial = record(endData.trials[position], `block-ended.data.trials[${position}]`);
			if (
				trial.block !== blockId ||
				trial.arm !== startData.arm ||
				trial.jobId !== terminal.jobId ||
				trial.manifestDigest !== terminal.manifestDigest
			) {
				throw new Error("Warm-pilot end trial does not bind its terminal event");
			}
			const candidates = startData.candidates;
			if (!Array.isArray(candidates)) throw new Error("Warm-pilot candidate manifest is invalid");
			const candidate = record(candidates[position], `block-started.data.candidates[${position}]`);
			if (trial.candidateDigest !== candidate.candidateSha256) {
				throw new Error("Warm-pilot end trial does not bind its frozen candidate");
			}
		}
		const terminalOutcomes = terminalEvents.map((event) => record(event.data, "evaluation-terminal.data").outcome);
		const expectedOutcome = terminalOutcomes.includes("aborted")
			? "aborted"
			: terminalCount === candidateCount && terminalOutcomes.every((outcome) => outcome === "succeeded")
				? "succeeded"
				: "failed";
		if (endData.outcome !== expectedOutcome) {
			throw new Error("Warm-pilot end outcome is inconsistent with completed trials");
		}
		const cleanupStartedEvent = events[1 + terminalCount];
		const cleanupVerifiedEvent = events[2 + terminalCount];
		const timing = validateCompilerGymWarmPilotTiming(endData.timing);
		const cleanupVerifiedData = record(cleanupVerifiedEvent.data, "cleanup-verified.data");
		const recordEvidence = record(cleanupVerifiedData.recordEvidence, "cleanup-verified.data.recordEvidence");
		const acquisition = record(recordEvidence.acquisition, "cleanup-verified.data.recordEvidence.acquisition");
		const endBlockRecord = record(endData.blockRecord, "block-ended.data.blockRecord");
		const cleanup = record(recordEvidence.cleanup, "cleanup-verified.data.recordEvidence.cleanup");
		if (
			endBlockRecord.block !== blockId ||
			endBlockRecord.arm !== startData.arm ||
			endBlockRecord.poolDigest !== cleanup.poolDigest ||
			endBlockRecord.slurmId !== cleanup.slurmId ||
			endBlockRecord.schedulerAbsentAtHostNs !== recordEvidence.schedulerAbsentAtHostNs ||
			sha256Json(endBlockRecord.cleanup) !== sha256Json(cleanup) ||
			sha256Json(endBlockRecord.accounting) !== sha256Json(recordEvidence.accounting)
		) {
			throw new Error("Warm-pilot block record does not bind cleanup/accounting evidence");
		}
		const expectedServiceSpan = interval(
			BigInt(timing.timepointsNs.submitStarted),
			BigInt(timing.timepointsNs.evaluationTerminal),
			"Service span",
		);
		const expectedCloseCall = interval(
			BigInt(timing.timepointsNs.cleanupStarted),
			BigInt(timing.timepointsNs.cleanupVerified),
			"Close call",
		);
		const expectedOperational = interval(
			BigInt(timing.timepointsNs.submitStarted),
			BigInt(recordEvidence.schedulerAbsentAtHostNs as string),
			"Block operational",
		);
		if (
			sha256Json(endBlockRecord.serviceSpan) !== sha256Json(expectedServiceSpan) ||
			sha256Json(endBlockRecord.closeCall) !== sha256Json(expectedCloseCall) ||
			sha256Json(endBlockRecord.blockOperational) !== sha256Json(expectedOperational)
		) {
			throw new Error("Warm-pilot block record timing equations do not close");
		}
		for (let position = 0; position < terminalCount; position++) {
			if (!Array.isArray(endData.trials)) throw new Error("Warm-pilot end trials are invalid");
			const trial = record(endData.trials[position], `block-ended.data.trials[${position}]`);
			const candidateTiming = timing.candidates[position];
			if (
				sha256Json(trial.candidateWall) !== sha256Json(candidateTiming.candidateWall) ||
				trial.evaluationExcludingAcquireNs !== candidateTiming.evaluationExcludingAcquireNs
			) {
				throw new Error("Warm-pilot trial timing does not bind host monotonic telemetry");
			}
			if (position === 0) {
				if (sha256Json(trial.poolAcquire) !== sha256Json(acquisition)) {
					throw new Error("First warm trial does not bind acquisition evidence");
				}
			} else if (trial.poolAcquire !== null) {
				throw new Error("Only the first warm trial may contain pool acquisition evidence");
			}
		}
		if (timing.timepointsNs.blockStarted !== events[0].monotonicNs) {
			throw new Error("Warm-pilot timing does not bind the block-started event");
		}
		if (timing.timepointsNs.evaluationTerminal !== terminalEvents.at(-1)?.monotonicNs) {
			throw new Error("Warm-pilot timing does not bind the evaluation-terminal event");
		}
		if (timing.timepointsNs.cleanupStarted !== cleanupStartedEvent.monotonicNs) {
			throw new Error("Warm-pilot timing does not bind the cleanup-started event");
		}
		if (timing.timepointsNs.cleanupVerified !== cleanupVerifiedEvent.monotonicNs) {
			throw new Error("Warm-pilot timing does not bind the cleanup-verified event");
		}
		if (timing.timepointsNs.blockEnded !== events.at(-1)?.monotonicNs) {
			throw new Error("Warm-pilot timing does not bind the block-ended event");
		}
	}
	return events;
}
