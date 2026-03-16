
-- Migration Script: Convert existing single-tenant data to multi-tenant
-- Run this AFTER creating the new schema_multitenant.sql

USE knowledgeBase_multitenant;

-- ============================================================================
-- STEP 1: Create a default "Legacy Company" for existing data
-- ============================================================================

INSERT INTO companies (company_name, company_email, license_limit, is_active, subscription_start)
VALUES ('Legacy Company', 'legacy@company.com', 1000, true, CURDATE());

SET @legacy_company_id = LAST_INSERT_ID();

-- Initialize license for legacy company
INSERT INTO company_licenses (company_id, total_licenses, used_licenses)
VALUES (@legacy_company_id, 1000, 0); -- Will be updated by triggers

-- ============================================================================
-- STEP 2: Migrate data from old database
-- ============================================================================

-- Migrate Users (except super_admin)
INSERT INTO users (company_id, username, email, password, team_id, role_id, is_company_admin, created_at)
SELECT 
    @legacy_company_id,
    username,
    email,
    password,
    team_id,
    role_id,
    CASE WHEN role_id = (SELECT id FROM roles WHERE role_name = 'business_head') THEN true ELSE false END,
    created_at
FROM knowledgeBase.users
WHERE role_id != (SELECT id FROM roles WHERE role_name = 'super_admin');

-- Migrate Super Admin (company_id = NULL)
INSERT INTO users (company_id, username, email, password, team_id, role_id, is_company_admin, created_at)
SELECT 
    NULL,
    username,
    email,
    password,
    NULL,
    role_id,
    false,
    created_at
FROM knowledgeBase.users
WHERE role_id = (SELECT id FROM roles WHERE role_name = 'super_admin');

-- Migrate Teams
INSERT INTO teams (company_id, team_name, created_at, created_by)
SELECT 
    @legacy_company_id,
    team_name,
    created_at,
    created_by
FROM knowledgeBase.teams;

-- Migrate User Permissions
INSERT INTO user_permissions (user_id, permission_id, value)
SELECT 
    new_u.id,
    up.permission_id,
    up.value
FROM knowledgeBase.user_permissions up
JOIN knowledgeBase.users old_u ON up.user_id = old_u.id
JOIN users new_u ON new_u.email = old_u.email;

-- Migrate Customers
INSERT INTO customers (
    company_id, first_name, last_name, company_name, phone_no, email_id, address,
    lead_source, call_date_time, call_status, call_outcome, call_recording,
    product, budget, decision_making, decision_time, lead_stage,
    next_follow_up, assigned_agent, reminder_notes, priority_level,
    customer_category, tags_labels, communication_channel, deal_value,
    conversion_status, customer_history, comment, C_unique_id,
    scheduled_at, date_created, last_updated, agent_name
)
SELECT 
    @legacy_company_id,
    first_name, last_name, company_name, phone_no, email_id, address,
    lead_source, call_date_time, call_status, call_outcome, call_recording,
    product, budget, decision_making, decision_time, lead_stage,
    next_follow_up, assigned_agent, reminder_notes, priority_level,
    customer_category, tags_labels, communcation_channel, deal_value,
    conversion_status, customer_history, comment, C_unique_id,
    scheduled_at, date_created, last_updated, agent_name
FROM knowledgeBase.customers;

-- Migrate Customer Updates
INSERT INTO updates_customer (
    company_id, customer_id, C_unique_id, field, old_value, new_value,
    changed_at, phone_no_primary, changed_by
)
SELECT 
    @legacy_company_id,
    new_c.id,
    uc.C_unique_id,
    uc.field,
    uc.old_value,
    uc.new_value,
    uc.changed_at,
    uc.phone_no_primary,
    uc.changed_by
FROM knowledgeBase.updates_customer uc
JOIN knowledgeBase.customers old_c ON uc.customer_id = old_c.id
JOIN customers new_c ON new_c.C_unique_id = old_c.C_unique_id AND new_c.company_id = @legacy_company_id;

-- Migrate Scheduler
INSERT INTO scheduler (
    company_id, customer_id, scheduled_at, created_by, assigned_to,
    description, status, created_at, updated_at
)
SELECT 
    @legacy_company_id,
    new_c.id,
    s.scheduled_at,
    new_u.id,
    s.assigned_to,
    s.description,
    s.status,
    s.created_at,
    s.updated_at
FROM knowledgeBase.scheduler s
JOIN knowledgeBase.customers old_c ON s.customer_id = old_c.id
JOIN customers new_c ON new_c.C_unique_id = old_c.C_unique_id AND new_c.company_id = @legacy_company_id
JOIN knowledgeBase.users old_u ON s.created_by = old_u.id
JOIN users new_u ON new_u.email = old_u.email;

-- Migrate Login History
INSERT INTO login_history (
    user_id, company_id, device_id, is_active, login_time, logout_time, last_activity
)
SELECT 
    new_u.id,
    CASE WHEN new_u.company_id IS NULL THEN NULL ELSE @legacy_company_id END,
    lh.device_id,
    lh.is_active,
    lh.login_time,
    lh.logout_time,
    lh.last_activity
FROM knowledgeBase.login_history lh
JOIN knowledgeBase.users old_u ON lh.user_id = old_u.id
JOIN users new_u ON new_u.email = old_u.email;

-- ============================================================================
-- STEP 3: Update license count for legacy company
-- ============================================================================

UPDATE company_licenses 
SET used_licenses = (SELECT COUNT(*) FROM users WHERE company_id = @legacy_company_id)
WHERE company_id = @legacy_company_id;

-- ============================================================================
-- STEP 4: Verification Queries
-- ============================================================================

-- Check migration results
SELECT 'Companies' as table_name, COUNT(*) as count FROM companies
UNION ALL
SELECT 'Users', COUNT(*) FROM users
UNION ALL
SELECT 'Teams', COUNT(*) FROM teams
UNION ALL
SELECT 'Customers', COUNT(*) FROM customers
UNION ALL
SELECT 'Scheduler', COUNT(*) FROM scheduler
UNION ALL
SELECT 'Login History', COUNT(*) FROM login_history;

-- Check license usage
SELECT * FROM v_company_overview;

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Backup old database before running: mysqldump -u root -p knowledgeBase > backup.sql
-- 2. Run schema_multitenant.sql first
-- 3. Then run this migration script
-- 4. Verify data integrity
-- 5. Update .env to point to knowledgeBase_multitenant
