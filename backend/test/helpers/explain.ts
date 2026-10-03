import { expect } from 'vitest';

/**
 * Quality bar B1: assert a query is served by an index.
 * Pass an un-executed Mongoose query (e.g. `Model.find(q).sort(s)`).
 */
export async function expectIndexed(query: { explain(verbosity?: string): Promise<unknown> }, index?: string) {
  const plan = JSON.stringify(await query.explain('queryPlanner'));
  expect(plan, 'query must not scan the whole collection').not.toContain('COLLSCAN');
  expect(plan, 'query must use an index').toContain('IXSCAN');
  if (index) expect(plan).toContain(`"indexName":"${index}"`);
}
