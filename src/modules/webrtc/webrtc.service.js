import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import recordingManager from './managers/recording.manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WebrtcService {
  _saveFile(buffer, originalName) {
    try {
      const uploadDir = path.join(__dirname, '../../../public/uploads/lessons/videos');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const ext = path.extname(originalName) || '.mp4';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      fs.writeFileSync(filePath, buffer);
      return `/uploads/lessons/videos/${fileName}`;
    } catch (err) {
      console.error('Failed to save recording:', err.message);
      return null;
    }
  }

  async saveRecording(buffer, originalName, roomId, duration) {
    const storageUrl = this._saveFile(buffer, originalName);
    if (!storageUrl) throw new Error('Failed to save recording file');

    const recording = await recordingManager.createRecording({
      roomId,
      fileName: path.basename(storageUrl),
      fileSize: buffer.length,
      duration: duration || null,
      storageUrl,
    });

    return {
      videoUrl: storageUrl,
      fileName: path.basename(storageUrl),
      duration: duration || null,
      recordingId: recording.id,
    };
  }
}

export default new WebrtcService();
