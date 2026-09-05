import { resolve } from "node:path";
import process from "node:process";
import { ResearchController } from "./controller.js";
import {
	DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG,
	KERNELBENCH_QUALIFICATION_CANDIDATE,
	KERNELBENCH_QUALIFICATION_EPOCH_PREFIX,
	KERNELBENCH_QUALIFICATION_TASKS,
	KERNELBENCH_VERIFIED_COMMIT,
	KernelBenchQualificationAdapter,
	kernelBenchQualificationBoundaryConditions,
} from "./kernelbench-qualification-adapter.js";

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
		if (argument === "--submit") {
			submit = true;
			continue;
		}
		if (argument === "--bootstrap") {
			bootstrap = true;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	if (outputDir === null) {
		throw new Error(
			"Usage: autoresearch:kernelbench-qualify -- --output-dir <durable-path> [--bootstrap] [--submit]",
		);
	}
	return { outputDir, bootstrap, submit };
}

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));
	const baseContract = {
		type: "kernelbench_verified_qualification",
		verifierEpochPrefix: KERNELBENCH_QUALIFICATION_EPOCH_PREFIX,
		kernelBenchVerifiedCommit: KERNELBENCH_VERIFIED_COMMIT,
		tasks: KERNELBENCH_QUALIFICATION_TASKS,
		candidate: KERNELBENCH_QUALIFICATION_CANDIDATE,
		usesModelApi: false,
		hardware: "one FarmShare L40S",
		resources: { gpus: 1, cpus: 8, memory: "32G", time: "00:30:00" },
		precision: { dtype: "float32", tf32: true, atol: 1e-3, rtol: 1e-3 },
		compileCanary: { backend: "inductor", fullgraph: true, device: "cuda", shape: [256] },
		hiddenConfigsPerTask: 4,
		timing: { warmups: 3, trials: 10, rawSamplesPreserved: true },
		wrongOutputNegativeControlPerTask: true,
		remoteRoot: DEFAULT_KERNELBENCH_QUALIFICATION_CONFIG.remoteRoot,
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
	const adapter = new KernelBenchQualificationAdapter();
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
			kernelbench: KERNELBENCH_QUALIFICATION_TASKS,
			nanogpt: [],
		},
		allowedTreatments: ["qualification"],
		maxInflight: { kernelbench: 1 },
		maxSubmissionsPerBranch: 16,
		maxTaskEvaluationsPerBranch: KERNELBENCH_QUALIFICATION_TASKS.length * 16,
	});
	await controller.appendRunManifest(contract);
	const submitted = await controller.submit({
		branchId: "kernelbench-qualification",
		lane: "kernelbench",
		benchmarkIds: [...KERNELBENCH_QUALIFICATION_TASKS],
		budgetClass: "smoke",
		treatment: "qualification",
		proposal: {
			hypothesis:
				"The pinned KernelBench-Verified lane correctly accepts identity and rejects trusted wrong outputs",
			mechanism:
				"Run the pinned reference as ModelNew against four hidden configurations and a wrong-output control",
			predictedOutcome: "All identity checks pass and every deliberately wrong output fails",
			boundaryConditions: [...kernelBenchQualificationBoundaryConditions(verifierContract)],
			parentJobIds: [],
		},
		candidate: { format: "python-source", content: KERNELBENCH_QUALIFICATION_CANDIDATE },
	});
	await controller.waitForIdle();
	controller.verifyLedger();
	const job = controller.status([submitted.jobId])[0];
	if (!job) throw new Error(`Controller lost submitted job ${submitted.jobId}`);
	console.log(JSON.stringify({ ...contract, submitted, job }));
	if (job.state.status !== "succeeded") process.exitCode = 1;
}

await main();
