import webrtcService from './webrtc.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const fail = (res, e) => res.status(e.statusCode || 500).json({ success: false, message: e.message });

class WebrtcController {
  async uploadRecording(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No video file provided' });
      }

      const { roomId, duration } = req.body;
      if (!roomId) {
        return res.status(400).json({ success: false, message: 'roomId is required' });
      }

      const result = await webrtcService.saveRecording(
        req.file.buffer,
        req.file.originalname || 'recording.mp4',
        roomId,
        duration ? parseInt(duration) : null,
      );

      ok(res, result, 201);
    } catch (e) {
      fail(res, e);
    }
  }
}

export default new WebrtcController();
