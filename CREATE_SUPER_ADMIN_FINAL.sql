-- ============================================================================
-- MULTYCOMM CRM — SUPER ADMIN SETUP
-- ============================================================================
-- Run this AFTER schema_multitenant.sql and all migration scripts in src/db/
--
-- FULL RUN ORDER (fresh install):
--   1. src/db/schema_multitenant.sql            ← creates all tables
--   2. src/db/migration_to_multitenant.sql       ← migrates legacy data (skip on fresh DB)
--   3. src/db/lead_distribution_migration.sql    ← adds distribution_rules table
--   4. src/db/role_separation_migration.sql      ← adds dept_admin / sub_dept_admin roles
--   5. src/db/v17b_lead_delete_migration.sql     ← adds delete_approval_requests + notifications
--   6. src/db/add_user_fields.sql                ← adds phone_no / address to users
--   7. THIS FILE  ← creates super admin user with all permissions
--
-- Credentials:
--   Email:    superadmin@crm.com
--   Password: 12345678
-- ============================================================================

USE knowledgeBase_multitenant;

-- Step 1: Create super admin user
INSERT INTO users (
    company_id,
    username,
    email,
    password,
    team_id,
    role_id,
    is_company_admin,
    is_active
) VALUES (
    NULL,
    'superadmin',
    'superadmin@crm.com',
    '$2b$10$vQx8K9L3mN5pR7tU2wY4ZeH6jI8kL0mN2oP4qR6sT8uV0wX2yZ4A.',
    NULL,
    (SELECT id FROM roles WHERE role_name = 'super_admin'),
    FALSE,
    TRUE
) ON DUPLICATE KEY UPDATE
    password = '$2b$10$vQx8K9L3mN5pR7tU2wY4ZeH6jI8kL0mN2oP4qR6sT8uV0wX2yZ4A.',
    is_active = TRUE;

-- Step 2: Get super admin ID
SET @super_admin_id = (SELECT id FROM users WHERE email = 'superadmin@crm.com');

-- Step 3: Delete any existing permissions
DELETE FROM user_permissions WHERE user_id = @super_admin_id;

-- Step 4: Assign ALL permissions to super admin
INSERT INTO user_permissions (user_id, permission_id, value)
SELECT @super_admin_id, id, TRUE
FROM permissions;

-- Step 5: Verify setup
SELECT '=== SUPER ADMIN CREATED ===' as status;

SELECT 
    u.id,
    u.username,
    u.email,
    u.company_id,
    r.role_name,
    u.is_active,
    COUNT(up.id) as total_permissions
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
LEFT JOIN user_permissions up ON u.id = up.user_id
WHERE u.email = 'superadmin@crm.com'
GROUP BY u.id, u.username, u.email, u.company_id, r.role_name, u.is_active;

-- ============================================================================
-- LOGIN CREDENTIALS:
-- URL: http://localhost:4455/login
-- Email: superadmin@crm.com
-- Password: 12345678
-- ============================================================================
