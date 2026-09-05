import { ArtifactStore } from "./artifact-store.js";
import { canonicalJson, sha256Text, toJsonValue } from "./canonical-json.js";
import type {
	CompilerGymWarmAcknowledgementEvidence,
	CompilerGymWarmAcquisitionTimingEvidence,
	CompilerGymWarmRootAccountingEvidence,
	CompilerGymWarmSchedulerEvidence,
	FarmShareCompilerGymWarmBackend,
} from "./compiler-gym-warm-farmshare-backend.js";
import type { CompilerGymWarmCloseVerification } from "./compiler-gym-warm-transport.js";
import type { ArtifactRef } from "./types.js";

export interface CompilerGymWarmPilotAcquisitionEvidence {
	poolDigest: string;
	clockId: string;
	source: string;
	startedAt: string;
	readyAt: string;
	startedMonotonicMs: number;
	readyMonotonicMs: number;
	elapsedMs: number;
	startedMonotonicNs: string;
	readyMonotonicNs: string;
	elapsedNs: string;
}

export interface CompilerGymWarmPilotSchedulerSnapshot {
	sequence: number;
	command: string;
	slurmId?: string;
	argv: readonly string[];
	exitCode: number | null;
	stdout: string;
	stderr: string;
	stdoutBytes: number;
	stderrBytes: number;
	stdoutSha256: string;
	stderrSha256: string;
	recordSha256: string;
	capturedAt: string;
}

export interface CompilerGymWarmPilotRootAccounting {
	sequence: number;
	jobIdRaw: string;
	user: string;
	jobName: string;
	workDir: string;
	allocCpus: number;
	elapsedRawSeconds: number;
	cpuTimeRawSeconds: number;
	state: string;
	exitCode: string;
	startAt: string;
	endAt: string;
	capturedAt: string;
	recordSha256: string;
}

export interface CompilerGymWarmPilotAcknowledgementEvidence {
	poolDigest: string;
	slurmId: string;
	rank: 0 | 1;
	path: string;
	raw: string;
	rawBytes: number;
	rawSha256: string;
	recordSha256: string;
	capturedAt: string;
}

export interface CompilerGymWarmPilotRecordEvidenceInput {
	acquisition: CompilerGymWarmPilotAcquisitionEvidence;
	schedulerAbsent: true;
	schedulerSnapshots: readonly CompilerGymWarmPilotSchedulerSnapshot[];
	acknowledgements: readonly CompilerGymWarmPilotAcknowledgementEvidence[];
	accounting: CompilerGymWarmPilotRootAccounting;
}

export interface CompilerGymWarmPilotRecordEvidenceProvider {
	collect(verification: CompilerGymWarmCloseVerification): Promise<CompilerGymWarmPilotRecordEvidenceInput>;
}

export interface CompilerGymWarmPilotBackendEvidenceSource {
	acquisitionTimingEvidence(): readonly CompilerGymWarmAcquisitionTimingEvidence[];
	schedulerEvidence(): readonly CompilerGymWarmSchedulerEvidence[];
	acknowledgementEvidence(): readonly CompilerGymWarmAcknowledgementEvidence[];
	rootAccountingEvidence(): readonly CompilerGymWarmRootAccountingEvidence[];
}

