import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./canonical-json.js";
import { ResearchController } from "./controller.js";
import {
	DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG,
	KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
	KERNELBENCH_COMPILED_HIDDEN_SHA256,
	KERNELBENCH_COMPILED_POSITIVE_SHA256,
	KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX,
	KERNELBENCH_COMPILED_QUALIFICATION_TASKS,
	KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT,
	KERNELBENCH_COMPILED_TASK_SHA256,
	KERNELBENCH_COMPILED_WRONG_SHA256,
	KernelBenchCompiledQualificationAdapter,
	kernelBenchCompiledQualificationBoundaryConditions,
} from "./kernelbench-compiled-qualification-adapter.js";
import { KERNELBENCH_VERIFIED_COMMIT } from "./kernelbench-qualification-adapter.js";

interface CliOptions {
	outputDir: string;
	bootstrap: boolean;
	submit: boolean;
}

function parseOptions(argv: readonly string[]): CliOptions {
	let outputDir: string | null = null;
	let bootstrap = false;
	let submit = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--output-dir") {
			const value = argv[index + 1];
			if (!value) throw new Error("--output-dir requires a path");
			outputDir = resolve(value);
			index++;
			continue;
		}
		if (argument === "--bootstrap") {
			bootstrap = true;
			continue;
		}
		if (argument === "--submit") {
			submit = true;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (outputDir === null) {
		throw new Error(
			"Usage: autoresearch:kernelbench-qualify-compiled -- --output-dir <durable-path> [--bootstrap] [--submit]",
		);
	}
	return { outputDir, bootstrap, submit };
}

async function readPositiveCandidate(): Promise<string> {
	const path = fileURLToPath(new URL("../candidates/kernelbench/level2-2-inductor-fullgraph-v1.py", import.meta.url));
	const source = await readFile(path, "utf8");
	const digest = sha256Text(source);
	if (digest !== KERNELBENCH_COMPILED_POSITIVE_SHA256) {
		throw new Error(
			`Positive candidate SHA-256 mismatch: expected ${KERNELBENCH_COMPILED_POSITIVE_SHA256}, got ${digest}`,
		);
	}
	return source;
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const positiveCandidate = await readPositiveCandidate();
	const baseContract = {
		type: "kernelbench_verified_compiled_qualification",
		verifierEpochPrefix: KERNELBENCH_COMPILED_QUALIFICATION_EPOCH_PREFIX,
		kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
		tasks: KERNELBENCH_COMPILED_QUALIFICATION_TASKS,
		treatment: KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT,
		usesModelApi: false,
		hardware: "one FarmShare L40S",
		resources: { gpus: 1, cpus: 8, memory: "32G", time: "00:30:00" },
		precision: { dtype: "float32", tf32: true, atol: 1e-3, rtol: 1e-3 },
		compilation: { backend: "inductor", fullgraph: true, dynamic: false },
		hiddenConfigs: 4,
		timing: {
			coldFirstInvocationSeparate: true,
			warmups: 3,
			trials: 10,
			rawSamplesPreserved: true,
		},
		acceptanceGate: "positive passes all four configs and wrong candidate fails all four configs",
		taskSha256: KERNELBENCH_COMPILED_TASK_SHA256,
		hiddenTestSha256: KERNELBENCH_COMPILED_HIDDEN_SHA256,
		positiveCandidateSha256: KERNELBENCH_COMPILED_POSITIVE_SHA256,
		wrongCandidateSha256: KERNELBENCH_COMPILED_WRONG_SHA256,
		environmentSpecSha256: KERNELBENCH_COMPILED_ENVIRONMENT_SHA256,
		remoteRoot: DEFAULT_KERNELBENCH_COMPILED_QUALIFICATION_CONFIG.remoteRoot,
		outputDir: options.outputDir,
	};
	if (!options.submit && !options.bootstrap) {
		console.log(
			JSON.stringify(
				{
					...baseContract,
					status: "dry-run; pass --bootstrap to prepare or --submit to require existing readiness",
				},
				null,
				2,
			),
		);
		return;
	}
	const adapter = new KernelBenchCompiledQualificationAdapter();
	const signal = new AbortController().signal;
	const verifierContract = options.bootstrap ? await adapter.bootstrap(signal) : await adapter.requireReady(signal);
	const contract = {
		...baseContract,
		verifierEpoch: verifierContract.verifierEpoch,
		verifierContractDigest: verifierContract.contractDigest,
		environmentManifestSha256: verifierContract.environmentEvidence.environmentManifestSha256,
		pipFreezeSha256: verifierContract.environmentEvidence.pipFreezeSha256,
		environmentSealSha256: verifierContract.environmentEvidence.environmentSealSha256,
	};
	if (!options.submit) {
		console.log(JSON.stringify({ ...contract, status: "bootstrap complete and readiness verified" }, null, 2));
		return;
	}

	const controller = await ResearchController.open({
		ledgerPath: resolve(options.outputDir, "evidence.jsonl"),
		artifactDir: resolve(options.outputDir, "artifacts"),
		adapters: [adapter],
		metrics: {
			"compiler-gym": { name: "IrInstructionCount", direction: "minimize" },
			kernelbench: { name: "qualified", direction: "maximize" },
			nanogpt: { name: "trainSteps", direction: "minimize" },
		},
		allowedBenchmarks: {
			"compiler-gym": [],
			kernelbench: KERNELBENCH_COMPILED_QUALIFICATION_TASKS,
			nanogpt: [],
		},
		allowedTreatments: [KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT],
		maxInflight: { kernelbench: 1 },
		maxSubmissionsPerBranch: 1,
		maxTaskEvaluationsPerBranch: 1,
	});
	await controller.appendRunManifest(contract);
	const submitted = await controller.submit({
		branchId: "kernelbench-compiled-qualification",
		lane: "kernelbench",
		benchmarkIds: [...KERNELBENCH_COMPILED_QUALIFICATION_TASKS],
		budgetClass: "smoke",
		treatment: KERNELBENCH_COMPILED_QUALIFICATION_TREATMENT,
		proposal: {
			hypothesis: "The exact allowlisted compiled candidate preserves level2/2 correctness",
			mechanism:
				"Compare the pinned compiled ModelNew and wrong-output ModelNew with the pinned reference on four hidden configs",
			predictedOutcome: "The positive passes all configs and the wrong candidate fails all configs",
			boundaryConditions: [...kernelBenchCompiledQualificationBoundaryConditions(verifierContract)],
			parentJobIds: [],
		},
		candidate: { format: "python-source", content: positiveCandidate },
	});
	await controller.waitForIdle();
	controller.verifyLedger();
	const job = controller.status([submitted.jobId])[0];
	if (!job) throw new Error(`Controller lost submitted job ${submitted.jobId}`);
	console.log(JSON.stringify({ ...contract, submitted, job }));
	if (job.state.status !== "succeeded") process.exitCode = 1;
}

await main();
