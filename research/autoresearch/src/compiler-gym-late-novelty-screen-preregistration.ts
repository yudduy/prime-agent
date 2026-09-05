import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { FROZEN_CAMPAIGN } from "./campaign.js";
import { canonicalJson, sha256Json, sha256Text, toJsonValue } from "./canonical-json.js";
import {
	COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
	type CompilerGymHardenedPaidProviderSpec,
} from "./compiler-gym-hardened-paid-provider.js";
import {
	buildCompilerGymIrDeltaScreenPrompt,
	COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST,
	COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
	COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
	CompilerGymIrDeltaScreenEvaluationSchema,
} from "./compiler-gym-ir-delta-screen-protocol.js";
import {
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
	COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
	COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
	COMPILER_GYM_LATE_NOVELTY_THRESHOLD,
} from "./compiler-gym-late-novelty-guidance.js";
import {
	COMPILER_GYM_LATE_NOVELTY_SCREEN_ARMS,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
	COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL,
	type CompilerGymLateNoveltyScreenArm,
} from "./compiler-gym-late-novelty-screen-protocol.js";
import {
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_RELATIVE_PATH,
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
} from "./compiler-gym-paid-live-environment-gate.js";
import { verifyLedgerContentsStrict } from "./ledger.js";
import { STOCK_CPU_TASKS } from "./stock-cpu-protocol.js";
import {
	capturePrimeRuntimeWorktreeSnapshot,
	computeStockInterfaceParityImplementationBundle,
	PRIME_RUNTIME_WORKTREE_PATHS,
	type RepositorySnapshot,
	stockInterfaceParityImplementationSourcePaths,
} from "./stock-interface-parity.js";
import { STOCK_INTERFACE_PARITY_TOOL_NAME } from "./stock-interface-parity-protocol.js";

export const COMPILER_GYM_LATE_NOVELTY_SCREEN_PREREGISTRATION_PROTOCOL =
	"compiler-gym-late-structural-novelty-paid-screen-preregistration-v2" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL =
	"compiler-gym-late-structural-novelty-paid-screen-runner-v2" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_PROVIDER_VISIBLE_WORKSPACE =
	"/workspace/prime-compiler-gym-late-novelty" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG =
	"/sessions/prime-compiler-gym-late-novelty.jsonl" as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION = {
	path: ".autoresearch/cpu-calibration/2026-08-28-v2-stock/result.json",
	sha256: "cbcac6534932cd1bb28ddd7591d10f641537a2dff3a0b6d95e777adde22ebd47",
} as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE = {
	preregistration: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/preregistration.json",
		sha256: "c9be9a6c4cace30a903c9f698f32e1e234a62de344f4a62a88c9163ee2580a33",
	},
	result: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/result.json",
		sha256: "060631a72ed582749fc823cb8a3da0fc0975938442343a1c6639576d50613208",
	},
	ledger: {
		path: ".autoresearch/compiler-gym-ir-delta-qualification/2026-08-28-v1/execution/evidence.jsonl",
		sha256: "e7dec53e1673af776901601ea94343d42b1c939131c7cb7c68ffeb87ba2fe3b3",
	},
	terminalDisposition: "terminal-complete-scientific-pass",
	decision: "qualify-agent-facing-ir-delta-screen",
} as const;
export const COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION = {
	classification: "development-informed-retrospective-headroom-audit-not-treatment-evidence",
	path: ".autoresearch/compiler-gym-latency-audit/analysis-v1.json",
	sha256: "08d50b4fdd32c8e435f9549c79030419d814a7ebaf3cb72e214e2fde0d583d73",
	inputLedgers: 21,
	selectedTransitions: 14,
	low: { total: 7, dominates: 5 },
	high: { total: 7, dominates: 2 },
	oneSidedFisherExact: { numerator: 491, denominator: 3432 },
	authorizations: { provider: false, paid: false, treatment: false, promotion: false, gpu: false },
} as const;

export const COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS = [
	COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_RELATIVE_PATH,
	"research/autoresearch/evaluators/compiler_gym_eval.py",
	"research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py",
	"research/autoresearch/src/compiler-gym-hardened-paid-provider.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-qualification-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-screen-adapter.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-screen-protocol.ts",
	"research/autoresearch/src/compiler-gym-ir-delta-smoke-protocol.ts",
	"research/autoresearch/src/compiler-gym-late-novelty-guidance.ts",
	"research/autoresearch/src/compiler-gym-late-novelty-screen-preregistration.ts",
	"research/autoresearch/src/compiler-gym-late-novelty-screen-protocol.ts",
	"research/autoresearch/src/compiler-gym-late-novelty-screen-runner.ts",
	"research/autoresearch/src/compiler-gym-paid-live-environment-gate.ts",
] as const;

interface CompilerGymLateNoveltyModuleToken {
	kind: "identifier" | "literal" | "punctuation" | "string" | "template";
	value: string;
}

const COMPILER_GYM_LATE_NOVELTY_SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

function compareCanonicalPaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function assertCanonicalInRepoRelativePath(value: string, label: string): void {
	if (
		value.length === 0 ||
		value.includes("\\") ||
		value.includes("\0") ||
		posix.isAbsolute(value) ||
		value === ".." ||
		value.startsWith("../") ||
		posix.normalize(value) !== value
	) {
		throw new Error(`Late-novelty ${label} is not a canonical in-repo path: ${value}`);
	}
}

