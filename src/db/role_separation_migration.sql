-- Migration script: Role Separation and Schema Updates

USE knowledgeBase_multitenant;

-- 1. Ensure dept_admin and sub_dept_admin roles exist (safe to re-run)
INSERT IGNORE INTO roles (role_name) VALUES ('dept_admin'), ('sub_dept_admin');

-- 2. Migrate existing 'admin' users to 'dept_admin'
-- First find the ID of the 'admin' role
SET @admin_role_id = (SELECT id FROM roles WHERE role_name = 'admin');
SET @dept_admin_role_id = (SELECT id FROM roles WHERE role_name = 'dept_admin');

-- Update users who currently have 'admin' role to 'dept_admin'
UPDATE users SET role_id = @dept_admin_role_id WHERE role_id = @admin_role_id;

-- 3. Update customers table for scheduled_at
ALTER TABLE customers ADD COLUMN scheduled_at DATETIME NULL;

-- 4. Ensure admin_departments can handle the new roles effectively
-- No schema change needed there as it already uses user_id
