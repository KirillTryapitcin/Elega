# ADR-006: Media pipeline

Status: Proposed · 2026-10-02

## Context
Users upload photos, short videos, voice messages and files from weak phones (§18). Media
is the largest attack surface (file parsing, SSRF via previews, cookie theft via HTML
uploads).

## Decision
- Direct upload: `POST /media/uploads` returns a presigned S3 `PUT` URL (10 min, exact
  content length and type), the browser uploads to object storage, then calls
  `POST /media/{id}/complete`.
- Processing in the worker (`media.process`): magic-byte MIME check, size and pixel limits
  (20 MB, 8000 px, decompression-bomb guard via sharp's `limitInputPixels`), antivirus
  hook (ClamAV container, interface first), EXIF strip, variants 160/320/720/1440 in
  AVIF + WebP + JPEG, blurhash. Video: ffmpeg to H.264/AAC MP4 and HLS 360p/720p/1080p,
  poster frame. Voice: Opus + waveform.
- Two buckets: private originals and private-audience media (short-lived signed URLs),
  public variants (CDN, immutable keys, long TTL).
- Separate registrable domain for user content (for example `elega-usercontent.ru`), not
  the `usercontent.elega.ru` subdomain from the brief: a subdomain shares the registrable
  domain with `elega.ru`, so cookies scoped to `.elega.ru` would still be in reach.
- Files are served with `Content-Disposition: attachment` and `X-Content-Type-Options:
  nosniff`; executables blocked; SVG never served inline.
- Moderation hook interface returns `approved | needs_review | rejected`; MVP
  implementation flags nothing automatically and routes reports to humans.

## Consequences
- API servers never stream large bodies; uploads survive API restarts.
- Video transcoding is CPU-heavy; on the single MVP server the worker gets a CPU limit and
  a concurrency of 1 for video so the API stays responsive.
- Needs a second domain purchased and registered by Kirill.

## Alternatives considered
- Upload through the API: simpler auth, but ties up API workers and memory. Rejected.
- Third-party media SaaS: would move personal data abroad or add a vendor; rejected for
  MVP.
