-- Add show_in_list column to custom_fields_metadata
-- This determines if the field should appear as a column in the customer list table

-- Check if column exists before adding
SET @col_exists = (SELECT COUNT(*) 
                   FROM INFORMATION_SCHEMA.COLUMNS 
                   WHERE TABLE_SCHEMA = DATABASE() 
                   AND TABLE_NAME = 'custom_fields_metadata' 
                   AND COLUMN_NAME = 'show_in_list');

SET @query = IF(@col_exists = 0, 
    'ALTER TABLE custom_fields_metadata ADD COLUMN show_in_list BOOLEAN DEFAULT FALSE AFTER is_editable',
    'SELECT "Column show_in_list already exists" AS message');

PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Update system fields to show in list by default
SET SQL_SAFE_UPDATES = 0;
UPDATE custom_fields_metadata 
SET show_in_list = TRUE 
WHERE is_system_field = TRUE;
SET SQL_SAFE_UPDATES = 1;