export interface CompilerGymWarmPilotRecordEvidence {
	acquisition: {
		poolDigest: string;
		clockId: string;
		source: string;
		startedAt: string;
		readyAt: string;
		startedNs: string;
		finishedNs: string;
		durationNs: string;
	};
	schedulerAbsent: true;
	schedulerAbsentAtHostNs: string;
	schedulerSnapshots: Array<{
		command: string;
		slurmId: string | null;
		argv: string[];
		capturedAt: string;
		stdout: ArtifactRef;
		stderr: ArtifactRef;
		recordSha256: string;
	}>;
	acknowledgements: Array<{
		rank: 0 | 1;
		path: string;
		capturedAt: string;
		raw: ArtifactRef;
		recordSha256: string;
	}>;
	cleanup: {
		mode: "shutdown" | "cancel";
		acknowledgedRanks: Array<0 | 1>;
		poolDigest: string;
		slurmId: string;
	};
	accounting: CompilerGymWarmPilotRootAccounting;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;

function timestamp(value: string, label: string): void {
	if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO timestamp`);
}

function exactInteger(value: number, label: string, minimum = 0): void {
	if (!Number.isSafeInteger(value) || value < minimum)
		throw new Error(`${label} must be a safe integer >= ${minimum}`);
}

function finiteNonnegative(value: number, label: string): void {
	if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} keys mismatch`);
	}
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function validateArtifact(value: unknown, label: string): ArtifactRef {
	const ref = objectRecord(value, label);
	exactKeys(ref, ["digest", "byteLength", "mediaType"], label);
	const digest = text(ref.digest, `${label}.digest`);
	const byteLength = ref.byteLength;
	const mediaType = text(ref.mediaType, `${label}.mediaType`);
	if (!SHA256_PATTERN.test(digest)) throw new Error(`${label}.digest must be a SHA-256`);
	if (typeof byteLength !== "number") throw new Error(`${label}.byteLength must be a number`);
	exactInteger(byteLength, `${label}.byteLength`);
	if (!mediaType.trim()) throw new Error(`${label}.mediaType must not be empty`);
	return { digest, byteLength, mediaType };
}

function snapshotBody(snapshot: CompilerGymWarmPilotSchedulerSnapshot): unknown {
	const common = {
		sequence: snapshot.sequence,
		command: snapshot.command,
		argv: [...snapshot.argv],
		exitCode: snapshot.exitCode,
		stdout: snapshot.stdout,
		stderr: snapshot.stderr,
		stdoutBytes: snapshot.stdoutBytes,
		stderrBytes: snapshot.stderrBytes,
		stdoutSha256: snapshot.stdoutSha256,
		stderrSha256: snapshot.stderrSha256,
		capturedAt: snapshot.capturedAt,
	};
	return snapshot.slurmId === undefined ? common : { ...common, slurmId: snapshot.slurmId };
}

function acknowledgementBody(acknowledgement: CompilerGymWarmPilotAcknowledgementEvidence): unknown {
	return {
		poolDigest: acknowledgement.poolDigest,
		slurmId: acknowledgement.slurmId,
		rank: acknowledgement.rank,
		path: acknowledgement.path,
		raw: acknowledgement.raw,
		rawBytes: acknowledgement.rawBytes,
		rawSha256: acknowledgement.rawSha256,
		capturedAt: acknowledgement.capturedAt,
	};
}

function accountingBody(accounting: CompilerGymWarmPilotRootAccounting): unknown {
	const { recordSha256: _recordSha256, ...body } = accounting;
	return body;
}

function exactlyOne<T>(values: readonly T[], label: string): T {
	if (values.length !== 1) throw new Error(`${label} requires exactly one record; received ${values.length}`);
	return values[0];
}

export function createFarmShareCompilerGymWarmPilotRecordEvidenceProvider(
	backend: FarmShareCompilerGymWarmBackend | CompilerGymWarmPilotBackendEvidenceSource,
): CompilerGymWarmPilotRecordEvidenceProvider {
	return {
		async collect(verification) {
			const acquisition = exactlyOne(
				backend.acquisitionTimingEvidence().filter((record) => record.poolDigest === verification.poolDigest),
				"Warm-pilot acquisition evidence",
			);
			const matchingAccounting = backend
				.rootAccountingEvidence()
				.filter((record) => record.jobIdRaw === verification.slurmId);
			if (matchingAccounting.length === 0) {
				throw new Error(`Warm-pilot root accounting is missing for ${verification.slurmId}`);
			}
			const accounting = matchingAccounting.at(-1);
			if (!accounting) throw new Error("Warm-pilot root accounting disappeared");
			return {
				acquisition: {
					...acquisition,
					clockId: "farmshare-warm-backend-v1",
					source: "backend-monotonic-ms-derived-ns",
				},
				schedulerAbsent: true,
				schedulerSnapshots: backend.schedulerEvidence().map((record) => ({ ...record, argv: [...record.argv] })),
				acknowledgements: backend
					.acknowledgementEvidence()
					.filter(
						(record) => record.poolDigest === verification.poolDigest && record.slurmId === verification.slurmId,
					)
					.map((record) => ({ ...record })),
				accounting: { ...accounting },
			};
		},
	};
}

