-- ============================================================================
-- WhatsApp Instances Table
-- Stores WhatsApp connection instances for users
-- ============================================================================

USE knowledgeBase_multitenant;

CREATE TABLE IF NOT EXISTS instances (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    instance_id         VARCHAR(100) NOT NULL UNIQUE,
    register_id         VARCHAR(100) NOT NULL,
    status              ENUM('disconnected', 'waiting_for_scan', 'connected', 'reconnecting') DEFAULT 'disconnected',
    qr_code             TEXT,
    last_update         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_instance_id (instance_id),
    INDEX idx_register_id (register_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
