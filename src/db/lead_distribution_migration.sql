-- Migration for Lead Distribution Workflow

-- 1. Create table for storing distribution rules per department/scope
CREATE TABLE IF NOT EXISTS lead_distribution_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    department_id INT NOT NULL,
    scope_type ENUM('department', 'sub_department') NOT NULL DEFAULT 'department',
    scope_id INT NOT NULL, -- Could be DeptID or SubDeptID depending on scope_type
    distribution_method ENUM('equal', 'weighted', 'round_robin') NOT NULL DEFAULT 'equal',
    active_only BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- 2. Add lead_weight column to users table for Weighted Distribution
-- We use a safe procedure to add the column only if it doesn't exist
SET @dbname = DATABASE();
SET @tablename = "users";
SET @columnname = "lead_weight";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE users ADD COLUMN lead_weight INT DEFAULT 1"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Add last_assigned_at to users table for Round Robin logic
-- This helps us find who was assigned a lead most recently
SET @columnname2 = "last_assigned_at";
SET @preparedStatement2 = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE
      (table_name = @tablename)
      AND (table_schema = @dbname)
      AND (column_name = @columnname2)
  ) > 0,
  "SELECT 1",
  "ALTER TABLE users ADD COLUMN last_assigned_at TIMESTAMP NULL"
));
PREPARE alterIfNotExists2 FROM @preparedStatement2;
EXECUTE alterIfNotExists2;
DEALLOCATE PREPARE alterIfNotExists2;
