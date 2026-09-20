import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchJobQueue } from '../apps/search/backend/jobs.js';
import { validateSearchInput } from '../apps/search/backend/routes.js';

async function until(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
test('queue accepts, completes, and returns a result without exposing pending input', async () => {
  const queue = new SearchJobQueue({ run: async (input) => ({ found: input.username }), maxPending: 2 });
  const started = queue.submit({ username: 'example' });
  assert.match(started.id, /^[0-9a-f-]{36}$/);
  assert.equal(started.status, 'queued');
  await until(() => queue.get(started.id)?.status === 'complete');
  assert.deepEqual(queue.get(started.id).result, { found: 'example' });
  assert.equal(queue.jobs.get(started.id).input, null);
  queue.close();
});
test('queue bounds work and captures failures without exposing exception text', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = new SearchJobQueue({ maxPending: 1, run: async () => { await gate; throw Error('private details'); } });
  const a = queue.submit({ name: 'one' });
  await until(() => queue.active);
  assert.equal(queue.submit({ name: 'two' }), null);
  release();
  await until(() => queue.get(a.id)?.status === 'error');
  assert.deepEqual(queue.get(a.id).error, 'SEARCH_JOB_FAILED');
  assert.equal(JSON.stringify(queue.get(a.id)).includes('private details'), false);
  queue.close();
});
test('search input is allowlisted, size-limited and non-empty', () => {
  assert.deepEqual(validateSearchInput({ username: '  abc ', secret: 'do not forward' }), { username: 'abc' });
  assert.equal(validateSearchInput({}), null);
  assert.equal(validateSearchInput({ username: 'x'.repeat(501) }), null);
  assert.equal(validateSearchInput({ username: {} }), null);
});
