-- ============================================================================
-- CRM v2 Complete Schema
-- Replaces schema_multitenant.sql + crm_v2_migration.sql
-- Run this on a FRESH database (DROP + CREATE first, or use a new DB)
-- Compatible with MySQL 5.7+ and MySQL Workbench
-- ============================================================================

CREATE DATABASE IF NOT EXISTS knowledgeBase_multitenant
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE knowledgeBase_multitenant;

-- ============================================================================
-- DIMENSION TABLES (Star Schema Core)
-- ============================================================================

-- 1. Companies / Tenants
CREATE TABLE IF NOT EXISTS companies (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    company_name     VARCHAR(200) NOT NULL UNIQUE,
    company_email    VARCHAR(100) NOT NULL UNIQUE,
    license_limit    INT NOT NULL DEFAULT 10,   -- kept for backward compat
    admin_limit      INT NOT NULL DEFAULT 0,    -- max admin slots (IT Admin + Dept Admins)
    user_limit       INT NOT NULL DEFAULT 0,    -- max user slots (TL + Agents + MIS)
    is_active        BOOLEAN DEFAULT true,
    subscription_start DATE,
    subscription_end   DATE,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_by       INT,
    INDEX idx_company_active (is_active),
    INDEX idx_company_name   (company_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Company Licenses (split tracking)
CREATE TABLE IF NOT EXISTS company_licenses (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    company_id           INT NOT NULL,
    total_licenses       INT NOT NULL DEFAULT 0,
    used_licenses        INT NOT NULL DEFAULT 0,
    available_licenses   INT GENERATED ALWAYS AS (total_licenses - used_licenses) STORED,
    total_admin_licenses INT NOT NULL DEFAULT 0,
    used_admin_licenses  INT NOT NULL DEFAULT 0,
    total_user_licenses  INT NOT NULL DEFAULT 0,
    used_user_licenses   INT NOT NULL DEFAULT 0,
    updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company_license (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Permissions
CREATE TABLE IF NOT EXISTS permissions (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    permission_name VARCHAR(50) NOT NULL UNIQUE,
    description     VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Roles (includes new 'admin' role for Dept/Sub-Dept Admins)
CREATE TABLE IF NOT EXISTS roles (
    id        INT PRIMARY KEY AUTO_INCREMENT,
    role_name ENUM(
        'super_admin',
        'business_head',
        'team_leader',
        'user',
        'mis',
        'admin',
        'dept_admin',
        'sub_dept_admin'
    ) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Teams (company-specific)
CREATE TABLE IF NOT EXISTS teams (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    company_id        INT NOT NULL,
    team_name         VARCHAR(50) NOT NULL,
    department_id     INT NULL,
    sub_department_id INT NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by        INT NOT NULL,
    UNIQUE KEY unique_team_per_company (company_id, team_name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company_teams (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Users (multi-tenant with company isolation)
CREATE TABLE IF NOT EXISTS users (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    company_id       INT NULL,      -- NULL for super_admin only
    username         VARCHAR(50) NOT NULL,
    email            VARCHAR(100) NOT NULL UNIQUE,
    password         VARCHAR(255) NOT NULL,
    team_id          INT NULL,
    role_id          INT NOT NULL,
    department_id    INT NULL,      -- primary dept (for non-admin roles quick lookup)
    is_company_admin BOOLEAN DEFAULT false,  -- true for business_head (IT Admin)
    is_active        BOOLEAN DEFAULT true,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_username_per_company (company_id, username),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id)    REFERENCES teams(id)     ON DELETE SET NULL,
    FOREIGN KEY (role_id)    REFERENCES roles(id),
    INDEX idx_company_users (company_id),
    INDEX idx_user_role     (role_id),
    INDEX idx_user_email    (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add FK from teams.created_by -> users (after users table exists)
ALTER TABLE teams
    ADD CONSTRAINT fk_team_created_by
    FOREIGN KEY (created_by) REFERENCES users(id);

-- 7. Departments (new dimension — company-scoped)
CREATE TABLE IF NOT EXISTS departments (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    company_id      INT NOT NULL,
    department_name VARCHAR(100) NOT NULL,
    description     VARCHAR(255) NULL,
    is_active       BOOLEAN DEFAULT true,
    created_by      INT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_dept_per_company (company_id, department_name),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_dept_company (company_id),
    INDEX idx_dept_active  (company_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Sub-Departments (child of departments)
CREATE TABLE IF NOT EXISTS sub_departments (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    company_id          INT NOT NULL,
    department_id       INT NOT NULL,
    sub_department_name VARCHAR(100) NOT NULL,
    description         VARCHAR(255) NULL,
    is_active           BOOLEAN DEFAULT true,
    created_by          INT NOT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_subdept_per_dept (department_id, sub_department_name),
    FOREIGN KEY (company_id)    REFERENCES companies(id)   ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by)    REFERENCES users(id),
    INDEX idx_subdept_company (company_id),
    INDEX idx_subdept_dept    (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Admin-Department mapping (many-to-many bridge)
--    One admin can manage multiple depts; one dept can have multiple admins
CREATE TABLE IF NOT EXISTS admin_departments (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    user_id           INT NOT NULL COMMENT 'must be admin role',
    department_id     INT NOT NULL,
    sub_department_id INT NULL COMMENT 'NULL = manages entire dept',
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_admin_dept_subdept (user_id, department_id, sub_department_id),
    FOREIGN KEY (user_id)           REFERENCES users(id)           ON DELETE CASCADE,
    FOREIGN KEY (department_id)     REFERENCES departments(id)     ON DELETE CASCADE,
    FOREIGN KEY (sub_department_id) REFERENCES sub_departments(id) ON DELETE CASCADE,
    INDEX idx_admin_dept_user (user_id),
    INDEX idx_admin_dept_dept (department_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Now add dept FKs to teams (tables exist now)
ALTER TABLE teams
    ADD CONSTRAINT fk_teams_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE teams
    ADD CONSTRAINT fk_teams_subdepartment
    FOREIGN KEY (sub_department_id) REFERENCES sub_departments(id) ON DELETE SET NULL;

-- 10. User Permissions
CREATE TABLE IF NOT EXISTS user_permissions (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    user_id       INT NOT NULL,
    permission_id INT NOT NULL,
    value         BOOLEAN DEFAULT false,
    FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_permission (user_id, permission_id),
    INDEX idx_user_perms (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- FACT TABLES
-- ============================================================================

-- 11. Customers (Lead Management — company isolated, dynamic fields)
CREATE TABLE IF NOT EXISTS customers (
    -- System fields (never shown to users)
    id                INT PRIMARY KEY AUTO_INCREMENT,
    company_id        INT NOT NULL,
    C_unique_id       VARCHAR(20) DEFAULT NULL,
    date_created      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    last_updated      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Mandatory fields
    first_name        VARCHAR(100) NOT NULL,
    phone_no          VARCHAR(50)  NOT NULL,
    agent_name        VARCHAR(100) NOT NULL,

    -- Team assignment
    team_id           INT NULL COMMENT 'team assigned to this lead',

    -- Department scoping (v2)
    department_id     INT NULL,
    sub_department_id INT NULL,
    assigned_to       INT NULL COMMENT 'user_id of assigned agent',

    UNIQUE KEY unique_customer_id_per_company (company_id, C_unique_id),
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_company_customers  (company_id),
    INDEX idx_customer_agent     (company_id, agent_name),
    INDEX idx_customer_phone     (company_id, phone_no),
    INDEX idx_customer_dept      (company_id, department_id),
    INDEX idx_customer_subdept   (company_id, sub_department_id),
    INDEX idx_customer_assigned  (company_id, assigned_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Customer Updates History (Audit Trail)
CREATE TABLE IF NOT EXISTS updates_customer (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    company_id       INT NOT NULL,
    customer_id      INT NOT NULL,
    C_unique_id      VARCHAR(20) NOT NULL,
    field            VARCHAR(255) NOT NULL,
    old_value        TEXT,
    new_value        TEXT,
    changed_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    phone_no_primary VARCHAR(15) DEFAULT NULL,
    changed_by       VARCHAR(100) NOT NULL,
    FOREIGN KEY (company_id)  REFERENCES companies(id)  ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id)  ON DELETE CASCADE,
    INDEX idx_company_updates  (company_id),
    INDEX idx_customer_updates (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Scheduler
CREATE TABLE IF NOT EXISTS scheduler (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    company_id   INT NOT NULL,
    customer_id  INT NOT NULL,
    scheduled_at DATETIME NOT NULL,
    created_by   INT NOT NULL,
    assigned_to  VARCHAR(100) NOT NULL,
    description  TEXT,
    status       ENUM('pending','completed','cancelled') DEFAULT 'pending',
    created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id)  REFERENCES companies(id)  ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id)  ON DELETE CASCADE,
    FOREIGN KEY (created_by)  REFERENCES users(id),
    INDEX idx_company_schedule  (company_id),
    INDEX idx_customer_schedule (customer_id),
    INDEX idx_schedule_status   (company_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Login History
CREATE TABLE IF NOT EXISTS login_history (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    user_id       INT NOT NULL,
    company_id    INT NULL,
    device_id     VARCHAR(255) NOT NULL,
    is_active     TINYINT(1) DEFAULT 1,
    login_time    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    logout_time   TIMESTAMP NULL DEFAULT NULL,
    last_activity TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    INDEX idx_user_login    (user_id),
    INDEX idx_company_login (company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Roles (includes new 'admin' for Dept Admin)
INSERT INTO roles (role_name) VALUES
    ('super_admin'),
    ('business_head'),
    ('team_leader'),
    ('user'),
    ('mis'),
    ('admin'),
    ('dept_admin'),
    ('sub_dept_admin');

-- Permissions
INSERT INTO permissions (permission_name, description) VALUES
    ('upload_document',        'Upload customer data files'),
    ('download_data',          'Download customer data'),
    ('create_customer',        'Create new customer records'),
    ('edit_customer',          'Edit existing customer records'),
    ('delete_customer',        'Delete customer records'),
    ('view_customer',          'View all customers in company'),
    ('view_team_customers',    'View team customers only'),
    ('view_assigned_customers','View assigned customers only'),
    ('manage_users',           'Create and manage users'),
    ('manage_teams',           'Create and manage teams'),
    ('view_reports',           'View analytics and reports');

-- ============================================================================
-- TRIGGERS — Split license tracking
-- ============================================================================
DELIMITER //

DROP TRIGGER IF EXISTS after_user_insert//
CREATE TRIGGER after_user_insert
AFTER INSERT ON users
FOR EACH ROW
BEGIN
    DECLARE v_role VARCHAR(50);
    IF NEW.company_id IS NOT NULL THEN
        SELECT role_name INTO v_role FROM roles WHERE id = NEW.role_id;
        IF v_role IN ('business_head', 'admin') THEN
            UPDATE company_licenses
            SET used_admin_licenses = used_admin_licenses + 1,
                used_licenses       = used_licenses + 1
            WHERE company_id = NEW.company_id;
        ELSEIF v_role IN ('team_leader', 'user', 'mis') THEN
            UPDATE company_licenses
            SET used_user_licenses = used_user_licenses + 1,
                used_licenses      = used_licenses + 1
            WHERE company_id = NEW.company_id;
        END IF;
    END IF;
END//

DROP TRIGGER IF EXISTS after_user_delete//
CREATE TRIGGER after_user_delete
AFTER DELETE ON users
FOR EACH ROW
BEGIN
    DECLARE v_role VARCHAR(50);
    IF OLD.company_id IS NOT NULL THEN
        SELECT role_name INTO v_role FROM roles WHERE id = OLD.role_id;
        IF v_role IN ('business_head', 'admin') THEN
            UPDATE company_licenses
            SET used_admin_licenses = GREATEST(0, used_admin_licenses - 1),
                used_licenses       = GREATEST(0, used_licenses - 1)
            WHERE company_id = OLD.company_id;
        ELSEIF v_role IN ('team_leader', 'user', 'mis') THEN
            UPDATE company_licenses
            SET used_user_licenses = GREATEST(0, used_user_licenses - 1),
                used_licenses      = GREATEST(0, used_licenses - 1)
            WHERE company_id = OLD.company_id;
        END IF;
    END IF;
END//

DELIMITER ;

-- ============================================================================
-- VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW v_company_overview AS
SELECT
    c.id,
    c.company_name,
    c.company_email,
    c.is_active,
    c.admin_limit,
    c.user_limit,
    cl.total_licenses,
    cl.used_licenses,
    cl.available_licenses,
    cl.total_admin_licenses,
    cl.used_admin_licenses,
    cl.total_user_licenses,
    cl.used_user_licenses,
    (SELECT COUNT(*) FROM users    WHERE company_id = c.id) AS total_users,
    (SELECT COUNT(*) FROM customers WHERE company_id = c.id) AS total_customers,
    c.created_at,
    c.subscription_start,
    c.subscription_end
FROM companies c
LEFT JOIN company_licenses cl ON c.id = cl.company_id;

-- ============================================================================
-- DONE — Run create_superadmin.sql next to create your Super Admin user
-- ============================================================================
