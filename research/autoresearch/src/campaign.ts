import type { BenchmarkLane, BudgetClass, MetricDirection } from "./types.js";

export type ResourceAxisId =
	| "admitted-task-evaluations"
	| "output-tokens"
	| "active-agent-seconds"
	| "calendar-seconds";
export type CampaignArmId = "control" | "M" | "W" | "R" | "S";
export type CampaignStage = BudgetClass;
export type MetricRole = "primary" | "gate" | "secondary";
export type CBenchTaskId = `benchmark://cbench-v1/${string}`;
export type KernelBenchTaskId = `level${1 | 2 | 3}/${number}`;

export interface PinnedRepository {
	readonly repository: string;
	readonly commit: string;
	readonly ref: string;
}

export interface ResourceAxis {
	readonly id: ResourceAxisId;
	readonly unit: "calls" | "tokens" | "seconds";
	readonly includesQueueWait: boolean;
}

export type ResourceBudget = Readonly<Record<ResourceAxisId, number>>;

export interface StageBudget {
	readonly stage: CampaignStage;
	readonly searchTaskSet: string;
	readonly verificationTaskSet: string;
	readonly trajectoriesPerArm: number;
	readonly limitsPerTrajectory: ResourceBudget;
}

export interface MetricDefinition {
	readonly id: string;
	readonly sourceField: string;
	readonly direction: MetricDirection;
	readonly unit: string;
	readonly role: MetricRole;
	readonly raw: boolean;
}

export interface HarnessFeatures {
	readonly measuredEvidence: "none" | "typed-branch-local";
	readonly retainEvidenceAcrossCompaction: boolean;
	readonly retainConditionalFailures: boolean;
	readonly isolatedTrajectoryCount: 1 | 2;
	readonly resourceSharePerTrajectory: 0.5 | 1;
	readonly equalAggregateResources: boolean;
	readonly retestQueue: boolean;
	readonly resurrectionQueue: boolean;
	readonly componentReablationQueue: boolean;
	readonly measuredSummarySharing: "none" | "sparse";
}

export interface CampaignArm {
	readonly id: CampaignArmId;
	readonly kind: "baseline" | "treatment";
	readonly enabledInitially: boolean;
	readonly prerequisites: readonly CampaignArmId[];
	readonly incrementalAgainst: readonly CampaignArmId[];
	readonly features: HarnessFeatures;
}

