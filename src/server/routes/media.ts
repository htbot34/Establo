import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { publicMediaAbsPath } from '../services/speech.js';

/**
 * Public outbound voice notes. Twilio (and the simulator's <audio> player)
 * fetch these. No auth — the random UUID filename is the capability; files
 * contain only Establo-generated TTS audio of answers.
 */
export function registerMediaRoutes(app: FastifyInstance): void {
  app.get<{ Params: { filename: string } }>('/media/audio/:filename', async (req, reply) => {
    let abs: string;
    try {
      abs = publicMediaAbsPath(req.params.filename);
    } catch {
      return reply.code(400).send({ error: 'Bad filename' });
    }
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'Not found' });
    const mime = abs.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
    return reply.type(mime).send(fs.createReadStream(abs));
  });
}
