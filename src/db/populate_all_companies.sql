-- Populate custom_fields_metadata for ALL companies
-- This will insert field metadata for every company in your system

-- Create a temporary procedure to populate for all companies
DELIMITER $$

CREATE PROCEDURE populate_all_companies()
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE current_company_id INT;
    DECLARE company_cursor CURSOR FOR SELECT id FROM companies;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

    OPEN company_cursor;

    read_loop: LOOP
        FETCH company_cursor INTO current_company_id;
        IF done THEN
            LEAVE read_loop;
        END IF;

        -- Insert fields for this company
        INSERT IGNORE INTO custom_fields_metadata 
            (company_id, field_name, field_label, field_type, field_length, is_required, is_editable, show_in_list, is_system_field, display_order)
        SELECT 
            current_company_id,
            COLUMN_NAME,
            CONCAT(UPPER(SUBSTRING(REPLACE(REPLACE(COLUMN_NAME, '_', ' '), 'id', 'ID'), 1, 1)), 
                   SUBSTRING(REPLACE(REPLACE(COLUMN_NAME, '_', ' '), 'id', 'ID'), 2)),
            CASE 
                WHEN DATA_TYPE = 'varchar' THEN 'VARCHAR'
                WHEN DATA_TYPE = 'int' THEN 'INT'
                WHEN DATA_TYPE = 'text' OR DATA_TYPE = 'longtext' OR DATA_TYPE = 'mediumtext' THEN 'TEXT'
                WHEN DATA_TYPE = 'datetime' OR DATA_TYPE = 'timestamp' THEN 'DATETIME'
                WHEN DATA_TYPE = 'date' THEN 'DATE'
                WHEN DATA_TYPE = 'decimal' THEN 'DECIMAL'
                WHEN DATA_TYPE = 'enum' THEN 'ENUM'
                WHEN DATA_TYPE = 'set' THEN 'SET'
                ELSE 'VARCHAR'
            END,
            CHARACTER_MAXIMUM_LENGTH,
            IF(IS_NULLABLE = 'NO' AND COLUMN_NAME NOT IN ('id', 'created_at', 'updated_at', 'company_id'), 1, 0),
            IF(COLUMN_NAME IN ('id', 'created_at', 'updated_at', 'company_id', 'last_updated'), 0, 1),
            IF(COLUMN_NAME IN ('first_name', 'phone_no', 'email_id', 'agent_name', 'scheduled_at'), 1, 0),
            IF(COLUMN_NAME IN ('id', 'first_name', 'phone_no', 'email_id', 'agent_name', 'scheduled_at', 'company_id', 'created_at', 'updated_at', 'last_updated'), 1, 0),
            CASE COLUMN_NAME
                WHEN 'id' THEN 1
                WHEN 'first_name' THEN 2
                WHEN 'phone_no' THEN 3
                WHEN 'email_id' THEN 4
                WHEN 'agent_name' THEN 5
                WHEN 'scheduled_at' THEN 6
                ELSE 999
            END
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'customers'
          AND COLUMN_NAME NOT IN ('password', 'token', 'deleted_at', 'deleted_by');

    END LOOP;

    CLOSE company_cursor;
END$$

DELIMITER ;

-- Execute the procedure
CALL populate_all_companies();

-- Drop the procedure after use
DROP PROCEDURE populate_all_companies;

-- Show results for all companies
SELECT 
    company_id,
    COUNT(*) as field_count
FROM custom_fields_metadata 
GROUP BY company_id
ORDER BY company_id;

-- Show detailed results
SELECT 
    company_id,
    field_name, 
    field_label, 
    is_editable, 
    show_in_list, 
    is_system_field
FROM custom_fields_metadata 
ORDER BY company_id, display_order;