function canonicalPathWithinRepository(repoRoot: string, absolutePath: string, label: string): string {
	const relativePath = relative(repoRoot, absolutePath);
	if (
		relativePath.length === 0 ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error(`Late-novelty ${label} resolved outside the repository: ${absolutePath}`);
	}
	const canonical = relativePath.split(sep).join("/");
	assertCanonicalInRepoRelativePath(canonical, label);
	return canonical;
}

function compilerGymLateNoveltyRegexCanStartAfter(token: CompilerGymLateNoveltyModuleToken | undefined): boolean {
	if (!token) return true;
	if (token.kind === "identifier") {
		return new Set([
			"await",
			"case",
			"delete",
			"in",
			"instanceof",
			"new",
			"of",
			"return",
			"throw",
			"typeof",
			"void",
			"yield",
		]).has(token.value);
	}
	return token.kind === "punctuation" && "([{,;:=!?&|+-*%^~<>".includes(token.value);
}

function skipCompilerGymLateNoveltyQuotedLiteral(source: string, start: number, relativePath: string): number {
	const quote = source[start]!;
	let cursor = start + 1;
	while (cursor < source.length) {
		const current = source[cursor]!;
		if (current === "\n" || current === "\r") {
			throw new Error(`Late-novelty source has an unterminated string: ${relativePath}`);
		}
		if (current === "\\") {
			cursor += 2;
			continue;
		}
		if (current === quote) return cursor + 1;
		cursor++;
	}
	throw new Error(`Late-novelty source has an unterminated string: ${relativePath}`);
}

function skipCompilerGymLateNoveltyTemplateExpression(source: string, start: number, relativePath: string): number {
	let cursor = start;
	let depth = 1;
	while (cursor < source.length) {
		const character = source[cursor]!;
		if (character === '"' || character === "'") {
			cursor = skipCompilerGymLateNoveltyQuotedLiteral(source, cursor, relativePath);
			continue;
		}
		if (character === "`") {
			cursor = skipCompilerGymLateNoveltyTemplateLiteral(source, cursor, relativePath);
			continue;
		}
		if (character === "/" && source[cursor + 1] === "/") {
			cursor += 2;
			while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") cursor++;
			continue;
		}
		if (character === "/" && source[cursor + 1] === "*") {
			const end = source.indexOf("*/", cursor + 2);
			if (end === -1) throw new Error(`Late-novelty source has an unterminated comment: ${relativePath}`);
			cursor = end + 2;
			continue;
		}
		if (character === "{") depth++;
		if (character === "}" && --depth === 0) return cursor + 1;
		cursor++;
	}
	throw new Error(`Late-novelty source has an unterminated template expression: ${relativePath}`);
}

function skipCompilerGymLateNoveltyTemplateLiteral(source: string, start: number, relativePath: string): number {
	let cursor = start + 1;
	while (cursor < source.length) {
		if (source[cursor] === "\\") {
			cursor += 2;
			continue;
		}
		if (source[cursor] === "`") return cursor + 1;
		if (source[cursor] === "$" && source[cursor + 1] === "{") {
			cursor = skipCompilerGymLateNoveltyTemplateExpression(source, cursor + 2, relativePath);
			continue;
		}
		cursor++;
	}
	throw new Error(`Late-novelty source has an unterminated template: ${relativePath}`);
}

function scanCompilerGymLateNoveltyModuleTokens(source: string, relativePath: string) {
	const tokens: CompilerGymLateNoveltyModuleToken[] = [];
	let cursor = 0;
	while (cursor < source.length) {
		const character = source[cursor]!;
		if (/\s/.test(character)) {
			cursor++;
			continue;
		}
		if (character === "/" && source[cursor + 1] === "/") {
			cursor += 2;
			while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") cursor++;
			continue;
		}
		if (character === "/" && source[cursor + 1] === "*") {
			const end = source.indexOf("*/", cursor + 2);
			if (end === -1) throw new Error(`Late-novelty source has an unterminated comment: ${relativePath}`);
			cursor = end + 2;
			continue;
		}
		if (character === "/" && compilerGymLateNoveltyRegexCanStartAfter(tokens.at(-1))) {
			cursor++;
			let inCharacterClass = false;
			let closed = false;
			while (cursor < source.length) {
				const current = source[cursor]!;
				if (current === "\n" || current === "\r") {
					throw new Error(`Late-novelty source has an unterminated regular expression: ${relativePath}`);
				}
				if (current === "\\") {
					cursor += 2;
					continue;
				}
				if (current === "[") inCharacterClass = true;
				if (current === "]") inCharacterClass = false;
				if (current === "/" && !inCharacterClass) {
					cursor++;
					while (cursor < source.length && /[A-Za-z]/.test(source[cursor]!)) cursor++;
					closed = true;
					break;
				}
				cursor++;
			}
			if (!closed) {
				throw new Error(`Late-novelty source has an unterminated regular expression: ${relativePath}`);
			}
			tokens.push({ kind: "literal", value: "regular-expression" });
			continue;
		}
		if (character === '"' || character === "'") {
			const quote = character;
			const start = ++cursor;
			let escaped = false;
			while (cursor < source.length) {
				const current = source[cursor]!;
				if (current === "\n" || current === "\r") {
					throw new Error(`Late-novelty source has an unterminated string: ${relativePath}`);
				}
				if (current === "\\") {
					escaped = true;
					cursor += 2;
					continue;
				}
				if (current === quote) break;
				cursor++;
			}
			if (cursor >= source.length) {
				throw new Error(`Late-novelty source has an unterminated string: ${relativePath}`);
			}
			const value = source.slice(start, cursor);
			tokens.push({ kind: "string", value: escaped ? `\\${value}` : value });
			cursor++;
			continue;
		}
		if (character === "`") {
			cursor = skipCompilerGymLateNoveltyTemplateLiteral(source, cursor, relativePath);
			tokens.push({ kind: "template", value: "" });
			continue;
		}
		if (/[A-Za-z_$]/.test(character)) {
			const start = cursor++;
			while (cursor < source.length && /[A-Za-z0-9_$]/.test(source[cursor]!)) cursor++;
			tokens.push({ kind: "identifier", value: source.slice(start, cursor) });
			continue;
		}
		tokens.push({ kind: "punctuation", value: character });
		cursor++;
	}
	return tokens;
}

