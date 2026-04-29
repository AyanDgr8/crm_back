-- Fix unique constraint to allow inactive field duplicates
-- This allows reusing field names after deletion

USE knowledgeBase_multitenant;

-- Drop the old unique constraint
ALTER TABLE custom_fields_metadata 
DROP INDEX unique_field_per_company;

-- Add new unique constraint that only applies to active fields
-- MySQL doesn't support partial indexes directly, so we'll use a different approach
-- We'll create a unique index on (company_id, field_name, is_active)
-- But only enforce uniqueness when is_active = 1

-- For MySQL 8.0+, we can use a functional index
-- For older versions, we need to handle this in application logic

-- Check MySQL version first
SELECT VERSION();

-- For MySQL 8.0+, create a functional unique index
-- This will only enforce uniqueness for active fields
ALTER TABLE custom_fields_metadata
ADD UNIQUE INDEX unique_active_field_per_company (company_id, field_name, (CASE WHEN is_active = 1 THEN 1 ELSE NULL END));

-- Note: If the above fails (MySQL < 8.0), run this instead:
-- ALTER TABLE custom_fields_metadata
-- ADD UNIQUE INDEX unique_company_field (company_id, field_name);
-- And handle the logic in the application to check is_active
