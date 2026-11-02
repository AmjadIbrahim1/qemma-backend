// backend/src/modules/schedule/schedule.routes.js

import express            from 'express';
import scheduleController from './schedule.controller.js';
import { authMiddleware } from '../auth/auth.middleware.js';

const router = express.Router();
router.use(authMiddleware);

router.post('/',            (req, res) => scheduleController.create(req, res));
router.get('/',             (req, res) => scheduleController.getAll(req, res));
router.get('/upcoming',     (req, res) => scheduleController.getUpcoming(req, res));
router.put('/:id',          (req, res) => scheduleController.update(req, res));
router.delete('/:id',       (req, res) => scheduleController.remove(req, res));

export default router;