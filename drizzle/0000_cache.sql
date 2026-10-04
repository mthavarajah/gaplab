CREATE TABLE IF NOT EXISTS gaplab_cache (
  key text PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gaplab_cache_expiry ON gaplab_cache (expires_at);
