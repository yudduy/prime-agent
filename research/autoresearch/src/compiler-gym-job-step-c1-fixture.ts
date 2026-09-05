export const COMPILER_GYM_JOB_STEP_C1_FIXTURE = {
	candidateId: "C1",
	request: {
		actions: ["-mem2reg", "-sroa", "-instcombine", "-simplifycfg", "-adce", "-dce", "-dse"],
		hypothesis:
			"Promoting stack variables and then combining, simplifying, and deleting dead code should remove redundant IR in both programs.",
		mechanism:
			"SSA promotion exposes constants, then local combination, CFG simplification, and dead-code passes remove the exposed instructions.",
		predictedOutcome: "Both fixed tasks remain verifier-valid and improve substantially over the empty sequence.",
		boundaryConditions: ["Fixed cBench task pair", "LLVM 10 pass space", "Raw IR count is primary"],
	},
	requestSha256: "d74ca70f5b13fd221acdb3df7204978f6926a85f881e9b1d54b591fb637e15a4",
	actionsSha256: "4c4245e3ebb41e26cc3b4e24c711f2ab0c56a7bf7ecd96ce116c80779210228f",
	tasks: [
		{
			benchmarkId: "benchmark://cbench-v1/blowfish",
			irInstructionCount: 2075,
			objectTextSizeBytes: 11_639,
		},
		{
			benchmarkId: "benchmark://cbench-v1/bzip2",
			irInstructionCount: 16_406,
			objectTextSizeBytes: 159_685,
		},
	],
} as const;

export const COMPILER_GYM_JOB_STEP_C1_TASKS = [
	COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[0].benchmarkId,
	COMPILER_GYM_JOB_STEP_C1_FIXTURE.tasks[1].benchmarkId,
] as const;
