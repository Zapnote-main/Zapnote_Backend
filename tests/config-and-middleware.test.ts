import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CacheKeys,
  cache,
  parseCached,
} from '../src/config/redis.js';
import { JobType, getQueueDriver, getWorkerBaseUrl, jobUrl } from '../src/config/qstash.js';
import { rateLimit } from '../src/middleware/ratelimit.middleware.js';
import { verifyQStashSignature } from '../src/middleware/qstash.middleware.js';

type EnvValue = string | undefined;

async function withEnvironment(
  values: Record<string, EnvValue>,
  run: () => void | Promise<void>,
) {
  const original = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('worker URL is normalized and used to build the job endpoint', { concurrency: false }, async () => {
  await withEnvironment(
    { WORKER_BASE_URL: 'https://worker.example.com///', QSTASH_TOKEN: 'token', QUEUE_DRIVER: undefined },
    () => {
      assert.equal(getWorkerBaseUrl(), 'https://worker.example.com');
      assert.equal(
        jobUrl(JobType.PROCESS_KNOWLEDGE_ITEM),
        'https://worker.example.com/api/v1/jobs/process-knowledge-item',
      );
      assert.equal(getQueueDriver(), 'qstash');
    },
  );
});

test('local, malformed, and non-HTTP worker URLs use the inline queue', { concurrency: false }, async () => {
  for (const workerUrl of ['http://localhost:3000', 'http://127.0.0.1:3000', 'ftp://worker.example.com', 'not a url']) {
    await withEnvironment(
      { WORKER_BASE_URL: workerUrl, QSTASH_TOKEN: 'token', QUEUE_DRIVER: undefined },
      () => {
        assert.equal(getWorkerBaseUrl(), '');
        assert.equal(jobUrl(JobType.PROCESS_KNOWLEDGE_ITEM), '');
        assert.equal(getQueueDriver(), 'inline');
      },
    );
  }
});

test('a forced QStash driver still fails safely when required configuration is absent', { concurrency: false }, async () => {
  await withEnvironment(
    { WORKER_BASE_URL: undefined, QSTASH_TOKEN: undefined, QUEUE_DRIVER: 'qstash' },
    () => assert.equal(getQueueDriver(), 'inline'),
  );
});

test('unsigned job delivery is rejected in production when signing keys are absent', { concurrency: false }, async () => {
  await withEnvironment(
    {
      NODE_ENV: 'production',
      QSTASH_CURRENT_SIGNING_KEY: undefined,
      QSTASH_NEXT_SIGNING_KEY: undefined,
    },
    async () => {
      let statusCode: number | undefined;
      let payload: unknown;
      let nextCalled = false;
      const response = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: unknown) {
          payload = body;
          return this;
        },
      };

      await verifyQStashSignature({ headers: {} } as any, response as any, () => { nextCalled = true; });

      assert.equal(statusCode, 500);
      assert.deepEqual(payload, { error: 'Worker not configured' });
      assert.equal(nextCalled, false);
    },
  );
});

test('unsigned job delivery is permitted only outside production when no keys are configured', { concurrency: false }, async () => {
  await withEnvironment(
    {
      NODE_ENV: 'test',
      QSTASH_CURRENT_SIGNING_KEY: undefined,
      QSTASH_NEXT_SIGNING_KEY: undefined,
    },
    async () => {
      let nextCalled = false;
      await verifyQStashSignature({ headers: {} } as any, {} as any, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
    },
  );
});

test('cache keys separate knowledge-list variants while sharing an invalidation version', () => {
  assert.equal(CacheKeys.workspaceItemsVersion('workspace-1'), 'workspace:workspace-1:items:v');
  assert.notEqual(
    CacheKeys.workspaceItems('workspace-1', 3, '1:20::'),
    CacheKeys.workspaceItems('workspace-1', 3, '2:20::'),
  );
  assert.notEqual(
    CacheKeys.workspaceItems('workspace-1', 3, '1:20::'),
    CacheKeys.workspaceItems('workspace-1', 4, '1:20::'),
  );
});

test('cache helpers turn Redis failures into safe misses and no-op writes', async () => {
  const fetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () => { throw new Error('unavailable'); }) as typeof fetch;

    assert.equal(await cache.get('key'), null);
    assert.equal(await cache.version('version-key'), 0);
    await cache.set('key', { value: true }, 60);
    await cache.del('key');
    await cache.bump('version-key');
  } finally {
    globalThis.fetch = fetch;
  }
});

test('cache version accepts numeric Redis values and cached JSON is decoded once', async () => {
  const get = cache.get;
  try {
    cache.get = (async () => '7') as typeof cache.get;
    assert.equal(await cache.version('version-key'), 7);
    assert.deepEqual(parseCached<{ id: string }>('{"id":"item-1"}'), { id: 'item-1' });
    assert.deepEqual(parseCached({ id: 'item-2' }), { id: 'item-2' });
  } finally {
    cache.get = get;
  }
});

test('rate limiting fails open when Redis is unavailable', async () => {
  const fetch = globalThis.fetch;
  const nextCalls: unknown[] = [];
  const middleware = rateLimit('write', 2);

  try {
    globalThis.fetch = (async () => { throw new Error('unavailable'); }) as typeof fetch;
    await middleware(
      { userId: 'user-1' } as any,
      { setHeader: () => undefined } as any,
      (error?: unknown) => nextCalls.push(error),
    );
    assert.deepEqual(nextCalls, [undefined]);
  } finally {
    globalThis.fetch = fetch;
  }
});