export interface CampaignConfig {
	readonly schemaVersion: 1;
	readonly id: string;
	readonly frozenAt: string;
	readonly repositories: Readonly<Record<string, PinnedRepository>>;
	readonly model: {
		readonly provider: "openai-codex";
		readonly id: "gpt-5.6-luna";
		readonly profile: "fast";
		readonly thinkingLevel: "xhigh";
		readonly serviceTier: "priority";
	};
	readonly resourceAxes: readonly ResourceAxis[];
	readonly lanes: {
		readonly compilerGym: {
			readonly lane: "compiler-gym";
			readonly llvmVersion: "10.0.0";
			readonly environment: "llvm-v0";
			readonly validatableTasks: readonly CBenchTaskId[];
			readonly smokeSearchTasks: readonly CBenchTaskId[];
			readonly smokeValidationTasks: readonly CBenchTaskId[];
			readonly devTasks: readonly CBenchTaskId[];
			readonly holdoutTasks: readonly CBenchTaskId[];
			readonly burnedDuringQualificationTasks: readonly CBenchTaskId[];
			readonly excludedVerifierWeakTasks: readonly CBenchTaskId[];
			readonly excludedNonValidatableTasks: readonly CBenchTaskId[];
			readonly splitPolicy: string;
			readonly metrics: readonly MetricDefinition[];
			readonly budgets: readonly StageBudget[];
		};
		readonly kernelBench: {
			readonly lane: "kernelbench";
			readonly panelSelection: string;
			readonly panelTasks: readonly KernelBenchTaskId[];
			readonly devTasks: readonly KernelBenchTaskId[];
			readonly holdoutTasks: readonly KernelBenchTaskId[];
			readonly excludedDegenerateTasks: readonly KernelBenchTaskId[];
			readonly maxEvaluatorCallsPerTask: number;
			readonly metrics: readonly MetricDefinition[];
			readonly hardeningEpoch: {
				readonly id: string;
				readonly frozenAt: string;
				readonly verifierCommit: string;
				readonly crossEpochAggregation: "forbidden";
				readonly baseline: "pytorch-fp32-tf32-enabled";
				readonly regenerateBaselineOnCampaignHardware: true;
				readonly hiddenInputTransforms: readonly [1, 3, 0.01, -1];
				readonly fp32Tolerance: 0.001;
				readonly timingWarmups: 3;
				readonly pilotTimingTrials: 10;
				readonly confirmationTimingTrials: 100;
				readonly nearParityConfirmationBlocks: 5;
				readonly candidateFrozenBeforeSubmission: true;
			};
			readonly queuePolicy: {
				readonly maxInFlightPerArm: 4;
				readonly pairedRandomizedBlocks: true;
				readonly releaseFeedbackAfterPairedCompletion: true;
				readonly allocationDecisionsAtFixedCheckpoints: true;
				readonly arrivalOrderMayChangeBudget: false;
			};
			readonly budgets: readonly StageBudget[];
		};
		readonly nanoGpt: {
			readonly lane: "nanogpt";
			readonly hardware: "4xL40S-FarmShare";
			readonly baselineTrainSteps: 3290;
			readonly humanRecordTrainSteps: 2600;
			readonly gate: {
				readonly trialSeeds: readonly number[];
				readonly wideningSchedule: readonly [1, 2, 4, 8];
				readonly requiredTrialCount: 8;
				readonly meanValidationLossExclusiveUpperBound: 3.27859;
				readonly targetValidationLoss: 3.28;
				readonly recordRequiresStrictlyFewerSteps: true;
				readonly nonCherryPickedExactConfig: true;
				readonly partialCurveEarlyStopping: false;
			};
			readonly metrics: readonly MetricDefinition[];
			readonly budgets: readonly StageBudget[];
			readonly primaryHarnessReplication: {
				readonly trajectoriesPerArm: 3;
				readonly activeSecondsPerTrajectory: 21600;
				readonly showcaseExtensionSeconds: 86400;
				readonly showcaseInference: "descriptive-only";
			};
		};
	};
	readonly arms: readonly CampaignArm[];
	readonly combinationPolicy: {
		readonly enabledDuringSingleArmScreen: false;
		readonly requireEachFactorToPromoteAlone: true;
		readonly maximumFactorialExperiments: 1;
		readonly maximumFactors: 2;
		readonly design: "2x2";
	};
	readonly deferredCapabilities: readonly ["literature-retrieval"];
	readonly decisions: {
		readonly minimumPracticalEffect: {
			readonly frozenBeforeTreatments: true;
			readonly rule: "max(practical-floor,2*baseline-noise-scale)";
		};
		readonly promotion: {
			readonly earliestBudgetFraction: 0.5;
			readonly provisionalProbabilityAtOrAboveMinimumEffect: 0.9;
			readonly confirmationIntervalLevel: 0.95;
			readonly confirmationLowerBoundMustExceedZero: true;
			readonly maximumArmsPromotedPerStage: 2;
			readonly integrityViolationsAllowed: 0;
			readonly kernelBenchRequiresHiddenFastAtOneNonInferiority: true;
			readonly kernelBenchRequiresPositivePairedLogSpeedup: true;
			readonly nanoGptRequiresOfficialEightSeedGate: true;
		};
		readonly futility: {
			readonly hardFailuresOnlyBeforeBudgetFraction: 0.5;
			readonly oneSidedUpperIntervalLevel: 0.9;
			readonly stopWhenUpperBoundBelowMinimumEffect: true;
			readonly inconclusiveIsFailure: false;
			readonly nanoGptMayUsePartialLossCurve: false;
		};
	};
	readonly reporting: {
		readonly crossBenchmarkAggregateScore: false;
		readonly compareBenchmarkLocalPairedEffects: true;
		readonly frontierAxes: readonly ResourceAxisId[];
		readonly queueWaitReportedSeparately: true;
	};
}

const compilerGymDevTasks = [
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
	"benchmark://cbench-v1/qsort",
	"benchmark://cbench-v1/dijkstra",
	"benchmark://cbench-v1/gsm",
	"benchmark://cbench-v1/jpeg-d",
	"benchmark://cbench-v1/patricia",
	"benchmark://cbench-v1/stringsearch",
	"benchmark://cbench-v1/susan",
	"benchmark://cbench-v1/tiff2rgba",
	"benchmark://cbench-v1/tiffmedian",
] as const satisfies readonly CBenchTaskId[];

