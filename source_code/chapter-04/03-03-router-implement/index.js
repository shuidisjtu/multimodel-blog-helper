import 'dotenv/config'
import express from 'express';
import multer from 'multer';
import path, { dirname } from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { transcript } from './transcript.js'
import { askAssistant } from './assistant.js'

const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'temp'));
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
        cb(null, true);
    } else {
        cb(new Error('Only audio files are allowed'), false);
    }
};

const limits = {
    fileSize: 25 * 1024 * 1024,
}

const upload = multer({
    storage,
    limits,
    fileFilter
});


app.post('/api/v1/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded or invalid file format' });
    }

    const { filename: fileName, path: filePath } = req.file;
    const transcriptionResult = await transcript(filePath);
    const result = await askAssistant(transcriptionResult);

    res.send(result);

});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

