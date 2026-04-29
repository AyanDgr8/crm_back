-- Populate custom_fields_metadata with existing fields from customers table
-- Run this to migrate your existing dynamic fields

-- First, check what company_id to use (adjust if needed)
SET @company_id = 1;

-- Insert all existing columns from customers table into metadata
INSERT IGNORE INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, field_length, is_required, is_editable, show_in_list, is_system_field, display_order)
SELECT 
    @company_id,
    COLUMN_NAME,
    -- Create a readable label from column name
    CONCAT(UPPER(SUBSTRING(REPLACE(REPLACE(COLUMN_NAME, '_', ' '), 'id', 'ID'), 1, 1)), 
           SUBSTRING(REPLACE(REPLACE(COLUMN_NAME, '_', ' '), 'id', 'ID'), 2)),
    -- Map MySQL data types to our field types
    CASE 
        WHEN DATA_TYPE = 'varchar' THEN 'VARCHAR'
        WHEN DATA_TYPE = 'int' THEN 'INT'
        WHEN DATA_TYPE = 'text' OR DATA_TYPE = 'longtext' OR DATA_TYPE = 'mediumtext' THEN 'TEXT'
        WHEN DATA_TYPE = 'datetime' OR DATA_TYPE = 'timestamp' THEN 'DATETIME'
        WHEN DATA_TYPE = 'date' THEN 'DATE'
        WHEN DATA_TYPE = 'decimal' THEN 'DECIMAL'
        WHEN DATA_TYPE = 'enum' THEN 'ENUM'
        WHEN DATA_TYPE = 'set' THEN 'SET'
        ELSE 'VARCHAR'
    END,
    CHARACTER_MAXIMUM_LENGTH,
    -- is_required based on NOT NULL
    IF(IS_NULLABLE = 'NO' AND COLUMN_NAME NOT IN ('id', 'created_at', 'updated_at', 'company_id'), 1, 0),
    -- is_editable: all fields editable by default except system fields
    IF(COLUMN_NAME IN ('id', 'created_at', 'updated_at', 'company_id', 'last_updated'), 0, 1),
    -- show_in_list: only main fields shown by default
    IF(COLUMN_NAME IN ('first_name', 'phone_no', 'email_id', 'agent_name', 'scheduled_at'), 1, 0),
    -- is_system_field
    IF(COLUMN_NAME IN ('id', 'first_name', 'phone_no', 'email_id', 'agent_name', 'scheduled_at', 'company_id', 'created_at', 'updated_at', 'last_updated'), 1, 0),
    -- display_order
    CASE COLUMN_NAME
        WHEN 'id' THEN 1
        WHEN 'first_name' THEN 2
        WHEN 'phone_no' THEN 3
        WHEN 'email_id' THEN 4
        WHEN 'agent_name' THEN 5
        WHEN 'scheduled_at' THEN 6
        ELSE 999
    END
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'customers'
  AND COLUMN_NAME NOT IN ('password', 'token', 'deleted_at', 'deleted_by');

-- Show what was inserted
SELECT 
    field_name, 
    field_label, 
    field_type, 
    is_required, 
    is_editable, 
    show_in_list, 
    is_system_field,
    display_order
FROM custom_fields_metadata 
WHERE company_id = @company_id
ORDER BY display_order, field_name;
