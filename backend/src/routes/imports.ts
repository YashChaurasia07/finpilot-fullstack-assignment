import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../lib/errors';
import { created } from '../lib/respond';
import { importTransactions } from '../services/imports';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, parts: 10 },
}).single('file');

/** Runs multer and converts its failures (too big, wrong field name, malformed multipart) into clean 4xx errors. */
const readUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'PAYLOAD_TOO_LARGE', 'The file is larger than the 5 MB limit'));
      if (err.code === 'LIMIT_UNEXPECTED_FILE') return next(new AppError(400, 'UNEXPECTED_FIELD', 'Send the file in the form field named "file"'));
      if (err.code === 'LIMIT_FILE_COUNT') return next(new AppError(400, 'TOO_MANY_FILES', 'Send exactly one file per upload'));
    }
    next(new AppError(400, 'INVALID_UPLOAD', 'The upload could not be read. Send multipart/form-data with one CSV file.'));
  });
};

export const importRoutes = Router();

importRoutes.post('/transactions', readUpload, async (req, res) => {
  const file = req.file;
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Attach a CSV file in the multipart form field named "file"');
  const fileName = path.basename(file.originalname.replace(/\\/g, '/'));
  if (!/\.csv$/i.test(fileName)) throw new AppError(400, 'INVALID_FILE_TYPE', 'Only .csv files are accepted');
  created(res, await importTransactions(file.buffer, { fileName, userId: req.user!.id }));
});