function compilerGymLateNoveltyLocalImportSpecifiers(source: string, relativePath: string): string[] {
	const tokens = scanCompilerGymLateNoveltyModuleTokens(source, relativePath);
	const specifiers = new Set<string>();
	const addSpecifier = (token: CompilerGymLateNoveltyModuleToken): void => {
		if (token.kind !== "string") return;
		if (token.value.startsWith("\\")) {
			throw new Error(`Late-novelty source uses an escaped module specifier: ${relativePath}`);
		}
		if (token.value.startsWith("./") || token.value.startsWith("../")) specifiers.add(token.value);
	};
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!;
		if (token.kind !== "identifier" || (token.value !== "import" && token.value !== "export")) continue;
		const next = tokens[index + 1];
		if (token.value === "export") {
			const declarationStart = next?.kind === "identifier" && next.value === "type" ? index + 2 : index + 1;
			const declarationToken = tokens[declarationStart];
			if (
				!declarationToken ||
				declarationToken.kind !== "punctuation" ||
				(declarationToken.value !== "{" && declarationToken.value !== "*")
			) {
				continue;
			}
			for (let cursor = declarationStart + 1; cursor < tokens.length; cursor++) {
				const candidate = tokens[cursor]!;
				if (candidate.kind === "punctuation" && candidate.value === ";") {
					index = cursor;
					break;
				}
				if (candidate.kind === "identifier" && candidate.value === "from") {
					const moduleToken = tokens[cursor + 1];
					if (moduleToken?.kind === "string") addSpecifier(moduleToken);
				}
			}
			continue;
		}
		if (token.value === "import" && next?.kind === "punctuation" && next.value === ".") continue;
		if (token.value === "import" && next?.kind === "punctuation" && next.value === "(") {
			const moduleToken = tokens[index + 2];
			if (!moduleToken || moduleToken.kind !== "string") {
				throw new Error(`Late-novelty source has a nonliteral dynamic import: ${relativePath}`);
			}
			addSpecifier(moduleToken);
			continue;
		}
		if (next) addSpecifier(next);
		for (let cursor = index + 1; cursor < tokens.length; cursor++) {
			const candidate = tokens[cursor]!;
			if (candidate.kind === "punctuation" && candidate.value === ";") {
				index = cursor;
				break;
			}
			if (candidate.kind === "identifier" && candidate.value === "from") {
				const moduleToken = tokens[cursor + 1];
				if (!moduleToken || moduleToken.kind !== "string") {
					throw new Error(`Late-novelty source has a nonliteral module specifier: ${relativePath}`);
				}
				addSpecifier(moduleToken);
			}
			if (candidate.kind === "identifier" && candidate.value === "require") {
				const openParenthesis = tokens[cursor + 1];
				const moduleToken = tokens[cursor + 2];
				if (openParenthesis?.value !== "(" || !moduleToken || moduleToken.kind !== "string") {
					throw new Error(`Late-novelty source has a nonliteral import-equals require: ${relativePath}`);
				}
				addSpecifier(moduleToken);
			}
		}
	}
	return [...specifiers].sort(compareCanonicalPaths);
}

function compilerGymLateNoveltyImportCandidates(importerPath: string, specifier: string): string[] {
	const unresolved = resolve(dirname(importerPath), specifier);
	switch (extname(unresolved)) {
		case ".js":
			return [`${unresolved.slice(0, -3)}.ts`, `${unresolved.slice(0, -3)}.tsx`, unresolved];
		case ".jsx":
			return [`${unresolved.slice(0, -4)}.tsx`, unresolved];
		case ".mjs":
			return [`${unresolved.slice(0, -4)}.mts`, unresolved];
		case ".cjs":
			return [`${unresolved.slice(0, -4)}.cts`, unresolved];
		case "":
			return [
				`${unresolved}.ts`,
				`${unresolved}.tsx`,
				`${unresolved}.mts`,
				`${unresolved}.cts`,
				`${unresolved}.js`,
				`${unresolved}.jsx`,
				`${unresolved}.mjs`,
				`${unresolved}.cjs`,
				resolve(unresolved, "index.ts"),
				resolve(unresolved, "index.tsx"),
				resolve(unresolved, "index.mts"),
				resolve(unresolved, "index.cts"),
				resolve(unresolved, "index.js"),
				resolve(unresolved, "index.jsx"),
				resolve(unresolved, "index.mjs"),
				resolve(unresolved, "index.cjs"),
			];
		default:
			return [unresolved];
	}
}