const compilerGymHoldoutTasks = [
	"benchmark://cbench-v1/crc32",
	"benchmark://cbench-v1/jpeg-c",
	"benchmark://cbench-v1/tiff2bw",
	"benchmark://cbench-v1/tiffdither",
] as const satisfies readonly CBenchTaskId[];

const compilerGymVerifierWeakTasks = [
	"benchmark://cbench-v1/bitcount",
	"benchmark://cbench-v1/sha",
	"benchmark://cbench-v1/stringsearch2",
] as const satisfies readonly CBenchTaskId[];

const compilerGymSmokeSearchTasks = [
	"benchmark://cbench-v1/blowfish",
	"benchmark://cbench-v1/bzip2",
] as const satisfies readonly CBenchTaskId[];

const compilerGymSmokeValidationTasks = ["benchmark://cbench-v1/dijkstra"] as const satisfies readonly CBenchTaskId[];

const kernelBenchDevTasks = [
	"level1/1",
	"level1/11",
	"level1/14",
	"level1/19",
	"level1/26",
	"level2/2",
	"level2/8",
	"level2/10",
	"level2/11",
	"level2/26",
	"level3/1",
	"level3/25",
] as const satisfies readonly KernelBenchTaskId[];

const kernelBenchHoldoutTasks = [
	"level1/43",
	"level1/47",
	"level1/51",
	"level1/53",
	"level1/79",
	"level1/94",
	"level1/99",
	"level2/32",
	"level2/40",
	"level2/56",
	"level2/58",
	"level2/90",
	"level2/91",
	"level2/97",
	"level3/26",
	"level3/31",
	"level3/35",
	"level3/39",
] as const satisfies readonly KernelBenchTaskId[];

const nanoGptTrialSeeds = [0xc0ffee, 0xc0ffef, 0xc0fff0, 0xc0fff1, 0xc0fff2, 0xc0fff3, 0xc0fff4, 0xc0fff5] as const;

const resourceAxes = [
	{ id: "admitted-task-evaluations", unit: "calls", includesQueueWait: false },
	{ id: "output-tokens", unit: "tokens", includesQueueWait: false },
	{ id: "active-agent-seconds", unit: "seconds", includesQueueWait: false },
	{ id: "calendar-seconds", unit: "seconds", includesQueueWait: true },
] as const satisfies readonly ResourceAxis[];

function budget(
	admittedTaskEvaluations: number,
	outputTokens: number,
	activeAgentSeconds: number,
	calendarSeconds: number,
): ResourceBudget {
	return {
		"admitted-task-evaluations": admittedTaskEvaluations,
		"output-tokens": outputTokens,
		"active-agent-seconds": activeAgentSeconds,
		"calendar-seconds": calendarSeconds,
	};
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const key of Reflect.ownKeys(value)) {
			deepFreeze(Reflect.get(value, key));
		}
		Object.freeze(value);
	}
	return value;
}

