import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

describe('upload middleware', () => {
  it('persists uploaded files to disk for downstream processing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-pipeline-upload-'));
    process.env.UPLOAD_DIR = tempDir;
    delete process.env.VERCEL;

    const { upload } = await import('../src/utils/upload');

    const app = express();
    app.post('/upload', (req, res, next) => upload(req, res, next), (req, res) => {
      res.json({
        filename: req.file?.filename,
        path: req.file?.path,
      });
    });

    const response = await request(app)
      .post('/upload')
      .attach('image', Buffer.from('fake-image-data'), {
        filename: 'demo.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(200);
    expect(response.body.filename).toBeTruthy();
    expect(response.body.path).toBeTruthy();
    expect(fs.existsSync(response.body.path)).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