async function resolveCompilerGymLateNoveltyLocalImport(input: {
	repoRoot: string;
	importerPath: string;
	importerRelativePath: string;
	specifier: string;
}): Promise<string> {
	const unresolved = resolve(dirname(input.importerPath), input.specifier);
	canonicalPathWithinRepository(input.repoRoot, unresolved, `import ${input.specifier}`);
	const matches = new Set<string>();
	for (const candidate of compilerGymLateNoveltyImportCandidates(input.importerPath, input.specifier)) {
		try {
			const metadata = await stat(candidate);
			if (!metadata.isFile()) continue;
			const canonicalAbsolutePath = await realpath(candidate);
			canonicalPathWithinRepository(input.repoRoot, canonicalAbsolutePath, `import ${input.specifier}`);
			matches.add(canonicalAbsolutePath);
		} catch (error) {
			if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
				continue;
			}
			throw error;
		}
	}
	if (matches.size === 0) {
		throw new Error(
			`Late-novelty local import could not be resolved: ${input.importerRelativePath} -> ${input.specifier}`,
		);
	}
	if (matches.size !== 1) {
		throw new Error(`Late-novelty local import is ambiguous: ${input.importerRelativePath} -> ${input.specifier}`);
	}
	return canonicalPathWithinRepository(input.repoRoot, [...matches][0]!, `import ${input.specifier}`);
}

export interface CompilerGymLateNoveltySourceRecord {
	relativePath: string;
	sha256: string;
}

export interface CompilerGymLateNoveltyProviderRegistryClosure {
	agentDir: string;
	modelsJsonPath: string;
	modelsJsonPresent: false;
}

export interface CompilerGymLateNoveltyScreenPreregistration {
	schemaVersion: 1;
	protocol: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PREREGISTRATION_PROTOCOL;
	screenProtocol: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL;
	pairId: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID;
	createdAt: string;
	status: "preregistered-before-provider-or-evaluator-dispatch";
	classification: "prospective-development-informed-directional-screen";
	question: string;
	hypothesis: string;
	claimClass: "directional-single-randomized-order-pair";
	causalClaimAllowed: false;
	replicationClaimAllowed: false;
	gpuPromotionAllowed: false;
	randomization: {
		method: "cryptographic-byte-parity-v1";
		drawHex: string;
		armOrder: readonly [CompilerGymLateNoveltyScreenArm, CompilerGymLateNoveltyScreenArm];
	};
	arms: readonly [
		{ id: "unchanged-control"; modelFeedback: "unchanged-hidden-trace-terminal-envelope" },
		{
			id: "late-novelty-treatment";
			modelFeedback: "control-envelope-plus-one-call4Guidance-field-only-after-accepted-result-three";
		},
	];
	historicalMotivation: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION;
	frozenCommon: {
		primeAgentCommit: string;
		model: "openai-codex/gpt-5.6-luna";
		thinkingLevel: "xhigh";
		requestedServiceTier: "priority";
		promptSha256: string;
		calibration: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION;
		verifierEpoch: typeof COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH;
		canonicalEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256;
		irDeltaEvaluatorSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256;
		evaluatorSourceBundleSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256;
		providerRetries: 0;
		compaction: false;
		webAccess: false;
		rlmChildren: false;
		measurementReuse: false;
		latchForbiddenToolExecutionWithinResponse: true;
		liveEnvironmentGate: {
			protocol: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL;
			probeSourceSha256: typeof COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256;
			expectedResultSha256: string;
			timing: "immediately-before-each-provider-request";
			transport: "read-only-login-node-ssh-no-slurm";
		};
	};
	authorization: {
		provider: "openai-codex";
		model: "gpt-5.6-luna";
		paid: true;
		treatmentExecution: true;
		maximumActualProviderDispatches: 8;
		perArmActualProviderDispatches: 4;
		authorizedOnlyAfterAllPreDispatchIntegrityGatesPass: true;
		compactionOrAuxiliaryModelCallsAuthorized: false;
	};
	budgets: {
		pairCount: 1;
		perArm: { providerCalls: 4; evaluatorJobs: 4; freshTaskEvaluations: 8; reusedTaskEvaluations: 0 };
		pairTotals: { providerCalls: 8; evaluatorJobs: 8; freshTaskEvaluations: 16; reusedTaskEvaluations: 0 };
		retries: 0;
		replacements: 0;
	};
	firstToolCall: {
		request: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST;
		actionsSha256: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256;
		expectedMetrics: typeof COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS;
		driftDisposition: "terminal-apparatus-invalid-not-treatment-result";
	};
	treatment: {
		field: typeof COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD;
		value: typeof COMPILER_GYM_LATE_NOVELTY_GUIDANCE;
		serializedFieldBytes: 128;
		maximumSerializedDeltaBytes: typeof COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES;
		producerResultOrdinal: 3;
		consumerProviderDispatchOrdinal: 4;
		requiresAcceptedResultThree: true;
		hardCandidateRejection: false;
	};
	assessment: {
		similarityThreshold: typeof COMPILER_GYM_LATE_NOVELTY_THRESHOLD;
		primary: "treatment-call-four-dominates-parent-and-control-call-four-does-not";
		secondary: "treatment-normalized-minimax-parent-ratio-strictly-lower-than-control";
		winNextGate: "one-fresh-randomized-replication";
		nonWinNextGate: "kill-late-novelty-v2";
	};
	providerSpec: CompilerGymHardenedPaidProviderSpec<CompilerGymLateNoveltyScreenArm>;
	providerSpecSha256: string;
	providerRegistryClosure: CompilerGymLateNoveltyProviderRegistryClosure;
	formalEvidence: typeof COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE;
	implementationClosure: CompilerGymLateNoveltySourceRecord[];
	implementationBundleSha256: string;
	stockTrajectoryImplementationBundleSha256: string;
	runtimeWorktreeClosure: {
		roots: typeof PRIME_RUNTIME_WORKTREE_PATHS;
		snapshot: RepositorySnapshot;
		snapshotSha256: string;
	};
}

