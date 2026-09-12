import assert from 'node:assert/strict';
import test from 'node:test';

import { processKnowledgeItemJob } from '../src/modules/jobs/jobs.controller.js';

test('malformed QStash knowledge jobs are acknowledged without retrying', async () => {
  let statusCode: number | undefined;
  let payload: unknown;
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

  await processKnowledgeItemJob({ body: {} } as any, response as any);

  assert.equal(statusCode, 200);
  assert.deepEqual(payload, {
    success: false,
    message: 'Invalid payload, dropped',
  });
});
