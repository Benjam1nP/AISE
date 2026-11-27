/**
 * Rules for the generated tests, shared by the test worker and the test agent (section 6 of the P5
 * spec). The naming contract is what coverage and traceability read back from the Vitest results.
 */
export const TEST_RULES = `Test rules:
- Tests are Vitest. Import what you use explicitly from 'vitest', for example import { describe, expect, it } from 'vitest'. ESM, and every import of a project file ends in .js, for example import { Task } from '../src/tasks/Task.js'. Use the import lines the brief gives. Import no npm package except vitest and supertest, and Node built ins with the node: prefix.
- Naming contract. The IDs in the titles are how the environment reads coverage back, so copy them exactly:
  - One file per plan entry, with one top level describe('UC-001 <name>', ...) that carries the plan ID and name as the brief states them.
  - The brief gives each title as a string literal. Copy that literal exactly, quotes and escapes included.
  - One test per acceptance criterion, titled it('REQ-003 AC1: <criterion text>', ...). ACn is the position of the criterion in its requirement, starting at 1, and the text is the criterion text as given, unchanged.
  - One test per sequence, titled it('SEQ-002 scenario: <name>', ...) with the sequence name. It follows the messages of the sequence in order.
  - A criterion that has no practical automated test, for example a performance or usability goal, becomes it.todo('REQ-007 AC2: manual: <reason>') with a short reason. Use it only then; a criterion that can be tested gets a real test.
  - Titles are string literals on one line, no template strings. Never name a test for a criterion or sequence the brief does not list.
- HTTP goes through supertest on createApp(): import request from 'supertest' and call request(createApp()) in every test, so each test gets a fresh app with its own :memory: database by default. Pass your own database only in a test that needs the database itself: create it inside that test with new DatabaseSync(':memory:') from import { DatabaseSync } from 'node:sqlite', and pass it to createApp(db). Create new class instances in every test and share nothing between tests. Tests are async and await every request. Never call listen, never open a port, never use the network or fetch. createApp takes a database only when its declaration shows the parameter; call it as the declaration says.
- Wiring contract of the generated app. Routes are registered with the full path the brief lists; use that path as it is. Route parameters that are in the path are ids, for example /api/tasks/:id. Every other parameter of the class method is read from the JSON body field with the same name as the method parameter, so send them with .send({ ... }) and name the fields like the method parameters. A handler sends the result of the class method as JSON: status 201 for a create, 200 otherwise. A thrown error whose message ends with not found answers 404 and every other thrown error answers 400, both with the body { "error": message }. GET /health answers 200 with { "status": "ok" }.
- When you are unsure about the HTTP shape of a criterion (which route, which parameters, which body), test the criterion through the class instead, with the imports and signatures from the brief.
- Classes are imported from the paths in the brief and used with their declared constructors and methods. Use the signatures exactly. Do not guess members that are not listed.
- One assertion focus per test: a test checks the one behaviour its criterion names. Put shared setup in a helper function inside the file.
- Expected values come from the criterion, the requirement and the design, never from guessing the implementation and never from what the code returns today. A test states what must be true.
- Error cases check the status code, 404 when something does not exist and 400 for every other rejected input, and the body { error } when the criterion asks for a message. Through the class, an error case expects the thrown Error.
- Tests must be deterministic: no sleeping, no real time, no random values in assertions, no order dependence between tests.`;