function validateInput(
	input: CompilerGymWarmPilotRecordEvidenceInput,
	verification: CompilerGymWarmCloseVerification,
): void {
	if (input.schedulerAbsent !== true) throw new Error("Record evidence did not prove scheduler absence");
	const acquisition = input.acquisition;
	if (acquisition.poolDigest !== verification.poolDigest) throw new Error("Acquisition pool digest mismatch");
	if (!acquisition.clockId.trim() || !acquisition.source.trim())
		throw new Error("Acquisition clock identity is missing");
	timestamp(acquisition.startedAt, "acquisition.startedAt");
	timestamp(acquisition.readyAt, "acquisition.readyAt");
	for (const [label, value] of [
		["acquisition.startedMonotonicMs", acquisition.startedMonotonicMs],
		["acquisition.readyMonotonicMs", acquisition.readyMonotonicMs],
		["acquisition.elapsedMs", acquisition.elapsedMs],
	] as const) {
		finiteNonnegative(value, label);
	}
	if (acquisition.readyMonotonicMs <= acquisition.startedMonotonicMs) {
		throw new Error("Acquisition monotonic time must strictly increase");
	}
	if (acquisition.elapsedMs !== acquisition.readyMonotonicMs - acquisition.startedMonotonicMs) {
		throw new Error("Acquisition duration equation does not close exactly");
	}
	for (const [label, value] of [
		["acquisition.startedMonotonicNs", acquisition.startedMonotonicNs],
		["acquisition.readyMonotonicNs", acquisition.readyMonotonicNs],
		["acquisition.elapsedNs", acquisition.elapsedNs],
	] as const) {
		if (!DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be a canonical bigint decimal`);
	}
	if (
		BigInt(acquisition.readyMonotonicNs) - BigInt(acquisition.startedMonotonicNs) !==
		BigInt(acquisition.elapsedNs)
	) {
		throw new Error("Acquisition nanosecond duration equation does not close exactly");
	}
	const elapsedFromMillisecondsNs = BigInt(Math.round(acquisition.elapsedMs * 1_000_000));
	const elapsedNanosecondDifference =
		BigInt(acquisition.elapsedNs) > elapsedFromMillisecondsNs
			? BigInt(acquisition.elapsedNs) - elapsedFromMillisecondsNs
			: elapsedFromMillisecondsNs - BigInt(acquisition.elapsedNs);
	if (elapsedNanosecondDifference > 1n) {
		throw new Error("Acquisition millisecond and nanosecond durations disagree");
	}
	if (input.schedulerSnapshots.length < 2) throw new Error("Record evidence requires squeue and sacct snapshots");
	const recordDigests = new Set<string>();
	for (const [index, snapshot] of input.schedulerSnapshots.entries()) {
		if (snapshot.sequence !== index) throw new Error("Scheduler evidence sequence is not contiguous");
		if (!snapshot.command.trim()) throw new Error(`schedulerSnapshots[${index}].command is empty`);
		if (!Array.isArray(snapshot.argv) || !snapshot.argv.every((argument) => typeof argument === "string")) {
			throw new Error(`schedulerSnapshots[${index}].argv is invalid`);
		}
		timestamp(snapshot.capturedAt, `schedulerSnapshots[${index}].capturedAt`);
		exactInteger(snapshot.stdoutBytes, `schedulerSnapshots[${index}].stdoutBytes`);
		exactInteger(snapshot.stderrBytes, `schedulerSnapshots[${index}].stderrBytes`);
		if (snapshot.stdoutBytes !== Buffer.byteLength(snapshot.stdout))
			throw new Error("Scheduler stdout byte count mismatch");
		if (snapshot.stderrBytes !== Buffer.byteLength(snapshot.stderr))
			throw new Error("Scheduler stderr byte count mismatch");
		if (snapshot.stdoutSha256 !== sha256Text(snapshot.stdout)) throw new Error("Scheduler stdout digest mismatch");
		if (snapshot.stderrSha256 !== sha256Text(snapshot.stderr)) throw new Error("Scheduler stderr digest mismatch");
		if (snapshot.recordSha256 !== sha256Text(`${canonicalJson(toJsonValue(snapshotBody(snapshot)))}\n`)) {
			throw new Error("Scheduler record digest mismatch");
		}
		if (recordDigests.has(snapshot.recordSha256)) throw new Error("Scheduler record digest is duplicated");
		recordDigests.add(snapshot.recordSha256);
	}
	const squeue = input.schedulerSnapshots.find(
		(snapshot) =>
			snapshot.command === "squeue" && snapshot.slurmId === verification.slurmId && snapshot.stdout.trim() === "",
	);
	if (!squeue) throw new Error("Missing exact-job squeue absence snapshot");
	const sacctSnapshots = input.schedulerSnapshots.filter(
		(snapshot) =>
			snapshot.command === "sacct" && snapshot.slurmId === verification.slurmId && snapshot.argv.includes("-X"),
	);
	if (sacctSnapshots.length === 0) {
		throw new Error("Missing exact root-only sacct -X snapshot");
	}
	const expectedRanks = [...verification.acknowledgedRanks].sort();
	const observedRanks = input.acknowledgements.map((acknowledgement) => acknowledgement.rank).sort();
	if (
		expectedRanks.length !== observedRanks.length ||
		expectedRanks.some((rank, index) => rank !== observedRanks[index])
	) {
		throw new Error("Raw acknowledgement evidence does not match verified ranks");
	}
	if (new Set(observedRanks).size !== observedRanks.length) {
		throw new Error("Raw acknowledgement evidence contains duplicate ranks");
	}
	for (const [index, acknowledgement] of input.acknowledgements.entries()) {
		if (acknowledgement.poolDigest !== verification.poolDigest || acknowledgement.slurmId !== verification.slurmId) {
			throw new Error(`Acknowledgement ${index} identity mismatch`);
		}
		if (acknowledgement.rank !== 0 && acknowledgement.rank !== 1) {
			throw new Error(`Acknowledgement ${index} rank is invalid`);
		}
		if (!acknowledgement.path.startsWith("/") || acknowledgement.path.includes("\0")) {
			throw new Error(`Acknowledgement ${index} path is invalid`);
		}
		timestamp(acknowledgement.capturedAt, `acknowledgements[${index}].capturedAt`);
		exactInteger(acknowledgement.rawBytes, `acknowledgements[${index}].rawBytes`);
		if (acknowledgement.rawBytes !== Buffer.byteLength(acknowledgement.raw)) {
			throw new Error(`Acknowledgement ${index} raw byte count mismatch`);
		}
		if (acknowledgement.rawSha256 !== sha256Text(acknowledgement.raw)) {
			throw new Error(`Acknowledgement ${index} raw digest mismatch`);
		}
		if (
			acknowledgement.recordSha256 !==
			sha256Text(`${canonicalJson(toJsonValue(acknowledgementBody(acknowledgement)))}\n`)
		) {
			throw new Error(`Acknowledgement ${index} record digest mismatch`);
		}
	}
	const accounting = input.accounting;
	if (accounting.jobIdRaw !== verification.slurmId) throw new Error("Root accounting JobIDRaw mismatch");
	exactInteger(accounting.sequence, "accounting.sequence");
	for (const [label, value] of [
		["accounting.user", accounting.user],
		["accounting.jobName", accounting.jobName],
		["accounting.workDir", accounting.workDir],
	] as const) {
		if (!value.trim()) throw new Error(`${label} must not be empty`);
	}
	exactInteger(accounting.allocCpus, "accounting.allocCpus", 1);
	exactInteger(accounting.elapsedRawSeconds, "accounting.elapsedRawSeconds");
	exactInteger(accounting.cpuTimeRawSeconds, "accounting.cpuTimeRawSeconds");
	if (accounting.cpuTimeRawSeconds !== accounting.allocCpus * accounting.elapsedRawSeconds) {
		throw new Error("CPUTimeRAW does not equal AllocCPUS * ElapsedRaw");
	}
	if (!accounting.state.trim() || !accounting.exitCode.trim())
		throw new Error("Root accounting terminal fields are empty");
	timestamp(accounting.startAt, "accounting.startAt");
	timestamp(accounting.endAt, "accounting.endAt");
	timestamp(accounting.capturedAt, "accounting.capturedAt");
	if (Date.parse(accounting.endAt) < Date.parse(accounting.startAt)) {
		throw new Error("Root accounting End precedes Start");
	}
	if (accounting.recordSha256 !== sha256Text(`${canonicalJson(toJsonValue(accountingBody(accounting)))}\n`)) {
		throw new Error("Root accounting record digest mismatch");
	}
	const matchingSacctRow = sacctSnapshots
		.flatMap((snapshot) => snapshot.stdout.split("\n"))
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.split("|"))
		.find(
			(fields) =>
				fields.length === 11 &&
				fields[0] === accounting.jobIdRaw &&
				fields[1] === accounting.user &&
				fields[2] === accounting.jobName &&
				fields[3] === accounting.workDir &&
				fields[4] === accounting.state &&
				fields[5] === accounting.exitCode &&
				fields[6] === String(accounting.allocCpus) &&
				fields[7] === String(accounting.elapsedRawSeconds) &&
				fields[8] === String(accounting.cpuTimeRawSeconds) &&
				fields[9] === accounting.startAt &&
				fields[10] === accounting.endAt,
		);
	if (!matchingSacctRow) throw new Error("Parsed root accounting does not match raw sacct evidence");
}

export async function materializeCompilerGymWarmPilotRecordEvidence(
	input: CompilerGymWarmPilotRecordEvidenceInput,
	verification: CompilerGymWarmCloseVerification,
	schedulerAbsentAtHostNs: bigint,
	artifactDir: string,
): Promise<CompilerGymWarmPilotRecordEvidence> {
	validateInput(input, verification);
	if (schedulerAbsentAtHostNs < 0n) throw new Error("schedulerAbsentAtHostNs must be non-negative");
	const artifacts = new ArtifactStore(artifactDir);
	const schedulerSnapshots = await Promise.all(
		input.schedulerSnapshots.map(async (snapshot) => ({
			command: snapshot.command,
			slurmId: snapshot.slurmId ?? null,
			argv: [...snapshot.argv],
			capturedAt: snapshot.capturedAt,
			stdout: await artifacts.putString(snapshot.stdout, "text/plain"),
			stderr: await artifacts.putString(snapshot.stderr, "text/plain"),
			recordSha256: snapshot.recordSha256,
		})),
	);
	const acknowledgements = await Promise.all(
		input.acknowledgements.map(async (acknowledgement) => ({
			rank: acknowledgement.rank,
			path: acknowledgement.path,
			capturedAt: acknowledgement.capturedAt,
			raw: await artifacts.putString(acknowledgement.raw, "application/json"),
			recordSha256: acknowledgement.recordSha256,
		})),
	);
	return {
		acquisition: {
			poolDigest: input.acquisition.poolDigest,
			clockId: input.acquisition.clockId,
			source: input.acquisition.source,
			startedAt: input.acquisition.startedAt,
			readyAt: input.acquisition.readyAt,
			startedNs: input.acquisition.startedMonotonicNs,
			finishedNs: input.acquisition.readyMonotonicNs,
			durationNs: input.acquisition.elapsedNs,
		},
		schedulerAbsent: true,
		schedulerAbsentAtHostNs: schedulerAbsentAtHostNs.toString(10),
		schedulerSnapshots,
		acknowledgements,
		cleanup: {
			mode: verification.mode,
			acknowledgedRanks: [...verification.acknowledgedRanks],
			poolDigest: verification.poolDigest,
			slurmId: verification.slurmId,
		},
		accounting: { ...input.accounting },
	};
}

export function validateCompilerGymWarmPilotRecordEvidence(value: unknown): CompilerGymWarmPilotRecordEvidence {
	const root = objectRecord(value, "recordEvidence");
	exactKeys(
		root,
		[
			"acquisition",
			"schedulerAbsent",
			"schedulerAbsentAtHostNs",
			"schedulerSnapshots",
			"acknowledgements",
			"cleanup",
			"accounting",
		],
		"recordEvidence",
	);
	if (root.schedulerAbsent !== true) throw new Error("Persisted scheduler absence is false");
	const schedulerAbsentAtHostNs = text(root.schedulerAbsentAtHostNs, "schedulerAbsentAtHostNs");
	if (!DECIMAL_PATTERN.test(schedulerAbsentAtHostNs)) throw new Error("schedulerAbsentAtHostNs is invalid");

	const acquisition = objectRecord(root.acquisition, "acquisition");
	exactKeys(
		acquisition,
		["poolDigest", "clockId", "source", "startedAt", "readyAt", "startedNs", "finishedNs", "durationNs"],
		"acquisition",
	);
	const poolDigest = text(acquisition.poolDigest, "acquisition.poolDigest");
	if (!SHA256_PATTERN.test(poolDigest)) throw new Error("acquisition.poolDigest is invalid");
	for (const key of ["clockId", "source"] as const) {
		if (!text(acquisition[key], `acquisition.${key}`).trim()) throw new Error(`acquisition.${key} is empty`);
	}
	timestamp(text(acquisition.startedAt, "acquisition.startedAt"), "acquisition.startedAt");
	timestamp(text(acquisition.readyAt, "acquisition.readyAt"), "acquisition.readyAt");
	for (const key of ["startedNs", "finishedNs", "durationNs"] as const) {
		if (!DECIMAL_PATTERN.test(text(acquisition[key], `acquisition.${key}`))) {
			throw new Error(`acquisition.${key} is invalid`);
		}
	}
	if (
		BigInt(acquisition.finishedNs as string) - BigInt(acquisition.startedNs as string) !==
		BigInt(acquisition.durationNs as string)
	) {
		throw new Error("Persisted acquisition duration equation does not close exactly");
	}

	if (!Array.isArray(root.schedulerSnapshots) || root.schedulerSnapshots.length < 2) {
		throw new Error("Persisted scheduler snapshots are incomplete");
	}
	for (const [index, value] of root.schedulerSnapshots.entries()) {
		const snapshot = objectRecord(value, `schedulerSnapshots[${index}]`);
		exactKeys(
			snapshot,
			["command", "slurmId", "argv", "capturedAt", "stdout", "stderr", "recordSha256"],
			`schedulerSnapshots[${index}]`,
		);
		if (!text(snapshot.command, `schedulerSnapshots[${index}].command`).trim()) {
			throw new Error("Persisted scheduler command is empty");
		}
		if (snapshot.slurmId !== null && !/^[1-9][0-9]*$/.test(text(snapshot.slurmId, "snapshot.slurmId"))) {
			throw new Error("Persisted scheduler Slurm ID is invalid");
		}
		if (!Array.isArray(snapshot.argv) || !snapshot.argv.every((argument) => typeof argument === "string")) {
			throw new Error("Persisted scheduler argv is invalid");
		}
		timestamp(text(snapshot.capturedAt, `schedulerSnapshots[${index}].capturedAt`), "snapshot.capturedAt");
		validateArtifact(snapshot.stdout, `schedulerSnapshots[${index}].stdout`);
		validateArtifact(snapshot.stderr, `schedulerSnapshots[${index}].stderr`);
		if (!SHA256_PATTERN.test(text(snapshot.recordSha256, "snapshot.recordSha256"))) {
			throw new Error("Persisted scheduler record digest is invalid");
		}
	}

	const cleanup = objectRecord(root.cleanup, "cleanup");
	exactKeys(cleanup, ["mode", "acknowledgedRanks", "poolDigest", "slurmId"], "cleanup");
	if (cleanup.mode !== "shutdown" && cleanup.mode !== "cancel") throw new Error("Persisted cleanup mode is invalid");
	if (!Array.isArray(cleanup.acknowledgedRanks)) throw new Error("Persisted acknowledged ranks are invalid");
	const acknowledgedRanks = cleanup.acknowledgedRanks.map((rank) => {
		if (rank !== 0 && rank !== 1) throw new Error("Persisted acknowledged rank is invalid");
		return rank;
	});
	if (new Set(acknowledgedRanks).size !== acknowledgedRanks.length) {
		throw new Error("Persisted acknowledged ranks contain duplicates");
	}
	const cleanupPoolDigest = text(cleanup.poolDigest, "cleanup.poolDigest");
	if (!SHA256_PATTERN.test(cleanupPoolDigest)) throw new Error("Persisted cleanup pool digest is invalid");
	const cleanupSlurmId = text(cleanup.slurmId, "cleanup.slurmId");
	if (!/^[1-9][0-9]*$/.test(cleanupSlurmId)) throw new Error("Persisted cleanup Slurm ID is invalid");
	if (cleanupPoolDigest !== poolDigest) throw new Error("Persisted cleanup/acquisition pool mismatch");

	if (!Array.isArray(root.acknowledgements) || root.acknowledgements.length !== acknowledgedRanks.length) {
		throw new Error("Persisted acknowledgement count does not match cleanup");
	}
	for (const [index, value] of root.acknowledgements.entries()) {
		const acknowledgement = objectRecord(value, `acknowledgements[${index}]`);
		exactKeys(acknowledgement, ["rank", "path", "capturedAt", "raw", "recordSha256"], `acknowledgements[${index}]`);
		if (acknowledgement.rank !== acknowledgedRanks[index]) {
			throw new Error("Persisted acknowledgement ranks do not match cleanup");
		}
		if (!text(acknowledgement.path, "acknowledgement.path").startsWith("/")) {
			throw new Error("Persisted acknowledgement path is invalid");
		}
		timestamp(text(acknowledgement.capturedAt, "acknowledgement.capturedAt"), "acknowledgement.capturedAt");
		validateArtifact(acknowledgement.raw, `acknowledgements[${index}].raw`);
		if (!SHA256_PATTERN.test(text(acknowledgement.recordSha256, "acknowledgement.recordSha256"))) {
			throw new Error("Persisted acknowledgement record digest is invalid");
		}
	}

	const accounting = objectRecord(root.accounting, "accounting");
	exactKeys(
		accounting,
		[
			"sequence",
			"jobIdRaw",
			"user",
			"jobName",
			"workDir",
			"state",
			"exitCode",
			"allocCpus",
			"elapsedRawSeconds",
			"cpuTimeRawSeconds",
			"startAt",
			"endAt",
			"capturedAt",
			"recordSha256",
		],
		"accounting",
	);
	for (const key of ["sequence", "allocCpus", "elapsedRawSeconds", "cpuTimeRawSeconds"] as const) {
		if (typeof accounting[key] !== "number") throw new Error(`accounting.${key} must be a number`);
		exactInteger(accounting[key] as number, `accounting.${key}`, key === "allocCpus" ? 1 : 0);
	}
	for (const key of ["jobIdRaw", "user", "jobName", "workDir", "state", "exitCode"] as const) {
		if (!text(accounting[key], `accounting.${key}`).trim()) throw new Error(`accounting.${key} is empty`);
	}
	for (const key of ["startAt", "endAt", "capturedAt"] as const) {
		timestamp(text(accounting[key], `accounting.${key}`), `accounting.${key}`);
	}
	if (!SHA256_PATTERN.test(text(accounting.recordSha256, "accounting.recordSha256"))) {
		throw new Error("Persisted root accounting record digest is invalid");
	}
	if (accounting.jobIdRaw !== cleanupSlurmId) throw new Error("Persisted root accounting job mismatch");
	if (accounting.cpuTimeRawSeconds !== (accounting.allocCpus as number) * (accounting.elapsedRawSeconds as number)) {
		throw new Error("Persisted CPUTimeRAW equation does not close exactly");
	}
	return root as unknown as CompilerGymWarmPilotRecordEvidence;
}
