import { getPool } from './connection';

/**
 * Create all aardvark cron-monitoring tables if they don't already exist.
 * Called once at startup from app.ts.
 */
export async function initSchema(): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS aardvark_job_registry (
        job_name          VARCHAR(100) NOT NULL PRIMARY KEY,
        description       TEXT,
        schedule          VARCHAR(100),
        expected_every_s  INT          NOT NULL,
        max_runtime_s     INT          DEFAULT NULL COMMENT 'Max expected runtime — if exceeded, treated as stuck',
        manual_trigger_url VARCHAR(500),
        severity          ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        alert_channel_id  VARCHAR(100) COMMENT 'Slack channel ID, used when severity = medium',
        active            TINYINT(1)   NOT NULL DEFAULT 1,
        created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS aardvark_job_maintainers (
        id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        job_name      VARCHAR(100) NOT NULL,
        slack_user_id VARCHAR(50)  NOT NULL,
        added_by      VARCHAR(100),
        created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_name) REFERENCES aardvark_job_registry(job_name)
          ON UPDATE CASCADE ON DELETE CASCADE,
        INDEX idx_maintainers_job_name (job_name),
        INDEX idx_maintainers_user    (slack_user_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS aardvark_cron_runs (
        id           BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        job_name     VARCHAR(100) NOT NULL,
        status       ENUM('started','success','failed','missed') NOT NULL,
        message      TEXT,
        duration_s   FLOAT,
        triggered_by VARCHAR(100) NOT NULL DEFAULT 'schedule',
        created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_name) REFERENCES aardvark_job_registry(job_name)
          ON UPDATE CASCADE,
        INDEX idx_cron_job_name (job_name),
        INDEX idx_cron_status   (status),
        INDEX idx_cron_created  (created_at)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS aardvark_activity_log (
        id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        job_name   VARCHAR(100),
        event_type VARCHAR(100) NOT NULL,
        actor      VARCHAR(100),
        detail     TEXT,
        created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_name) REFERENCES aardvark_job_registry(job_name)
          ON UPDATE CASCADE ON DELETE SET NULL,
        INDEX idx_activity_job_name   (job_name),
        INDEX idx_activity_event_type (event_type),
        INDEX idx_activity_created    (created_at)
      )
    `);
  } finally {
    conn.release();
  }
}
