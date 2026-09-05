import { FROZEN_CAMPAIGN } from "./campaign.js";
import type { StockCpuEvaluationRequest } from "./stock-cpu-protocol.js";
import type { BranchBudgetStatus, JobView, SubmitResult } from "./types.js";

export interface StockCpuEvaluationEnvelope {
	type: "stock_prime_compiler_gym_evaluation";
	campaignId: typeof FROZEN_CAMPAIGN.id;
	request: StockCpuEvaluationRequest;
	submitted: SubmitResult;
	job: JobView;
	budget: BranchBudgetStatus;
}

export function buildStockCpuEvaluationEnvelope(input: {
	request: StockCpuEvaluationRequest;
	submitted: SubmitResult;
	job: JobView;
	budget: BranchBudgetStatus;
}): StockCpuEvaluationEnvelope {
	return {
		type: "stock_prime_compiler_gym_evaluation",
		campaignId: FROZEN_CAMPAIGN.id,
		request: structuredClone(input.request),
		submitted: structuredClone(input.submitted),
		job: structuredClone(input.job),
		budget: structuredClone(input.budget),
	};
}