export const FROZEN_CAMPAIGN = deepFreeze({
	schemaVersion: 1,
	id: "prime-agent-autoresearch-v1",
	frozenAt: "2026-08-27T00:00:00.000Z",
	repositories: {
		primeAgent: {
			repository: "https://github.com/PrimeIntellect-ai/prime-agent.git",
			commit: "bc0fa7606abb3b7af0f765319518d255e6ae553d",
			ref: "main",
		},
		compilerGym: {
			repository: "https://github.com/facebookresearch/CompilerGym.git",
			commit: "64bdd6cd39967d3d2fe5e6c72deb15e830b838bb",
			ref: "v0.2.5",
		},
		kernelBench: {
			repository: "https://github.com/ScalingIntelligence/KernelBench.git",
			commit: "423217d9fda91e0c2d67e4a43bf62f96f6d104f1",
			ref: "main",
		},
		kernelBenchVerified: {
			repository: "https://github.com/facebookresearch/kernel_bench_verified.git",
			commit: "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e",
			ref: "main",
		},
		nanoGptSpeedrun: {
			repository: "https://github.com/PrimeIntellect-ai/frontier-automated-speedrun.git",
			commit: "38e258afefb1ce206dd7595aa71d7740da405742",
			ref: "main",
		},
	},
	model: {
		provider: "openai-codex",
		id: "gpt-5.6-luna",
		profile: "fast",
		thinkingLevel: "xhigh",
		serviceTier: "priority",
	},
	resourceAxes,
	lanes: {
		compilerGym: {
			lane: "compiler-gym",
			llvmVersion: "10.0.0",
			environment: "llvm-v0",
			validatableTasks: [...compilerGymDevTasks, ...compilerGymHoldoutTasks, ...compilerGymVerifierWeakTasks],
			smokeSearchTasks: compilerGymSmokeSearchTasks,
			smokeValidationTasks: compilerGymSmokeValidationTasks,
			devTasks: compilerGymDevTasks,
			holdoutTasks: compilerGymHoldoutTasks,
			burnedDuringQualificationTasks: ["benchmark://cbench-v1/qsort"],
			excludedVerifierWeakTasks: compilerGymVerifierWeakTasks,
			excludedNonValidatableTasks: [
				"benchmark://cbench-v1/adpcm",
				"benchmark://cbench-v1/ghostscript",
				"benchmark://cbench-v1/ispell",
				"benchmark://cbench-v1/lame",
				"benchmark://cbench-v1/rijndael",
			],
			splitPolicy:
				"alphabetical trusted-validator list; every-third task assigned to holdout; qsort moved to development after qualification disclosed its metrics; weak validators excluded from scoring",
			metrics: [
				{
					id: "ir-instruction-count",
					sourceField: "IrInstructionCount",
					direction: "minimize",
					unit: "llvm-ir-instructions",
					role: "primary",
					raw: true,
				},
				{
					id: "object-text-size-bytes",
					sourceField: "ObjectTextSizeBytes",
					direction: "minimize",
					unit: "bytes",
					role: "secondary",
					raw: true,
				},
				{
					id: "validation-failures",
					sourceField: "validationFailures",
					direction: "minimize",
					unit: "count",
					role: "gate",
					raw: true,
				},
			],
			budgets: [
				{
					stage: "smoke",
					searchTaskSet: "compiler-gym-smoke-search",
					verificationTaskSet: "compiler-gym-smoke-validation-on-champion-only",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(8, 32000, 600, 900),
				},
				{
					stage: "screen",
					searchTaskSet: "compiler-gym-dev",
					verificationTaskSet: "compiler-gym-dev",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(32, 100000, 3600, 5400),
				},
				{
					stage: "confirm",
					searchTaskSet: "compiler-gym-dev",
					verificationTaskSet: "compiler-gym-holdout-on-final-artifact-only",
					trajectoriesPerArm: 3,
					limitsPerTrajectory: budget(96, 300000, 14400, 18000),
				},
			],
		},
		kernelBench: {
			lane: "kernelbench",
			panelSelection: "explicit-preregistered-balanced-panel; ten tasks per level",
			panelTasks: [...kernelBenchDevTasks, ...kernelBenchHoldoutTasks],
			devTasks: kernelBenchDevTasks,
			holdoutTasks: kernelBenchHoldoutTasks,
			excludedDegenerateTasks: ["level2/23", "level2/80", "level2/83"],
			maxEvaluatorCallsPerTask: 4,
			metrics: [
				{
					id: "correct-all-hidden-distributions",
					sourceField: "correctAllHiddenDistributions",
					direction: "maximize",
					unit: "boolean",
					role: "gate",
					raw: true,
				},
				{
					id: "candidate-runtime-ns",
					sourceField: "candidateRuntimeNs",
					direction: "minimize",
					unit: "nanoseconds",
					role: "primary",
					raw: true,
				},
				{
					id: "reference-runtime-ns",
					sourceField: "referenceRuntimeNs",
					direction: "minimize",
					unit: "nanoseconds",
					role: "secondary",
					raw: true,
				},
				{
					id: "peak-memory-bytes",
					sourceField: "peakMemoryBytes",
					direction: "minimize",
					unit: "bytes",
					role: "secondary",
					raw: true,
				},
				{
					id: "fast-at-one",
					sourceField: "fastAtOne",
					direction: "maximize",
					unit: "fraction",
					role: "primary",
					raw: false,
				},
			],
			hardeningEpoch: {
				id: "kbv-2026-08-27-3fdf6fec",
				frozenAt: "2026-08-27T00:00:00.000Z",
				verifierCommit: "3fdf6fec7372a4d0cb682635f00e7bdcbc55d50e",
				crossEpochAggregation: "forbidden",
				baseline: "pytorch-fp32-tf32-enabled",
				regenerateBaselineOnCampaignHardware: true,
				hiddenInputTransforms: [1, 3, 0.01, -1],
				fp32Tolerance: 0.001,
				timingWarmups: 3,
				pilotTimingTrials: 10,
				confirmationTimingTrials: 100,
				nearParityConfirmationBlocks: 5,
				candidateFrozenBeforeSubmission: true,
			},
			queuePolicy: {
				maxInFlightPerArm: 4,
				pairedRandomizedBlocks: true,
				releaseFeedbackAfterPairedCompletion: true,
				allocationDecisionsAtFixedCheckpoints: true,
				arrivalOrderMayChangeBudget: false,
			},
			budgets: [
				{
					stage: "smoke",
					searchTaskSet: "one-dev-task-per-level",
					verificationTaskSet: "one-dev-task-per-level",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(6, 48000, 1800, 7200),
				},
				{
					stage: "screen",
					searchTaskSet: "kernelbench-dev",
					verificationTaskSet: "kernelbench-dev-hidden-inputs",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(48, 160000, 7200, 28800),
				},
				{
					stage: "confirm",
					searchTaskSet: "kernelbench-holdout-problems",
					verificationTaskSet: "kernelbench-holdout-hidden-inputs",
					trajectoriesPerArm: 2,
					limitsPerTrajectory: budget(72, 300000, 21600, 86400),
				},
			],
		},
		nanoGpt: {
			lane: "nanogpt",
			hardware: "4xL40S-FarmShare",
			baselineTrainSteps: 3290,
			humanRecordTrainSteps: 2600,
			gate: {
				trialSeeds: nanoGptTrialSeeds,
				wideningSchedule: [1, 2, 4, 8],
				requiredTrialCount: 8,
				meanValidationLossExclusiveUpperBound: 3.27859,
				targetValidationLoss: 3.28,
				recordRequiresStrictlyFewerSteps: true,
				nonCherryPickedExactConfig: true,
				partialCurveEarlyStopping: false,
			},
			metrics: [
				{
					id: "train-steps",
					sourceField: "trainSteps",
					direction: "minimize",
					unit: "optimizer-steps",
					role: "primary",
					raw: true,
				},
				{
					id: "mean-validation-loss",
					sourceField: "meanValidationLoss",
					direction: "minimize",
					unit: "cross-entropy",
					role: "gate",
					raw: true,
				},
				{
					id: "peak-vram-mb",
					sourceField: "peakVramMb",
					direction: "minimize",
					unit: "megabytes",
					role: "secondary",
					raw: true,
				},
			],
			budgets: [
				{
					stage: "smoke",
					searchTaskSet: "nanogpt-baseline",
					verificationTaskSet: "one-fixed-seed",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(1, 32000, 7200, 10800),
				},
				{
					stage: "screen",
					searchTaskSet: "nanogpt-speedrun",
					verificationTaskSet: "progressive-1-2-4-seed-screen",
					trajectoriesPerArm: 1,
					limitsPerTrajectory: budget(32, 250000, 21600, 28800),
				},
				{
					stage: "confirm",
					searchTaskSet: "nanogpt-speedrun",
					verificationTaskSet: "official-eight-seed-gate",
					trajectoriesPerArm: 3,
					limitsPerTrajectory: budget(128, 1000000, 86400, 108000),
				},
			],
			primaryHarnessReplication: {
				trajectoriesPerArm: 3,
				activeSecondsPerTrajectory: 21600,
				showcaseExtensionSeconds: 86400,
				showcaseInference: "descriptive-only",
			},
		},
	},
	arms: [
		{
			id: "control",
			kind: "baseline",
			enabledInitially: true,
			prerequisites: [],
			incrementalAgainst: [],
			features: {
				measuredEvidence: "none",
				retainEvidenceAcrossCompaction: false,
				retainConditionalFailures: false,
				isolatedTrajectoryCount: 1,
				resourceSharePerTrajectory: 1,
				equalAggregateResources: true,
				retestQueue: false,
				resurrectionQueue: false,
				componentReablationQueue: false,
				measuredSummarySharing: "none",
			},
		},
		{
			id: "M",
			kind: "treatment",
			enabledInitially: true,
			prerequisites: [],
			incrementalAgainst: ["control"],
			features: {
				measuredEvidence: "typed-branch-local",
				retainEvidenceAcrossCompaction: true,
				retainConditionalFailures: true,
				isolatedTrajectoryCount: 1,
				resourceSharePerTrajectory: 1,
				equalAggregateResources: true,
				retestQueue: false,
				resurrectionQueue: false,
				componentReablationQueue: false,
				measuredSummarySharing: "none",
			},
		},
		{
			id: "W",
			kind: "treatment",
			enabledInitially: true,
			prerequisites: [],
			incrementalAgainst: ["control"],
			features: {
				measuredEvidence: "none",
				retainEvidenceAcrossCompaction: false,
				retainConditionalFailures: false,
				isolatedTrajectoryCount: 2,
				resourceSharePerTrajectory: 0.5,
				equalAggregateResources: true,
				retestQueue: false,
				resurrectionQueue: false,
				componentReablationQueue: false,
				measuredSummarySharing: "none",
			},
		},
		{
			id: "R",
			kind: "treatment",
			enabledInitially: true,
			prerequisites: [],
			incrementalAgainst: ["control"],
			features: {
				measuredEvidence: "none",
				retainEvidenceAcrossCompaction: false,
				retainConditionalFailures: false,
				isolatedTrajectoryCount: 1,
				resourceSharePerTrajectory: 1,
				equalAggregateResources: true,
				retestQueue: true,
				resurrectionQueue: true,
				componentReablationQueue: true,
				measuredSummarySharing: "none",
			},
		},
		{
			id: "S",
			kind: "treatment",
			enabledInitially: false,
			prerequisites: ["M", "W"],
			incrementalAgainst: ["M", "W"],
			features: {
				measuredEvidence: "typed-branch-local",
				retainEvidenceAcrossCompaction: true,
				retainConditionalFailures: true,
				isolatedTrajectoryCount: 2,
				resourceSharePerTrajectory: 0.5,
				equalAggregateResources: true,
				retestQueue: false,
				resurrectionQueue: false,
				componentReablationQueue: false,
				measuredSummarySharing: "sparse",
			},
		},
	],
	combinationPolicy: {
		enabledDuringSingleArmScreen: false,
		requireEachFactorToPromoteAlone: true,
		maximumFactorialExperiments: 1,
		maximumFactors: 2,
		design: "2x2",
	},
	deferredCapabilities: ["literature-retrieval"],
	decisions: {
		minimumPracticalEffect: {
			frozenBeforeTreatments: true,
			rule: "max(practical-floor,2*baseline-noise-scale)",
		},
		promotion: {
			earliestBudgetFraction: 0.5,
			provisionalProbabilityAtOrAboveMinimumEffect: 0.9,
			confirmationIntervalLevel: 0.95,
			confirmationLowerBoundMustExceedZero: true,
			maximumArmsPromotedPerStage: 2,
			integrityViolationsAllowed: 0,
			kernelBenchRequiresHiddenFastAtOneNonInferiority: true,
			kernelBenchRequiresPositivePairedLogSpeedup: true,
			nanoGptRequiresOfficialEightSeedGate: true,
		},
		futility: {
			hardFailuresOnlyBeforeBudgetFraction: 0.5,
			oneSidedUpperIntervalLevel: 0.9,
			stopWhenUpperBoundBelowMinimumEffect: true,
			inconclusiveIsFailure: false,
			nanoGptMayUsePartialLossCurve: false,
		},
	},
	reporting: {
		crossBenchmarkAggregateScore: false,
		compareBenchmarkLocalPairedEffects: true,
		frontierAxes: resourceAxes.map((axis) => axis.id),
		queueWaitReportedSeparately: true,
	},
} as const satisfies CampaignConfig);

export function getStageBudget(lane: BenchmarkLane, stage: CampaignStage): StageBudget {
	const laneConfig =
		lane === "compiler-gym"
			? FROZEN_CAMPAIGN.lanes.compilerGym
			: lane === "kernelbench"
				? FROZEN_CAMPAIGN.lanes.kernelBench
				: FROZEN_CAMPAIGN.lanes.nanoGpt;
	const stageBudget = laneConfig.budgets.find((candidate) => candidate.stage === stage);
	if (!stageBudget) {
		throw new Error(`No ${stage} budget configured for ${lane}`);
	}
	return stageBudget;
}
