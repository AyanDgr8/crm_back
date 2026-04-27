-- ============================================================================
-- Email Feature Migration
-- Run AFTER schema_multitenant.sql
-- ============================================================================

USE knowledgeBase_multitenant;

-- 1. Email Templates (company-scoped)
CREATE TABLE IF NOT EXISTS email_templates (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    company_id  INT NOT NULL,
    name        VARCHAR(150) NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    body        TEXT NOT NULL,
    created_by  INT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_templates_company (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Email Logs (audit trail per customer)
CREATE TABLE IF NOT EXISTS email_logs (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    company_id  INT NOT NULL,
    customer_id INT NOT NULL,
    sent_by     INT NOT NULL,
    template_id INT NULL,
    subject     VARCHAR(255) NOT NULL,
    body        TEXT NOT NULL,
    recipient   VARCHAR(150) NOT NULL,
    attachments JSON NULL,
    sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status      ENUM('sent','failed') DEFAULT 'sent',
    error_msg   TEXT NULL,
    FOREIGN KEY (company_id)  REFERENCES companies(id)  ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id)  ON DELETE CASCADE,
    FOREIGN KEY (sent_by)     REFERENCES users(id),
    INDEX idx_email_logs_customer (customer_id),
    INDEX idx_email_logs_company  (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Seed: Default templates (will be inserted per-company on first use via app)
-- ============================================================================
