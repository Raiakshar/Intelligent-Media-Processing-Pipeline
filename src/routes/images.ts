import { Router } from 'express';
import { upload } from '../utils/upload';
import {
  uploadImage,
  getStatus,
  getResults,
  getFailureReason,
  listImagesHandler,
} from '../controllers/imageController';

const router = Router();

// POST /images  (multipart/form-data, field name: "image")
router.post('/', (req, res, next) => upload(req, res, next), uploadImage);

// GET /images?status=pending&limit=20&offset=0
router.get('/', listImagesHandler);

// GET /images/:id/status
router.get('/:id/status', getStatus);

// GET /images/:id/results
router.get('/:id/results', getResults);

// GET /images/:id/failure
router.get('/:id/failure', getFailureReason);

export default router;
