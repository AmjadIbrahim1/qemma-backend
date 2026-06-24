import prisma from '../../../config/prisma.config.js';

class RecordingManager {
  async createRecording({ roomId, fileName, fileSize, duration, storageUrl, recordingType = 'video' }) {
    return prisma.webrtcRecording.create({
      data: {
        roomId,
        fileName,
        fileSize: fileSize ? BigInt(fileSize) : null,
        duration: duration || null,
        storageUrl,
        recordingType,
        endedAt: new Date(),
        isProcessed: true,
      },
    });
  }

  async getRecording(recordingId) {
    return prisma.webrtcRecording.findUnique({
      where: { id: recordingId },
      include: { room: true },
    });
  }

  async getRoomRecordings(roomId) {
    return prisma.webrtcRecording.findMany({
      where: { roomId },
      orderBy: { startedAt: 'desc' },
    });
  }
}

export default new RecordingManager();
