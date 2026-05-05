-- ============================================================================
-- WhatsApp Messages Table
-- Stores all incoming and outgoing WhatsApp messages
-- ============================================================================

USE knowledgeBase_multitenant;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    message_id          VARCHAR(255) UNIQUE,
    instance_id         VARCHAR(100) NOT NULL,
    
    -- Sender Information
    sender_number       VARCHAR(50) NOT NULL,
    sender_name         VARCHAR(200),
    
    -- Receiver Information
    receiver_number     VARCHAR(50) NOT NULL,
    receiver_name       VARCHAR(200),
    
    -- Message Content
    message_type        ENUM('text_message', 'media_message', 'document', 'audio', 'video', 'image') NOT NULL DEFAULT 'text_message',
    message_content     TEXT,
    media_url           VARCHAR(500),
    media_filename      VARCHAR(255),
    media_mimetype      VARCHAR(100),
    
    -- Company & Team Association
    company_id          INT,
    company_name        VARCHAR(200),
    team_id             INT,
    team_name           VARCHAR(100),
    
    -- Direction
    direction           ENUM('incoming', 'outgoing') NOT NULL,
    
    -- Status
    status              ENUM('sent', 'delivered', 'read', 'failed') DEFAULT 'sent',
    
    -- Timestamps
    message_timestamp   BIGINT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_sender_number (sender_number),
    INDEX idx_receiver_number (receiver_number),
    INDEX idx_instance_id (instance_id),
    INDEX idx_company_id (company_id),
    INDEX idx_team_id (team_id),
    INDEX idx_message_type (message_type),
    INDEX idx_direction (direction),
    INDEX idx_created_at (created_at),
    INDEX idx_message_timestamp (message_timestamp),
    
    -- Foreign Keys
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
