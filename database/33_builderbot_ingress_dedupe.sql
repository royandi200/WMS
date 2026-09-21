CREATE TABLE IF NOT EXISTS webhook_ingress_dedupe (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_key CHAR(64) NULL,
  content_fingerprint CHAR(64) NOT NULL,
  identity_kind ENUM('TRANSPORT', 'VOICE_WINDOW') NOT NULL,
  transport_id_hash CHAR(64) NULL,
  actor_hash CHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  status ENUM('PENDING', 'PROCESSED', 'ERROR') NOT NULL DEFAULT 'PENDING',
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  response_meta JSON NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_webhook_ingress_request_key (request_key),
  KEY idx_webhook_ingress_voice_recent
    (identity_kind, actor_hash, content_fingerprint, first_seen_at),
  KEY idx_webhook_ingress_status (status, last_seen_at)
);

