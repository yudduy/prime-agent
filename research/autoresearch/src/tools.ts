import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ResearchController } from "./controller.js";
import type { BenchmarkLane, BudgetClass, ProposalDetails } from "./types.js";

const LaneSchema = Type.Union([Type.Literal("compiler-gym"), Type.Literal("kernelbench"), Type.Literal("nanogpt")]);
const BudgetClassSchema = Type.Union([Type.Literal("smoke"), Type.Literal("screen"), Type.Literal("confirm")]);
const JobStatusSchema = Type.Union([
	Type.Literal("accepted"),
	Type.Literal("queued"),
	Type.Literal("running"),
	Type.Literal("succeeded"),
	Type.Literal("invalid"),
	Type.Literal("failed"),
	Type.Literal("cancelled"),
]);
const CandidateSchema = Type.Object({
	format: Type.Union([
		Type.Literal("llvm-pass-sequence"),
		Type.Literal("python-source"),
		Type.Literal("unified-diff"),
	]),
	content: Type.String({ minLength: 1, maxLength: 1_048_576 }),
});
const ProposalFields = {
	hypothesis: Type.String({ minLength: 1 }),
	mechanism: Type.String({ minLength: 1 }),
	predictedOutcome: Type.String({ minLength: 1 }),
	boundaryConditions: Type.Array(Type.String()),
};
const ProposalSchema = Type.Object({
	...ProposalFields,
	parentJobIds: Type.Optional(Type.Array(Type.String())),
});
const ServerBoundProposalSchema = Type.Object(ProposalFields);

const SubmitSchema = Type.Object({
	lane: LaneSchema,
	benchmarkIds: Type.Array(Type.String(), { minItems: 1, maxItems: 250 }),
	budgetClass: BudgetClassSchema,
	treatment: Type.String({ minLength: 1, maxLength: 128 }),
	proposal: ProposalSchema,
	candidate: CandidateSchema,
});

const ScopedSubmitSchema = Type.Object({
	proposal: ProposalSchema,
	candidate: CandidateSchema,
});
const ServerBoundScopedSubmitSchema = Type.Object({
	proposal: ServerBoundProposalSchema,
	candidate: CandidateSchema,
});

const StatusSchema = Type.Object({
	jobIds: Type.Array(Type.String(), { minItems: 1, maxItems: 100 }),
});

const RecallSchema = Type.Object({
	lane: Type.Optional(LaneSchema),
	treatment: Type.Optional(Type.String()),
	statuses: Type.Optional(Type.Array(JobStatusSchema)),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});

const CompareSchema = Type.Object({
	lane: LaneSchema,
	leftTreatment: Type.String({ minLength: 1 }),
	rightTreatment: Type.String({ minLength: 1 }),
	verifierEpoch: Type.Optional(Type.String({ minLength: 1 })),
	compatibilityDigest: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
});

export interface ResearchToolOptions {
	enableRecall?: boolean;
	enableCompare?: boolean;
	includeRecallCandidateContent?: boolean;
	submitScope?: {
		lane: BenchmarkLane;
		benchmarkIds: readonly string[];
		budgetClass: BudgetClass;
		treatment: string;
		bindParentToLatest?: boolean;
	};
}

function asToolResult(value: unknown): { content: Array<{ type: "text"; text: string }>; details: unknown } {
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		details: value,
	};
}

function normalizeProposal(
	controller: ResearchController,
	branchId: string,
	proposal: {
		hypothesis: string;
		mechanism: string;
		predictedOutcome: string;
		boundaryConditions: string[];
		parentJobIds?: string[];
	},
): ProposalDetails {
	if (proposal.parentJobIds !== undefined) return { ...proposal, parentJobIds: proposal.parentJobIds };
	if (controller.statusForBranch(branchId).length > 0) {
		throw new Error("proposal.parentJobIds is required after the branch has an accepted proposal");
	}
	return { ...proposal, parentJobIds: [] };
}

function bindProposalToLatestParent(
	controller: ResearchController,
	branchId: string,
	proposal: Omit<ProposalDetails, "parentJobIds">,
): ProposalDetails {
	const latest = controller.statusForBranch(branchId).at(-1);
	return { ...proposal, parentJobIds: latest ? [latest.proposal.jobId] : [] };
}

