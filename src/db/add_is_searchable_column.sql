-- Add is_searchable column to custom_fields_metadata
-- This determines if the field should be available in the header search bar

-- Check if column exists before adding
SET @col_exists = (SELECT COUNT(*) 
                   FROM INFORMATION_SCHEMA.COLUMNS 
                   WHERE TABLE_SCHEMA = DATABASE() 
                   AND TABLE_NAME = 'custom_fields_metadata' 
                   AND COLUMN_NAME = 'is_searchable');

SET @query = IF(@col_exists = 0, 
    'ALTER TABLE custom_fields_metadata ADD COLUMN is_searchable BOOLEAN DEFAULT FALSE AFTER show_in_list',
    'SELECT "Column is_searchable already exists" AS message');

PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Set phone_no and first_name as searchable by default
SET SQL_SAFE_UPDATES = 0;
UPDATE custom_fields_metadata 
SET is_searchable = TRUE 
WHERE field_name IN ('phone_no', 'first_name', 'email_id');
SET SQL_SAFE_UPDATES = 1;

-- Show updated fields
SELECT field_name, field_label, is_searchable, field_type
FROM custom_fields_metadata 
WHERE is_searchable = TRUE
ORDER BY field_name;
