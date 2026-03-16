-- V17b: Lead Delete Approval Migration (SAFE / IDEMPOTENT version)
-- Works whether or not the V17 user-delete migration was previously run.

USE knowledgebase_multitenant;

-- ============================================================================
-- STEP 1: Create delete_approval_requests table from scratch (if it doesn't exist)
-- ============================================================================
CREATE TABLE IF NOT EXISTS delete_approval_requests (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    requester_id  INT          NOT NULL,
    customer_id   INT          NOT NULL,
    customer_name VARCHAR(255) NULL,
    approver_id   INT          NULL,
    status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    company_id    INT          NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at   DATETIME     NULL,
    CONSTRAINT fk_dar_requester FOREIGN KEY (requester_id) REFERENCES users(id)   ON DELETE CASCADE,
    CONSTRAINT fk_dar_customer  FOREIGN KEY (customer_id)  REFERENCES customers(id) ON DELETE CASCADE,
    CONSTRAINT fk_dar_approver  FOREIGN KEY (approver_id)  REFERENCES users(id)   ON DELETE SET NULL
);

-- ============================================================================
-- STEP 2: If table already existed (older schema), add missing columns safely
-- ============================================================================

-- Add customer_id column if it doesn't exist
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'delete_approval_requests'
      AND COLUMN_NAME  = 'customer_id'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE delete_approval_requests ADD COLUMN customer_id INT NOT NULL DEFAULT 0 AFTER requester_id',
    'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add customer_name column if it doesn't exist
SET @col_exists2 = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'delete_approval_requests'
      AND COLUMN_NAME  = 'customer_name'
);
SET @sql2 = IF(@col_exists2 = 0,
    'ALTER TABLE delete_approval_requests ADD COLUMN customer_name VARCHAR(255) NULL AFTER customer_id',
    'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Add company_id column if it doesn't exist
SET @col_exists3 = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'delete_approval_requests'
      AND COLUMN_NAME  = 'company_id'
);
SET @sql3 = IF(@col_exists3 = 0,
    'ALTER TABLE delete_approval_requests ADD COLUMN company_id INT NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- ============================================================================
-- STEP 3: Drop the old target_user_id FK + column IF they exist
-- ============================================================================

-- Find and drop the FK constraint on target_user_id (name varies per install)
SET @fk_name = (
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'delete_approval_requests'
      AND COLUMN_NAME  = 'target_user_id'
      AND REFERENCED_TABLE_NAME IS NOT NULL
    LIMIT 1
);
SET @drop_fk = IF(@fk_name IS NOT NULL,
    CONCAT('ALTER TABLE delete_approval_requests DROP FOREIGN KEY ', @fk_name),
    'SELECT 1'
);
PREPARE stmt4 FROM @drop_fk; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;

-- Drop target_user_id column if it exists
SET @col_old = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'delete_approval_requests'
      AND COLUMN_NAME  = 'target_user_id'
);
SET @sql4 = IF(@col_old > 0,
    'ALTER TABLE delete_approval_requests DROP COLUMN target_user_id',
    'SELECT 1'
);
PREPARE stmt5 FROM @sql4; EXECUTE stmt5; DEALLOCATE PREPARE stmt5;

-- Add FK on customer_id if it doesn't already exist
SET @fk_cust = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA      = DATABASE()
      AND TABLE_NAME        = 'delete_approval_requests'
      AND CONSTRAINT_NAME   = 'fk_dar_customer'
      AND CONSTRAINT_TYPE   = 'FOREIGN KEY'
);
SET @sql5 = IF(@fk_cust = 0,
    'ALTER TABLE delete_approval_requests ADD CONSTRAINT fk_dar_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE',
    'SELECT 1'
);
PREPARE stmt6 FROM @sql5; EXECUTE stmt6; DEALLOCATE PREPARE stmt6;

-- ============================================================================
-- STEP 4: Create notifications table if it doesn't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    user_id    INT          NOT NULL,
    type       VARCHAR(50)  NOT NULL,
    title      VARCHAR(255) NOT NULL,
    message    TEXT         NOT NULL,
    ref_id     INT          NULL,
    company_id INT          NOT NULL,
    is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================================
-- STEP 5: Ensure requires_delete_approval column exists on users table
-- ============================================================================
SET @col_rda = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'requires_delete_approval'
);
SET @sql6 = IF(@col_rda = 0,
    'ALTER TABLE users ADD COLUMN requires_delete_approval TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE stmt7 FROM @sql6; EXECUTE stmt7; DEALLOCATE PREPARE stmt7;

-- ============================================================================
-- STEP 6: Set ishi (and all sub_dept_admin / team_leader) to requires_delete_approval = TRUE
-- ============================================================================
SET SQL_SAFE_UPDATES = 0;

UPDATE users u
JOIN roles r ON r.id = u.role_id
SET u.requires_delete_approval = 1
WHERE r.role_name IN ('team_leader', 'sub_dept_admin');

SET SQL_SAFE_UPDATES = 1;

-- ============================================================================
-- Verify
-- ============================================================================
SELECT u.id, u.username, r.role_name, u.requires_delete_approval
FROM users u
JOIN roles r ON r.id = u.role_id
WHERE r.role_name IN ('team_leader', 'sub_dept_admin')
ORDER BY r.role_name, u.username;