function armOrder(drawHex: string): readonly [CompilerGymLateNoveltyScreenArm, CompilerGymLateNoveltyScreenArm] {
	if (!/^[a-f0-9]{32}$/.test(drawHex))
		throw new Error("Late-novelty randomization draw must be 16 lowercase hexadecimal bytes");
	return Number.parseInt(drawHex.slice(0, 2), 16) % 2 === 0
		? ["unchanged-control", "late-novelty-treatment"]
		: ["late-novelty-treatment", "unchanged-control"];
}

function validateSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
	if (snapshot.head !== FROZEN_CAMPAIGN.repositories.primeAgent.commit)
		throw new Error("Late-novelty runtime HEAD drifted");
	assert.deepEqual(Object.keys(snapshot.coreTreeHashes), [...PRIME_RUNTIME_WORKTREE_PATHS]);
	if (!/^[a-f0-9]{64}$/.test(snapshot.trackedDiffSha256) || !/^[a-f0-9]{64}$/.test(snapshot.coreWorktreeDigest)) {
		throw new Error("Late-novelty runtime snapshot digest is invalid");
	}
	const expectedDigest = sha256Json({
		coreWorktreeStatus: snapshot.coreWorktreeStatus,
		trackedDiffSha256: snapshot.trackedDiffSha256,
		untrackedFileHashes: snapshot.untrackedFileHashes,
	});
	if (snapshot.coreWorktreeDigest !== expectedDigest)
		throw new Error("Late-novelty runtime snapshot is not self-binding");
	return structuredClone(snapshot);
}

function validateClosure(value: readonly CompilerGymLateNoveltySourceRecord[]): CompilerGymLateNoveltySourceRecord[] {
	if (value.length < COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS.length) {
		throw new Error("Late-novelty implementation closure omitted a required root");
	}
	const closure = value.map((record, index) => {
		assertCanonicalInRepoRelativePath(record.relativePath, "implementation closure path");
		if (index > 0 && value[index - 1]!.relativePath >= record.relativePath) {
			throw new Error("Late-novelty implementation closure paths must be unique and canonically sorted");
		}
		if (!/^[a-f0-9]{64}$/.test(record.sha256))
			throw new Error(`Late-novelty implementation hash is invalid: ${record.relativePath}`);
		return { ...record };
	});
	const sealedPaths = new Set(closure.map((record) => record.relativePath));
	for (const requiredPath of COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS) {
		if (!sealedPaths.has(requiredPath)) {
			throw new Error(`Late-novelty implementation closure omitted required root: ${requiredPath}`);
		}
	}
	return closure;
}

function validateProviderRegistryClosure(
	value: CompilerGymLateNoveltyProviderRegistryClosure,
): CompilerGymLateNoveltyProviderRegistryClosure {
	const agentDir = resolve(value.agentDir);
	if (
		value.agentDir !== agentDir ||
		value.modelsJsonPath !== resolve(agentDir, "models.json") ||
		value.modelsJsonPresent !== false
	) {
		throw new Error("Late-novelty provider registry closure drifted");
	}
	return structuredClone(value);
}

function buildProviderSpec(providerSessionId: string, agentRegistry: CompilerGymLateNoveltyProviderRegistryClosure) {
	return {
		schemaVersion: 1,
		runnerProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_RUNNER_PROTOCOL,
		pairId: COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
		arms: COMPILER_GYM_LATE_NOVELTY_SCREEN_ARMS,
		prompt: buildCompilerGymIrDeltaScreenPrompt(),
		tool: {
			name: STOCK_INTERFACE_PARITY_TOOL_NAME,
			description:
				"Submit one LLVM pass sequence, wait for immutable verification, and return its complete terminal two-task measurement.",
			parameters: CompilerGymIrDeltaScreenEvaluationSchema,
		},
		providerSessionId,
		providerVisibleWorkspace: COMPILER_GYM_LATE_NOVELTY_SCREEN_PROVIDER_VISIBLE_WORKSPACE,
		providerVisibleConversationLog: COMPILER_GYM_LATE_NOVELTY_SCREEN_PROVIDER_VISIBLE_CONVERSATION_LOG,
		agentRegistry,
		maxDispatchesPerArm: 4,
		modelPolicy: COMPILER_GYM_HARDENED_PAID_MODEL_POLICY,
		guidance: {
			field: COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
			value: COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
			treatmentArm: "late-novelty-treatment",
			consumerDispatchOrdinal: 4,
			producerResultOrdinal: 3,
			requiresAcceptedProducerResult: true,
			acceptedBenchmarkIds: STOCK_CPU_TASKS,
		},
	} as const;
}

