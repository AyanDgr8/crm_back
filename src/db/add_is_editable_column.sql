-- Add is_editable column to custom_fields_metadata
-- This determines if users can edit the field value or only view it

-- Check if column exists before adding
SET @col_exists = (SELECT COUNT(*) 
                   FROM INFORMATION_SCHEMA.COLUMNS 
                   WHERE TABLE_SCHEMA = DATABASE() 
                   AND TABLE_NAME = 'custom_fields_metadata' 
                   AND COLUMN_NAME = 'is_editable');

SET @query = IF(@col_exists = 0, 
    'ALTER TABLE custom_fields_metadata ADD COLUMN is_editable BOOLEAN DEFAULT TRUE AFTER is_required',
    'SELECT "Column is_editable already exists" AS message');

PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Update existing fields to be editable by default (disable safe mode temporarily)
SET SQL_SAFE_UPDATES = 0;
UPDATE custom_fields_metadata 
SET is_editable = TRUE 
WHERE is_editable IS NULL OR is_editable = FALSE;
SET SQL_SAFE_UPDATES = 1;
