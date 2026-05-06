-- =============================================================================
-- CRM DYNAMIC DASHBOARD WIDGETS TABLE
-- This table stores the configuration for each user's personalized dashboard.
-- =============================================================================

CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    user_id         INT NOT NULL,
    company_id      INT NOT NULL,
    widget_type     ENUM('bar', 'pie', 'kpi') NOT NULL DEFAULT 'bar',
    field_name      VARCHAR(100) NOT NULL,
    field_label     VARCHAR(150) NOT NULL,
    accent_color    VARCHAR(20) DEFAULT '#6366f1',
    widget_size     ENUM('sm', 'md', 'lg', 'xl') DEFAULT 'md',
    date_range_days INT DEFAULT 30,
    order_index     INT DEFAULT 0,
    drill_field     VARCHAR(100) DEFAULT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    CONSTRAINT fk_widget_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_widget_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Performance Indexes
    INDEX idx_user_widgets    (user_id, is_active),
    INDEX idx_company_widgets (company_id),
    INDEX idx_widget_order    (order_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verification Query
SELECT 'DASHBOARD_WIDGETS TABLE CREATED SUCCESSFULLY' AS status;
DESC dashboard_widgets;