export function buildCompilerGymLateNoveltyScreenPreregistration(input: {
	createdAt: string;
	drawHex: string;
	implementationClosure: readonly CompilerGymLateNoveltySourceRecord[];
	stockTrajectoryImplementationBundleSha256: string;
	runtimeWorktreeSnapshot: RepositorySnapshot;
	providerRegistryClosure: CompilerGymLateNoveltyProviderRegistryClosure;
}): CompilerGymLateNoveltyScreenPreregistration {
	if (!Number.isFinite(Date.parse(input.createdAt)))
		throw new Error("Late-novelty preregistration timestamp is invalid");
	const closure = validateClosure(input.implementationClosure);
	const snapshot = validateSnapshot(input.runtimeWorktreeSnapshot);
	const providerRegistryClosure = validateProviderRegistryClosure(input.providerRegistryClosure);
	const implementationBundleSha256 = sha256Json(closure);
	if (!/^[a-f0-9]{64}$/.test(input.stockTrajectoryImplementationBundleSha256)) {
		throw new Error("Late-novelty stock trajectory implementation bundle hash is invalid");
	}
	const snapshotSha256 = sha256Json(snapshot);
	const providerSessionId = `pln-${sha256Json({
		pairId: COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
		createdAt: input.createdAt,
		drawHex: input.drawHex,
		implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: input.stockTrajectoryImplementationBundleSha256,
		snapshotSha256,
		providerRegistryClosure,
	}).slice(0, 32)}`;
	const providerSpec = buildProviderSpec(providerSessionId, providerRegistryClosure);
	return {
		schemaVersion: 1,
		protocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_PREREGISTRATION_PROTOCOL,
		screenProtocol: COMPILER_GYM_LATE_NOVELTY_SCREEN_PROTOCOL,
		pairId: COMPILER_GYM_LATE_NOVELTY_SCREEN_PAIR_ID,
		createdAt: input.createdAt,
		status: "preregistered-before-provider-or-evaluator-dispatch",
		classification: "prospective-development-informed-directional-screen",
		question:
			"Does one bounded call-four structural-novelty hint improve Luna's verified parent-relative terminal proposal?",
		hypothesis:
			"After three accepted measurements, the frozen Dice-LCS hint makes call four structurally novel and more likely to strictly dominate its declared parent.",
		claimClass: "directional-single-randomized-order-pair",
		causalClaimAllowed: false,
		replicationClaimAllowed: false,
		gpuPromotionAllowed: false,
		randomization: {
			method: "cryptographic-byte-parity-v1",
			drawHex: input.drawHex,
			armOrder: armOrder(input.drawHex),
		},
		arms: [
			{ id: "unchanged-control", modelFeedback: "unchanged-hidden-trace-terminal-envelope" },
			{
				id: "late-novelty-treatment",
				modelFeedback: "control-envelope-plus-one-call4Guidance-field-only-after-accepted-result-three",
			},
		],
		historicalMotivation: structuredClone(COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION),
		frozenCommon: {
			primeAgentCommit: FROZEN_CAMPAIGN.repositories.primeAgent.commit,
			model: "openai-codex/gpt-5.6-luna",
			thinkingLevel: "xhigh",
			requestedServiceTier: "priority",
			promptSha256: sha256Text(buildCompilerGymIrDeltaScreenPrompt()),
			calibration: COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION,
			verifierEpoch: COMPILER_GYM_IR_DELTA_SCREEN_VERIFIER_EPOCH,
			canonicalEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_CANONICAL_EVALUATOR_SHA256,
			irDeltaEvaluatorSha256: COMPILER_GYM_IR_DELTA_SCREEN_EVALUATOR_SHA256,
			evaluatorSourceBundleSha256: COMPILER_GYM_IR_DELTA_SCREEN_SOURCE_BUNDLE_SHA256,
			providerRetries: 0,
			compaction: false,
			webAccess: false,
			rlmChildren: false,
			measurementReuse: false,
			latchForbiddenToolExecutionWithinResponse: true,
			liveEnvironmentGate: {
				protocol: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_GATE_PROTOCOL,
				probeSourceSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_PROBE_SHA256,
				expectedResultSha256: COMPILER_GYM_PAID_LIVE_ENVIRONMENT_EXPECTED_RESULT_SHA256,
				timing: "immediately-before-each-provider-request",
				transport: "read-only-login-node-ssh-no-slurm",
			},
		},
		authorization: {
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			paid: true,
			treatmentExecution: true,
			maximumActualProviderDispatches: 8,
			perArmActualProviderDispatches: 4,
			authorizedOnlyAfterAllPreDispatchIntegrityGatesPass: true,
			compactionOrAuxiliaryModelCallsAuthorized: false,
		},
		budgets: {
			pairCount: 1,
			perArm: { providerCalls: 4, evaluatorJobs: 4, freshTaskEvaluations: 8, reusedTaskEvaluations: 0 },
			pairTotals: { providerCalls: 8, evaluatorJobs: 8, freshTaskEvaluations: 16, reusedTaskEvaluations: 0 },
			retries: 0,
			replacements: 0,
		},
		firstToolCall: {
			request: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_REQUEST),
			actionsSha256: COMPILER_GYM_IR_DELTA_SCREEN_S12_SHA256,
			expectedMetrics: structuredClone(COMPILER_GYM_IR_DELTA_SCREEN_S12_EXPECTED_METRICS),
			driftDisposition: "terminal-apparatus-invalid-not-treatment-result",
		},
		treatment: {
			field: COMPILER_GYM_LATE_NOVELTY_GUIDANCE_FIELD,
			value: COMPILER_GYM_LATE_NOVELTY_GUIDANCE,
			serializedFieldBytes: 128,
			maximumSerializedDeltaBytes: COMPILER_GYM_LATE_NOVELTY_PROMPT_DELTA_BUDGET_BYTES,
			producerResultOrdinal: 3,
			consumerProviderDispatchOrdinal: 4,
			requiresAcceptedResultThree: true,
			hardCandidateRejection: false,
		},
		assessment: {
			similarityThreshold: COMPILER_GYM_LATE_NOVELTY_THRESHOLD,
			primary: "treatment-call-four-dominates-parent-and-control-call-four-does-not",
			secondary: "treatment-normalized-minimax-parent-ratio-strictly-lower-than-control",
			winNextGate: "one-fresh-randomized-replication",
			nonWinNextGate: "kill-late-novelty-v2",
		},
		providerSpec,
		providerSpecSha256: sha256Json(providerSpec),
		providerRegistryClosure,
		formalEvidence: structuredClone(COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE),
		implementationClosure: closure,
		implementationBundleSha256,
		stockTrajectoryImplementationBundleSha256: input.stockTrajectoryImplementationBundleSha256,
		runtimeWorktreeClosure: { roots: [...PRIME_RUNTIME_WORKTREE_PATHS], snapshot, snapshotSha256 },
	};
}

