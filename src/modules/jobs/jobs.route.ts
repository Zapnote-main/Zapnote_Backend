import express from 'express';
import { verifyQStashSignature } from '../../middleware/qstash.middleware.js';
import * as jobsController from './jobs.controller.js';

const router = express.Router();

// Called by QStash, not by the frontend, so these routes are authenticated by
// the Upstash signature rather than a Firebase token.
router.post(
  '/process-knowledge-item',
  verifyQStashSignature,
  jobsController.processKnowledgeItemJob
);

export default router;
