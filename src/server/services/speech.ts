import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { PUBLIC_MEDIA_DIR, absPath, ensureDir, saveBuffer } from '../lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SILENCE_MP3 = path.resolve(__dirname, '../assets/silence.mp3');

export function speechAvailable(): boolean {
  return !!config().openaiApiKey;
}

/** Convert WhatsApp OGG/Opus voice notes to mp3 for Whisper. */
export async function convertToMp3(inputPath: string, outputPath: string): Promise<void> {
  const [{ default: ffmpeg }, ffmpegStatic] = await Promise.all([
    import('fluent-ffmpeg'),
    import('ffmpeg-static'),
  ]);
  const binary = (ffmpegStatic.default ?? ffmpegStatic) as unknown as string;
  if (binary) ffmpeg.setFfmpegPath(binary);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .format('mp3')
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath);
  });
}

/**
 * Transcribe a worker voice note with Whisper (language hint: es).
 * Input may be OGG/Opus (WhatsApp default) — converted to mp3 first.
 * In mock mode the simulator supplies transcripts directly, so this is only
 * reached in sandbox/production.
 */
export async function transcribeAudio(audioPath: string, mimeType: string): Promise<string> {
  if (!speechAvailable()) {
    throw new Error('Transcription requires OPENAI_API_KEY');
  }
  let mp3Path = audioPath;
  if (!/mp3|mpeg/.test(mimeType) && !audioPath.endsWith('.mp3')) {
    mp3Path = `${audioPath}.mp3`;
    await convertToMp3(audioPath, mp3Path);
  }
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config().openaiApiKey });
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(mp3Path),
    model: config().openaiWhisperModel,
    language: 'es',
  });
  return result.text.trim();
}

export interface TtsResult {
  /** storage-relative path, e.g. public-media/abc.ogg */
  relPath: string;
  /** URL path the worker's WhatsApp (or the simulator) fetches, e.g. /media/audio/abc.ogg */
  publicUrl: string;
  mime: string;
  /** true when this is the silent placeholder (no OPENAI_API_KEY) */
  placeholder: boolean;
}

/**
 * Generate a Spanish voice reply. Real mode: OpenAI TTS as OGG/Opus
 * (WhatsApp's preferred voice format). Stub mode: a silent placeholder mp3
 * so the voice-reply code path stays fully exercised without keys.
 */
export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  await ensureDir(PUBLIC_MEDIA_DIR);
  if (!speechAvailable()) {
    const name = `${randomUUID()}.mp3`;
    const rel = `${PUBLIC_MEDIA_DIR}/${name}`;
    await saveBuffer(rel, await fs.promises.readFile(SILENCE_MP3));
    return { relPath: rel, publicUrl: `/media/audio/${name}`, mime: 'audio/mpeg', placeholder: true };
  }
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config().openaiApiKey });
  const res = await client.audio.speech.create({
    model: config().openaiTtsModel,
    voice: config().openaiTtsVoice,
    input: text.slice(0, 4000),
    response_format: 'opus',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const name = `${randomUUID()}.ogg`;
  const rel = `${PUBLIC_MEDIA_DIR}/${name}`;
  await saveBuffer(rel, buf);
  return { relPath: rel, publicUrl: `/media/audio/${name}`, mime: 'audio/ogg', placeholder: false };
}

/** Absolute path of a public-media file by its URL filename (for serving). */
export function publicMediaAbsPath(filename: string): string {
  if (!/^[a-zA-Z0-9-]+\.(ogg|mp3)$/.test(filename)) {
    throw new Error('Invalid media filename');
  }
  return absPath(`${PUBLIC_MEDIA_DIR}/${filename}`);
}