export function parseCompilerGymLateNoveltyScreenPreregistration(
	value: unknown,
	expectedImplementationClosure: readonly CompilerGymLateNoveltySourceRecord[],
	expectedStockTrajectoryImplementationBundleSha256: string,
	expectedRuntimeWorktreeSnapshot: RepositorySnapshot,
	expectedProviderRegistryClosure: CompilerGymLateNoveltyProviderRegistryClosure,
): CompilerGymLateNoveltyScreenPreregistration {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("Late-novelty preregistration must be an object");
	const record = value as Record<string, unknown>;
	const randomization = record.randomization;
	if (
		typeof record.createdAt !== "string" ||
		!randomization ||
		typeof randomization !== "object" ||
		Array.isArray(randomization)
	) {
		throw new Error("Late-novelty preregistration lacks timestamp or randomization");
	}
	const drawHex = (randomization as Record<string, unknown>).drawHex;
	if (typeof drawHex !== "string") {
		throw new Error("Late-novelty preregistration lacks draw or provider spec");
	}
	const expected = buildCompilerGymLateNoveltyScreenPreregistration({
		createdAt: record.createdAt,
		drawHex,
		implementationClosure: expectedImplementationClosure,
		stockTrajectoryImplementationBundleSha256: expectedStockTrajectoryImplementationBundleSha256,
		runtimeWorktreeSnapshot: expectedRuntimeWorktreeSnapshot,
		providerRegistryClosure: expectedProviderRegistryClosure,
	});
	assert.deepEqual(value, expected, "Late-novelty preregistration does not match the frozen protocol");
	return expected;
}

export async function collectCompilerGymLateNoveltyScreenImplementationClosure(repoRoot: string) {
	const canonicalRepoRoot = await realpath(resolve(repoRoot));
	const pending: string[] = [...COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS];
	const sourceHashes = new Map<string, string>();
	while (pending.length > 0) {
		const requestedPath = pending.shift()!;
		assertCanonicalInRepoRelativePath(requestedPath, "implementation root");
		if (sourceHashes.has(requestedPath)) continue;
		const requestedAbsolutePath = resolve(canonicalRepoRoot, requestedPath);
		canonicalPathWithinRepository(canonicalRepoRoot, requestedAbsolutePath, "implementation source");
		let canonicalAbsolutePath: string;
		try {
			canonicalAbsolutePath = await realpath(requestedAbsolutePath);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				throw new Error(`Late-novelty implementation source is unresolved: ${requestedPath}`);
			}
			throw error;
		}
		const canonicalRelativePath = canonicalPathWithinRepository(
			canonicalRepoRoot,
			canonicalAbsolutePath,
			"implementation source",
		);
		if (canonicalRelativePath !== requestedPath) {
			throw new Error(
				`Late-novelty implementation source is not canonical: ${requestedPath} -> ${canonicalRelativePath}`,
			);
		}
		const metadata = await stat(canonicalAbsolutePath);
		if (!metadata.isFile()) throw new Error(`Late-novelty implementation source is not a file: ${requestedPath}`);
		const source = await readFile(canonicalAbsolutePath, "utf8");
		sourceHashes.set(canonicalRelativePath, sha256Text(source));
		if (!COMPILER_GYM_LATE_NOVELTY_SOURCE_EXTENSION_PATTERN.test(canonicalRelativePath)) continue;
		const imports = compilerGymLateNoveltyLocalImportSpecifiers(source, canonicalRelativePath);
		for (const specifier of imports) {
			const dependencyPath = await resolveCompilerGymLateNoveltyLocalImport({
				repoRoot: canonicalRepoRoot,
				importerPath: canonicalAbsolutePath,
				importerRelativePath: canonicalRelativePath,
				specifier,
			});
			if (!sourceHashes.has(dependencyPath) && !pending.includes(dependencyPath)) pending.push(dependencyPath);
		}
		pending.sort(compareCanonicalPaths);
	}
	return [...sourceHashes.entries()]
		.sort(([left], [right]) => compareCanonicalPaths(left, right))
		.map(([relativePath, sha256]) => ({ relativePath, sha256 }));
}

