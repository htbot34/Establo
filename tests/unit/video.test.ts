import { describe, expect, it } from 'vitest';
import { isValidVideoUrl, parseVideoUrl, videoFromText } from '../../src/server/services/video.js';

describe('parseVideoUrl', () => {
  it('resolves every YouTube URL variant to the same id + youtube-nocookie embed', () => {
    const id = 'dQw4w9WgXcQ';
    const embed = `https://www.youtube-nocookie.com/embed/${id}`;
    const urls = [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?t=10`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
    ];
    for (const u of urls) {
      const v = parseVideoUrl(u);
      expect(v?.provider).toBe('youtube');
      expect(v?.videoId).toBe(id);
      expect(v?.embedUrl).toBe(embed);
    }
  });

  it('recognizes Vimeo and builds the player embed', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')).toMatchObject({
      provider: 'vimeo',
      videoId: '123456789',
      embedUrl: 'https://player.vimeo.com/video/123456789',
    });
    expect(parseVideoUrl('https://player.vimeo.com/video/123456789')?.videoId).toBe('123456789');
  });

  it('accepts any other https link as a plain link (no embed)', () => {
    const v = parseVideoUrl('https://extension.example.edu/ordeno.mp4');
    expect(v?.provider).toBe('url');
    expect(v?.embedUrl).toBeNull();
  });

  it('rejects non-URLs, junk, and non-https', () => {
    expect(parseVideoUrl('not a url')).toBeNull();
    expect(parseVideoUrl('')).toBeNull();
    expect(parseVideoUrl('javascript:alert(1)')).toBeNull();
    expect(parseVideoUrl('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull(); // not https
    expect(parseVideoUrl('ftp://host/clip')).toBeNull();
    expect(isValidVideoUrl('garbage')).toBe(false);
    expect(isValidVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
  });

  it('treats a YouTube URL with a malformed id as a plain link, not a video id', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=short')?.provider).toBe('url');
  });

  it('videoFromText pulls the link out of a delivered lesson line', () => {
    const text =
      '📚 Lección 4 de 6\n\nCuerpo de la lección.\n\n' +
      '📹 Mira el video (Ejemplo): https://youtu.be/dQw4w9WgXcQ\n\nPregunta rápida: ¿...?';
    const v = videoFromText(text);
    expect(v?.provider).toBe('youtube');
    expect(v?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('videoFromText returns null when there is no link', () => {
    expect(videoFromText('una lección sin video')).toBeNull();
  });
});
