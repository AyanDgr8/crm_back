-- Check which fields belong to which company
SELECT 
    company_id,
    field_name,
    field_label,
    is_active,
    show_in_list,
    created_at
FROM custom_fields_metadata
WHERE company_id IN (10, 11)
ORDER BY company_id, field_name;

-- Count fields per company
SELECT 
    company_id,
    COUNT(*) as field_count,
    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_fields,
    SUM(CASE WHEN show_in_list = 1 THEN 1 ELSE 0 END) as list_fields
FROM custom_fields_metadata
WHERE company_id IN (10, 11)
GROUP BY company_id;
