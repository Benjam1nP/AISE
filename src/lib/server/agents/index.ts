import { codeAgent } from './code';
import { deployAgent } from './deploy';
import { designAgent } from './design';
import { maintenanceAgent } from './maintenance';
import { requirementsAgent } from './requirements';
import { testAgent } from './test';
import type { AgentDef } from './types';

export { codeAgent, deployAgent, designAgent, maintenanceAgent, requirementsAgent, testAgent };
export { deployBrief, deployUpdateBrief } from './deploy';
export {
	closeBrief,
	driftDescription,
	entryBrief,
	ticketMessage,
	ticketTriageBrief
} from './maintenance';
export { dbFile, updateBrief, wiringBrief } from './code';
export { workerBrief, workerDef } from './code-worker';
export { STACK_RULES } from './stack-rules';
export { fixBrief, fixLoopBrief, testUpdateBrief, triageBrief, type FixItem } from './test';
export { TEST_RULES } from './test-rules';
export { testWorkerBrief, testWorkerDef } from './test-worker';
export { summariseRun } from './summary';

export const AGENTS: Record<
	'requirements' | 'design' | 'code' | 'test' | 'deploy' | 'maintenance',
	AgentDef
> = {
	requirements: requirementsAgent,
	design: designAgent,
	code: codeAgent,
	test: testAgent,
	deploy: deployAgent,
	maintenance: maintenanceAgent
};
