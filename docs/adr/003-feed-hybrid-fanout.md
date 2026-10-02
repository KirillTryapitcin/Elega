# ADR-003: Hybrid fan-out feed

Status: Accepted · 2026-10-02

## Context
The default feed is chronological; "For you" is an optional transparent ranking (§12).
Most authors have a few hundred friends; pages and popular profiles can have many
thousands of followers.

## Decision
- Fan-out on write: on `post.created`, the `feed.fanout` job inserts `feed_entries` for
  every eligible recipient when the author's audience is below 5000 (config
  `FEED_FANOUT_THRESHOLD`).
- Fan-out on read: authors at or above the threshold (pages, popular profiles) are pulled
  at read time from `posts (author_id, created_at)` for the viewer's followed set and merged
  with the precomputed page.
- Group posts fan out to members with `feed_enabled = true`.
- Every page is filtered at read time by audience, blocks, mutes, hidden posts, deleted
  and moderation state. Fan-out is an optimisation, never the permission check.
- Chronological order: keyset on `(created_at, post_id)`. "For you": score computed in a
  pure, unit-tested function `score = freshness_decay × (affinity + engagement) ×
  diversity_penalty`, weights in config, half-life 12 h; the reason is returned for
  "Why am I seeing this?".
- `feed.trim` keeps the latest 1000 entries per user; `feed.unfanout` removes entries on
  delete, unfriend and block.

## Consequences
- Reads are one indexed range scan for most users; writes cost O(audience) per post.
- Visibility changes (unfriend, block, audience edit) take effect immediately because of
  read-time filtering, even before `feed.unfanout` runs.
- The ranked feed is explainable by construction.

## Alternatives considered
- Pure fan-out on read: simple writes, expensive reads for users with many friends.
- Pure fan-out on write: a 100 k-follower page would insert 100 k rows per post.
- ML ranking: out of scope (§1.3).