export function compilerGymLateNoveltyStockAdditionalSourcePaths(repoRoot: string): string[] {
	const evaluatorScriptPath = resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const basePaths = new Set(stockInterfaceParityImplementationSourcePaths({ evaluatorScriptPath }));
	return COMPILER_GYM_LATE_NOVELTY_SCREEN_ADDITIONAL_IMPLEMENTATION_PATHS.map((path) =>
		resolve(repoRoot, path),
	).filter((path) => !basePaths.has(path));
}

export async function computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(repoRoot: string) {
	const evaluatorScriptPath = resolve(repoRoot, "research/autoresearch/evaluators/compiler_gym_ir_delta_eval.py");
	const additionalSourcePaths = compilerGymLateNoveltyStockAdditionalSourcePaths(repoRoot);
	return computeStockInterfaceParityImplementationBundle({ evaluatorScriptPath, additionalSourcePaths });
}

export async function captureCompilerGymLateNoveltyProviderRegistryClosure(
	agentDirInput: string,
): Promise<CompilerGymLateNoveltyProviderRegistryClosure> {
	const agentDir = resolve(agentDirInput);
	const modelsJsonPath = resolve(agentDir, "models.json");
	try {
		await stat(modelsJsonPath);
		throw new Error(`Late-novelty paid screen forbids an active models.json: ${modelsJsonPath}`);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return { agentDir, modelsJsonPath, modelsJsonPresent: false };
		}
		throw error;
	}
}

async function readPrivateAnchoredFile(repoRoot: string, input: { path: string; sha256: string }): Promise<string> {
	const path = resolve(repoRoot, input.path);
	const metadata = await stat(path);
	if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
		throw new Error(`Late-novelty prerequisite is not mode 0600: ${input.path}`);
	const contents = await readFile(path, "utf8");
	if (sha256Text(contents) !== input.sha256) throw new Error(`Late-novelty prerequisite hash drifted: ${input.path}`);
	return contents;
}

export async function verifyCompilerGymLateNoveltyScreenPrerequisites(repoRoot: string) {
	const [formalPreregistration, formalResult, formalLedger, calibration, motivation] = await Promise.all([
		readPrivateAnchoredFile(repoRoot, COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.preregistration),
		readPrivateAnchoredFile(repoRoot, COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.result),
		readPrivateAnchoredFile(repoRoot, COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.ledger),
		readPrivateAnchoredFile(repoRoot, COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION),
		readPrivateAnchoredFile(repoRoot, COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION),
	]);
	verifyLedgerContentsStrict(formalLedger);
	const result = JSON.parse(formalResult) as Record<string, unknown>;
	if (
		result.terminalDisposition !== "terminal-complete-scientific-pass" ||
		result.modelCalls !== 0 ||
		result.lunaAuthorized !== false
	) {
		throw new Error("Late-novelty formal prerequisite semantics drifted");
	}
	void JSON.parse(formalPreregistration);
	void JSON.parse(calibration);
	void JSON.parse(motivation);
	return {
		formalResultSha256: COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.result.sha256,
		formalLedgerSha256: COMPILER_GYM_LATE_NOVELTY_SCREEN_FORMAL_EVIDENCE.ledger.sha256,
		calibrationSha256: COMPILER_GYM_LATE_NOVELTY_SCREEN_CALIBRATION.sha256,
		historicalMotivationSha256: COMPILER_GYM_LATE_NOVELTY_SCREEN_HISTORICAL_MOTIVATION.sha256,
		allFilesMode0600: true,
	};
}

export async function writeCompilerGymLateNoveltyScreenPreregistration(
	outputPath: string,
	preregistration: CompilerGymLateNoveltyScreenPreregistration,
): Promise<void> {
	const output = resolve(outputPath);
	await mkdir(dirname(output), { recursive: true, mode: 0o700 });
	const handle = await open(output, "wx", 0o600);
	try {
		await handle.chmod(0o600);
		await handle.writeFile(`${canonicalJson(toJsonValue(preregistration))}\n`, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function main(): Promise<void> {
	if (process.argv.length !== 4 || process.argv[2] !== "--output")
		throw new Error("Usage: late-novelty-preregister --output <path>");
	const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
	await verifyCompilerGymLateNoveltyScreenPrerequisites(repoRoot);
	const preregistration = buildCompilerGymLateNoveltyScreenPreregistration({
		createdAt: new Date().toISOString(),
		drawHex: randomBytes(16).toString("hex"),
		implementationClosure: await collectCompilerGymLateNoveltyScreenImplementationClosure(repoRoot),
		stockTrajectoryImplementationBundleSha256: (
			await computeCompilerGymLateNoveltyStockTrajectoryImplementationBundle(repoRoot)
		).sha256,
		runtimeWorktreeSnapshot: capturePrimeRuntimeWorktreeSnapshot(repoRoot),
		providerRegistryClosure: await captureCompilerGymLateNoveltyProviderRegistryClosure(getAgentDir()),
	});
	await writeCompilerGymLateNoveltyScreenPreregistration(process.argv[3]!, preregistration);
	process.stdout.write(`${canonicalJson(toJsonValue(preregistration))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	void main().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
		process.exitCode = 1;
	});
}
