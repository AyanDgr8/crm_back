-- ============================================================================
-- Custom Fields Per Company Migration - CLEAN VERSION
-- This will drop existing table and recreate it properly
-- ============================================================================

USE knowledgeBase_multitenant;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS after_company_insert_add_system_fields;

-- Drop existing table if exists (this will remove old data)
DROP TABLE IF EXISTS custom_fields_metadata;

-- Create custom_fields_metadata table with nullable created_by
CREATE TABLE custom_fields_metadata (
    id INT PRIMARY KEY AUTO_INCREMENT,
    company_id INT NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    field_label VARCHAR(255) NOT NULL COMMENT 'Display name for the field',
    field_type ENUM('VARCHAR', 'INT', 'DECIMAL', 'DATETIME', 'DATE', 'TEXT', 'ENUM', 'SET') NOT NULL,
    field_length INT NULL COMMENT 'For VARCHAR type',
    enum_values JSON NULL COMMENT 'For ENUM/SET types',
    default_value VARCHAR(255) NULL,
    is_required BOOLEAN DEFAULT false,
    is_system_field BOOLEAN DEFAULT false COMMENT 'true for first_name, phone_no, agent_name',
    display_order INT DEFAULT 999,
    is_active BOOLEAN DEFAULT true,
    created_by INT NULL COMMENT 'NULL for system-generated fields',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_field_per_company (company_id, field_name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_company_fields (company_id),
    INDEX idx_active_fields (company_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert system fields for all existing companies
INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id,
    'first_name',
    'First Name',
    'VARCHAR',
    true,
    true,
    1,
    NULL
FROM companies c;

INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id,
    'phone_no',
    'Phone',
    'VARCHAR',
    true,
    true,
    2,
    NULL
FROM companies c;

INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id,
    'agent_name',
    'Assigned Agent',
    'VARCHAR',
    true,
    true,
    3,
    NULL
FROM companies c;

-- Create trigger to automatically add system fields for new companies
DELIMITER $$

CREATE TRIGGER after_company_insert_add_system_fields
AFTER INSERT ON companies
FOR EACH ROW
BEGIN
    -- Add first_name field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'first_name', 'First Name', 'VARCHAR', true, true, 1, NULL);
    
    -- Add phone_no field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'phone_no', 'Phone', 'VARCHAR', true, true, 2, NULL);
    
    -- Add agent_name field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'agent_name', 'Assigned Agent', 'VARCHAR', true, true, 3, NULL);
END$$

DELIMITER ;

-- Verify the migration
SELECT 
    c.company_name,
    COUNT(cfm.id) as system_fields_count
FROM companies c
LEFT JOIN custom_fields_metadata cfm 
    ON c.id = cfm.company_id 
    AND cfm.is_system_field = true
GROUP BY c.id, c.company_name;
