import { NextRequest, NextResponse } from 'next/server';

export type SocialPlatform = 'youtube' | 'tiktok' | 'instagram' | 'unknown';

export interface SocialPreview {
  platform: SocialPlatform;
  thumbnail: string | null;
  title: string | null;
  embedUrl: string | null;
  videoId: string | null;
}

const ALLOWED_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'instagram.com', 'www.instagram.com'];

function getYouTubeId(url: string): string | null {
  for (const re of [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ]) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function getTikTokVideoId(url: string): string | null {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

function getInstagramShortcode(url: string): string | null {
  const m = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
  return m ? m[2] : null;
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url') ?? '';
  if (!rawUrl) return NextResponse.json({ error: 'url required' }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }

  const host = parsed.hostname;
  if (!ALLOWED_HOSTS.includes(host)) {
    return NextResponse.json({ error: 'unsupported host' }, { status: 400 });
  }

  const result: SocialPreview = { platform: 'unknown', thumbnail: null, title: null, embedUrl: null, videoId: null };

  if (/youtube\.com|youtu\.be/.test(host)) {
    result.platform = 'youtube';
    result.videoId = getYouTubeId(rawUrl);
    if (result.videoId) {
      result.thumbnail = `https://img.youtube.com/vi/${result.videoId}/hqdefault.jpg`;
      result.embedUrl = `https://www.youtube.com/embed/${result.videoId}?playsinline=1&rel=0`;
    }
  } else if (/tiktok\.com/.test(host)) {
    result.platform = 'tiktok';
    result.videoId = getTikTokVideoId(rawUrl);
    if (result.videoId) {
      result.embedUrl = `https://www.tiktok.com/embed/v2/${result.videoId}`;
    }
    try {
      const oembed = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nTZS/1.0)' },
        signal: AbortSignal.timeout(4000),
      });
      if (oembed.ok) {
        const data = await oembed.json();
        result.thumbnail = data.thumbnail_url ?? null;
        result.title = data.title ?? null;
        if (!result.videoId && data.embed_product_id) result.videoId = data.embed_product_id;
      }
    } catch { /* oEmbed failed — embed still works via videoId */ }
  } else if (/instagram\.com/.test(host)) {
    result.platform = 'instagram';
    result.videoId = getInstagramShortcode(rawUrl);
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
  });
}