export function createResearchTools(
	controller: ResearchController,
	options: ResearchToolOptions = {},
): ToolDefinition[] {
	const submitScope = options.submitScope;
	const commonSubmitDefinition = {
		name: "autoresearch_submit",
		label: "Submit Experiment",
		description:
			"Submit one immutable benchmark candidate. Returns immediately with an idempotent job ID and manifest digest.",
		promptSnippet:
			"autoresearch_submit: submit one measured hypothesis and immutable candidate to the evaluator queue.",
		promptGuidelines: [
			"Submit one mechanistic change at a time and state a falsifiable predicted outcome.",
			"Do not resubmit an unchanged candidate; identical manifests resolve to the same job.",
			...(submitScope?.bindParentToLatest
				? ["Candidate lineage is server-bound to the latest branch job; do not supply parent job IDs."]
				: [
						"Omitting proposal.parentJobIds creates an independent root proposal; include parent job IDs for derivative candidates.",
					]),
		],
		executionMode: "sequential" as const,
	};
	const submit: ToolDefinition = submitScope?.bindParentToLatest
		? defineTool({
				...commonSubmitDefinition,
				parameters: ServerBoundScopedSubmitSchema,
				execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
					const branchId = ctx.sessionManager.getSessionId();
					return asToolResult(
						await controller.submit({
							branchId,
							lane: submitScope.lane,
							benchmarkIds: [...submitScope.benchmarkIds],
							budgetClass: submitScope.budgetClass,
							treatment: submitScope.treatment,
							proposal: bindProposalToLatestParent(controller, branchId, params.proposal),
							candidate: params.candidate,
						}),
					);
				},
			})
		: submitScope
			? defineTool({
					...commonSubmitDefinition,
					parameters: ScopedSubmitSchema,
					execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
						const branchId = ctx.sessionManager.getSessionId();
						return asToolResult(
							await controller.submit({
								branchId,
								lane: submitScope.lane,
								benchmarkIds: [...submitScope.benchmarkIds],
								budgetClass: submitScope.budgetClass,
								treatment: submitScope.treatment,
								proposal: normalizeProposal(controller, branchId, params.proposal),
								candidate: params.candidate,
							}),
						);
					},
				})
			: defineTool({
					...commonSubmitDefinition,
					parameters: SubmitSchema,
					execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
						const branchId = ctx.sessionManager.getSessionId();
						return asToolResult(
							await controller.submit({
								...params,
								proposal: normalizeProposal(controller, branchId, params.proposal),
								branchId,
							}),
						);
					},
				});

	const status = defineTool({
		name: "autoresearch_status",
		label: "Experiment Status",
		description: "Read authoritative status and measured results for submitted experiment jobs.",
		promptSnippet: "autoresearch_status: inspect queued, running, invalid, failed, or measured jobs.",
		executionMode: "parallel",
		parameters: StatusSchema,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
			asToolResult({
				jobs: controller.statusForBranch(ctx.sessionManager.getSessionId(), params.jobIds),
				budget: controller.budgetStatus(ctx.sessionManager.getSessionId()),
			}),
	});

	const tools: ToolDefinition[] = [submit, status];
	if (options.enableRecall ?? true) {
		tools.push(
			defineTool({
				name: "autoresearch_recall",
				label: "Recall Evidence",
				description:
					"Recall branch-local measured evidence, including rejected, failed, and conditional outcomes, from the external ledger.",
				promptSnippet: "autoresearch_recall: recover measured branch evidence after long turns or compaction.",
				executionMode: "parallel",
				parameters: RecallSchema,
				execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
					asToolResult(
						options.includeRecallCandidateContent
							? await controller.recallWithCandidateContent(ctx.sessionManager.getSessionId(), params)
							: controller.recall(ctx.sessionManager.getSessionId(), params),
					),
			}),
		);
	}
	if (options.enableCompare ?? true) {
		tools.push(
			defineTool({
				name: "autoresearch_compare",
				label: "Compare Treatments",
				description:
					"Compare the best whole candidate from each treatment on an identical verified task set and compatible execution evidence using the lane's preregistered primary metric and direction.",
				promptSnippet: "autoresearch_compare: inspect deployable candidate-level paired treatment evidence.",
				executionMode: "parallel",
				parameters: CompareSchema,
				execute: async (_toolCallId, params, _signal, _onUpdate, ctx) =>
					asToolResult(
						controller.compare(
							ctx.sessionManager.getSessionId(),
							params.lane,
							params.leftTreatment,
							params.rightTreatment,
							params.verifierEpoch,
							params.compatibilityDigest,
						),
					),
			}),
		);
	}
	return tools;
}
