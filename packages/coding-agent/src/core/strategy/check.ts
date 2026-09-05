import { Check } from "typebox/value";
import { errorText } from "./session.js";
import { type TaskCheck, type TaskContext, type TaskDefinition, taskCheckSchema, type WorkResult } from "./types.js";

export async function checkResult(
	check: NonNullable<TaskDefinition["checkResult"]>,
	work: WorkResult,
	context: TaskContext,
	timeoutMs: number,
): Promise<TaskCheck> {
	if (context.signal.aborted || timeoutMs <= 0) {
		return { status: "error", summary: "The result check could not start within the run limits.", details: "" };
	}
	const controller = new AbortController();
	const cancel = () => controller.abort();
	context.signal.addEventListener("abort", cancel, { once: true });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		cancel();
	}, timeoutMs);
	let checked: TaskCheck;
	try {
		const result = await check(structuredClone(work), { ...context, signal: controller.signal });
		if (!Check(taskCheckSchema, result)) throw new Error("The task checker returned an invalid result.");
		checked = structuredClone(result);
	} catch (error) {
		checked = { status: "error", summary: "The task result check failed to execute.", details: errorText(error) };
	} finally {
		clearTimeout(timer);
		context.signal.removeEventListener("abort", cancel);
	}
	if (controller.signal.aborted) {
		return {
			status: "error",
			summary: timedOut
				? "The task result check exceeded the work-step time limit."
				: "The task result check was cancelled.",
			details: "",
		};
	}
	return checked;
}
