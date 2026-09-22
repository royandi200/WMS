CREATE TABLE IF NOT EXISTS webhook_ingress_inbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_uuid CHAR(36) NOT NULL,
  dedupe_id BIGINT UNSIGNED NULL,
  identity_kind ENUM('TRANSPORT', 'VOICE_WINDOW', 'UNPROTECTED') NOT NULL,
  actor_hash CHAR(64) NOT NULL,
  content_fingerprint CHAR(64) NOT NULL,
  action VARCHAR(80) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'baja',
  status ENUM('RECEIVED', 'PROCESSING', 'PROCESSED', 'DUPLICATE', 'FAILED')
    NOT NULL DEFAULT 'RECEIVED',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  payload_json JSON NOT NULL,
  response_json JSON NULL,
  last_error VARCHAR(500) NULL,
  duration_ms DECIMAL(12,3) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processing_started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_webhook_ingress_inbox_event_uuid (event_uuid),
  KEY idx_webhook_ingress_inbox_status_received (status, received_at),
  KEY idx_webhook_ingress_inbox_action_received (action, received_at),
  KEY idx_webhook_ingress_inbox_actor_received (actor_hash, received_at),
  KEY idx_webhook_ingress_inbox_dedupe (dedupe_id)
);
