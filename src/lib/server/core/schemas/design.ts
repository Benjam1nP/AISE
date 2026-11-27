import { z } from 'zod';
import { ID_PATTERNS } from '../ids';

const reqId = z.string().regex(ID_PATTERNS.REQ);
const dsnId = z.string().regex(ID_PATTERNS.DSN);
const reqIds = z
	.array(reqId)
	.describe('IDs of the requirements this element realises, e.g. ["REQ-001"]');
const name = z.string().min(1);
/** Member names and enum values become code identifiers in P4. */
const identifier = z
	.string()
	.regex(/^[A-Za-z_$][\w$]*$/, 'must be a code identifier (letters, digits, _ or $)')
	.describe('Code identifier, e.g. "createdAt"');
const typed = z.strictObject({
	name: identifier,
	type: z.string().min(1).describe('TypeScript type')
});

export const Actor = z.strictObject({
	id: z.string().regex(ID_PATTERNS.ACT).describe('e.g. "ACT-001"'),
	name,
	description: z.string()
});
export type Actor = z.infer<typeof Actor>;

export const UseCase = z.strictObject({
	id: z.string().regex(ID_PATTERNS.UC).describe('e.g. "UC-001"'),
	name,
	description: z.string(),
	actorIds: z.array(z.string().regex(ID_PATTERNS.ACT)).describe('Actors taking part'),
	reqIds
});
export type UseCase = z.infer<typeof UseCase>;

export const Relation = z.strictObject({
	kind: z.enum(['association', 'composition', 'inheritance', 'dependency']),
	targetId: dsnId.describe('ID of the related class'),
	multiplicity: z.string().optional().describe('e.g. "1", "0..*"'),
	label: z.string().optional()
});
export type Relation = z.infer<typeof Relation>;

export const Method = z.strictObject({
	name: identifier,
	params: z.array(typed),
	returnType: z.string().min(1).describe('TypeScript type, "void" if none')
});
export type Method = z.infer<typeof Method>;

export const DesignClass = z.strictObject({
	id: dsnId.describe('e.g. "DSN-001"; classes, components and nodes share one sequence'),
	name: z
		.string()
		.regex(/^[A-Z][A-Za-z0-9]*$/)
		.describe('PascalCase identifier, used as the code name'),
	kind: z.enum(['class', 'interface', 'enum']),
	description: z.string(),
	attributes: z.array(typed),
	methods: z.array(Method),
	values: z.array(identifier).default([]).describe('Enum literals; only for kind "enum"'),
	relations: z.array(Relation),
	reqIds
});
export type DesignClass = z.infer<typeof DesignClass>;

export const Component = z.strictObject({
	id: dsnId.describe('e.g. "DSN-010"'),
	name,
	classIds: z.array(dsnId).describe('Classes this component contains'),
	nodeId: dsnId.describe('Deployment node this component runs on'),
	reqIds
});
export type Component = z.infer<typeof Component>;

export const DeploymentNode = z.strictObject({
	id: dsnId.describe('e.g. "DSN-020"'),
	name,
	kind: z
		.enum(['service', 'database', 'client', 'external'])
		.describe('service runs our code, client is the browser, external is a system we call'),
	reqIds
});
export type DeploymentNode = z.infer<typeof DeploymentNode>;

export const NodeLink = z.strictObject({
	from: dsnId.describe('Node that opens the connection, e.g. the browser'),
	to: dsnId.describe('Node it connects to'),
	protocol: z.enum(['http', 'https', 'ws', 'wss', 'sql']).describe('sql only for a database node'),
	label: z.string().optional()
});
export type NodeLink = z.infer<typeof NodeLink>;

export const Message = z.strictObject({
	fromId: z
		.string()
		.regex(/^(ACT|DSN)-\d{3}$/)
		.describe('Sender: an actor or a class'),
	toId: dsnId.describe('Receiving class'),
	method: z.string().min(1).describe('Method called on the receiver'),
	label: z.string().optional()
});
export type Message = z.infer<typeof Message>;

export const Sequence = z.strictObject({
	id: z.string().regex(ID_PATTERNS.SEQ).describe('e.g. "SEQ-001"'),
	name,
	useCaseId: z.string().regex(ID_PATTERNS.UC).describe('Use case this sequence realises'),
	messages: z.array(Message).describe('Calls in order')
});
export type Sequence = z.infer<typeof Sequence>;

export const DesignDoc = z.strictObject({
	actors: z.array(Actor),
	useCases: z.array(UseCase),
	classes: z.array(DesignClass),
	components: z.array(Component),
	nodes: z.array(DeploymentNode),
	links: z.array(NodeLink).default([]).describe('Connections between deployment nodes'),
	sequences: z.array(Sequence)
});
export type DesignDoc = z.infer<typeof DesignDoc>;
