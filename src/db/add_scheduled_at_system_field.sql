-- ============================================================================
-- Add scheduled_at as Essential System Field
-- This adds scheduled_at to all existing companies as a required system field
-- ============================================================================

USE knowledgeBase_multitenant;

-- Add scheduled_at field for all existing companies
INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id,
    'scheduled_at',
    'Scheduled At',
    'DATETIME',
    true,
    true,
    4,
    NULL
FROM companies c
WHERE NOT EXISTS (
    SELECT 1 FROM custom_fields_metadata 
    WHERE company_id = c.id AND field_name = 'scheduled_at'
);

-- Update the trigger to include scheduled_at for new companies
DROP TRIGGER IF EXISTS after_company_insert_add_system_fields;

DELIMITER $$

CREATE TRIGGER after_company_insert_add_system_fields
AFTER INSERT ON companies
FOR EACH ROW
BEGIN
    -- Add first_name field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'first_name', 'First Name', 'VARCHAR', true, true, 1, NULL);
    
    -- Add phone_no field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'phone_no', 'Phone', 'VARCHAR', true, true, 2, NULL);
    
    -- Add agent_name field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'agent_name', 'Assigned Agent', 'VARCHAR', true, true, 3, NULL);
    
    -- Add scheduled_at field
    INSERT INTO custom_fields_metadata 
        (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
    VALUES 
        (NEW.id, 'scheduled_at', 'Scheduled At', 'DATETIME', true, true, 4, NULL);
END$$

DELIMITER ;

-- Verify the results
SELECT 
    'Migration Complete!' as status,
    COUNT(DISTINCT company_id) as companies_with_scheduled_at
FROM custom_fields_metadata
WHERE field_name = 'scheduled_at' AND is_system_field = true;

SELECT 
    c.company_name,
    COUNT(cfm.id) as system_fields_count
FROM companies c
LEFT JOIN custom_fields_metadata cfm 
    ON c.id = cfm.company_id 
    AND cfm.is_system_field = true
GROUP BY c.id, c.company_name;
