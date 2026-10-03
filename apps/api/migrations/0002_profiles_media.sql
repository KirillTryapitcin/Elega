-- Elega M2: profiles and media.
--
-- Applied by apps/api/src/db/migrate.ts in one transaction, like 0001. Never edit it once
-- applied: the runner enforces checksums. The rollback SQL is in docs/database.md.
--
-- Literal values below mirror @elega/shared (MEDIA_PURPOSES, MEDIA_REJECTION_REASONS,
-- PROFILE_TEXT_LIMITS, PROFILE_LINKS_MAX, RELATIONSHIP_STATUSES); change them together.

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

-- No rows exist before M2 (nothing wrote the table), so NOT NULL without a default is safe.
ALTER TABLE media ADD COLUMN purpose text NOT NULL
  CHECK (purpose IN ('post', 'comment', 'avatar', 'cover', 'story', 'message', 'group', 'page'));
ALTER TABLE media ADD COLUMN rejection_reason text CHECK (rejection_reason IN
  ('too_large', 'unsupported_type', 'dimensions', 'aspect_ratio', 'corrupt', 'malware', 'policy',
   'expired', 'failed'));
ALTER TABLE media ADD CONSTRAINT media_rejection_reason_chk
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL));
-- Counted by the worker; the stuck-processing cleanup stops re-queueing after a limit.
ALTER TABLE media ADD COLUMN process_attempts smallint NOT NULL DEFAULT 0 CHECK (process_attempts >= 0);
-- storage_key now holds a random 128-bit root (32 hex chars), allocated once per slot. Object
-- keys are derived from it (raw u/<root>, processed m/<root>/...; storageKeys() in @elega/shared).
ALTER TABLE media ADD CONSTRAINT media_storage_key_chk CHECK (storage_key ~ '^[0-9a-f]{32}$');

-- Avatar history and per-purpose lookups.
CREATE INDEX media_owner_purpose_idx ON media (owner_id, purpose, attached_at DESC) WHERE deleted_at IS NULL;
-- Cleanup scans (worker): uploads never completed or stuck, deleted rows awaiting purge,
-- expired rejections. Unattached orphans already use media_orphans_idx from 0001.
CREATE INDEX media_pending_idx ON media (created_at) WHERE status IN ('pending', 'processing') AND deleted_at IS NULL;
CREATE INDEX media_deleted_idx ON media (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX media_rejected_idx ON media (updated_at) WHERE status = 'rejected';

-- Users with media cannot be hard-deleted until their media is purged: a cascade would drop
-- the rows and leave their objects in storage with nothing left to delete them.
ALTER TABLE media DROP CONSTRAINT media_owner_fk;
ALTER TABLE media ADD CONSTRAINT media_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- Profiles and settings
-- ---------------------------------------------------------------------------

-- M1 never wrote these columns, so existing rows hold NULLs and the 0001 defaults.
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_city_len CHECK (char_length(city) <= 100),
  ADD CONSTRAINT user_profiles_workplace_len CHECK (char_length(workplace) <= 100),
  ADD CONSTRAINT user_profiles_education_len CHECK (char_length(education) <= 100),
  ADD CONSTRAINT user_profiles_pronouns_len CHECK (char_length(pronouns) <= 30),
  ADD CONSTRAINT user_profiles_website_len CHECK (char_length(website) <= 2048),
  ADD CONSTRAINT user_profiles_country_chk CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT user_profiles_relationship_chk CHECK (relationship_status IN
    ('single', 'in_relationship', 'engaged', 'married', 'complicated', 'searching')),
  ADD CONSTRAINT user_profiles_visibility_obj CHECK (jsonb_typeof(profile_visibility_json) = 'object'),
  ADD CONSTRAINT user_profiles_links_arr
    CHECK (jsonb_typeof(links_json) = 'array' AND jsonb_array_length(links_json) <= 5);

ALTER TABLE user_settings
  ADD COLUMN profile_hint_dismissed boolean NOT NULL DEFAULT false,
  ADD COLUMN onboarding_done boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Consents: 152-FZ Art. 10.1 consent to dissemination, with its recorded scope
-- ---------------------------------------------------------------------------

-- 0001 declared the CHECK inline, so Postgres named it consents_type_check.
ALTER TABLE consents DROP CONSTRAINT consents_type_check;
ALTER TABLE consents ADD CONSTRAINT consents_type_check CHECK (type IN
  ('terms', 'privacy', 'pd_processing', 'pd_dissemination', 'marketing', 'cookies_analytics'));
-- pd_dissemination: {"fields": [...]}, the profile fields public at grant time.
ALTER TABLE consents ADD COLUMN scope_json jsonb;
-- Every dissemination consent records its scope; no other consent type carries one.
ALTER TABLE consents ADD CONSTRAINT consents_scope_chk CHECK (
  (type = 'pd_dissemination') = (scope_json IS NOT NULL)
  AND (scope_json IS NULL OR coalesce(jsonb_typeof(scope_json -> 'fields') = 'array', false)));
CREATE INDEX consents_user_type_idx ON consents (user_id, type) WHERE revoked_at IS NULL;

-- M1 let adults enable indexing without an Art. 10.1 consent; none can exist yet.
UPDATE user_settings SET search_engine_indexing = false WHERE search_engine_indexing;
