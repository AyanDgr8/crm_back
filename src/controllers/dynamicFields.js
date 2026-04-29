import connectDB from '../db/index.js';
import { logger } from '../logger.js';

/**
 * Add a custom field to the customers table
 * Only accessible by Business Heads
 */
export const addCustomField = async (req, res) => {
    let connection;

    try {
        // Only Business Head and Super Admin can add custom fields
        if (!['business_head', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only Business Heads can add custom fields'
            });
        }

        const {
            fieldName,
            fieldType,
            fieldLength,
            enumValues,
            defaultValue,
            isRequired,
            isEditable,
            showInList,
            isSearchable
        } = req.body;

        // Validate field name
        if (!fieldName || typeof fieldName !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'Field name is required'
            });
        }

        // Sanitize field name: convert spaces to underscores, lowercase, alphanumeric only
        const sanitizedFieldName = fieldName
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');

        // Check for empty name after sanitization
        if (!sanitizedFieldName) {
            return res.status(400).json({
                success: false,
                message: 'Invalid field name. Use only letters, numbers, and spaces.'
            });
        }

        // Check for reserved SQL keywords
        const reservedKeywords = [
            'select', 'insert', 'update', 'delete', 'drop', 'create', 'alter',
            'table', 'database', 'index', 'view', 'trigger', 'procedure',
            'function', 'user', 'grant', 'revoke', 'where', 'from', 'join',
            'order', 'group', 'having', 'limit', 'offset', 'union', 'distinct'
        ];

        if (reservedKeywords.includes(sanitizedFieldName)) {
            return res.status(400).json({
                success: false,
                message: `"${sanitizedFieldName}" is a reserved keyword and cannot be used as a field name`
            });
        }

        // Validate field type
        const allowedTypes = ['VARCHAR', 'INT', 'DECIMAL', 'DATETIME', 'DATE', 'TEXT', 'ENUM', 'SET'];
        if (!allowedTypes.includes(fieldType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid field type'
            });
        }

        const pool = connectDB();
        connection = await pool.getConnection();

        // Build column definition
        let columnDefinition = '';

        switch (fieldType) {
            case 'VARCHAR':
                const length = fieldLength && parseInt(fieldLength) > 0 ? parseInt(fieldLength) : 255;
                // Use TEXT for large fields to avoid row size limit (max VARCHAR is 300)
                if (length > 300) {
                    columnDefinition = 'TEXT';
                } else {
                    columnDefinition = `VARCHAR(${length})`;
                }
                break;

            case 'INT':
                columnDefinition = 'INT';
                break;

            case 'DECIMAL':
                columnDefinition = 'DECIMAL(10,2)';
                break;

            case 'DATETIME':
                columnDefinition = 'DATETIME';
                break;

            case 'DATE':
                columnDefinition = 'DATE';
                break;

            case 'TEXT':
                columnDefinition = 'TEXT';
                break;

            case 'ENUM':
                if (!enumValues || !Array.isArray(enumValues) || enumValues.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'ENUM type requires at least one value'
                    });
                }
                // Sanitize enum values
                const sanitizedEnumValues = enumValues
                    .map(v => String(v).trim())
                    .filter(v => v.length > 0)
                    .map(v => connection.escape(v));

                if (sanitizedEnumValues.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'ENUM type requires valid values'
                    });
                }

                columnDefinition = `ENUM(${sanitizedEnumValues.join(',')})`;
                break;

            case 'SET':
                if (!enumValues || !Array.isArray(enumValues) || enumValues.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'SET type requires at least one value'
                    });
                }
                const sanitizedSetValues = enumValues
                    .map(v => String(v).trim())
                    .filter(v => v.length > 0)
                    .map(v => connection.escape(v));

                if (sanitizedSetValues.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'SET type requires valid values'
                    });
                }

                columnDefinition = `SET(${sanitizedSetValues.join(',')})`;
                break;
        }

        // Add NULL/NOT NULL constraint
        columnDefinition += isRequired ? ' NOT NULL' : ' NULL';

        // Add default value if provided
        if (defaultValue && defaultValue.trim() !== '') {
            if (fieldType === 'VARCHAR' || fieldType === 'TEXT' || fieldType === 'ENUM' || fieldType === 'SET') {
                columnDefinition += ` DEFAULT ${connection.escape(defaultValue)}`;
            } else if (fieldType === 'INT' || fieldType === 'DECIMAL') {
                const numValue = parseFloat(defaultValue);
                if (!isNaN(numValue)) {
                    columnDefinition += ` DEFAULT ${numValue}`;
                }
            } else if (fieldType === 'DATETIME' || fieldType === 'DATE') {
                if (defaultValue.toUpperCase() === 'CURRENT_TIMESTAMP') {
                    columnDefinition += ' DEFAULT CURRENT_TIMESTAMP';
                }
            }
        }

        // Check if field already exists in custom_fields_metadata for this company
        const [existingMetadata] = await connection.query(
            `SELECT id, is_active FROM custom_fields_metadata 
             WHERE company_id = ? AND field_name = ?`,
            [req.user.company_id, sanitizedFieldName]
        );

        if (existingMetadata.length > 0 && existingMetadata[0].is_active) {
            return res.status(400).json({
                success: false,
                message: `Field "${sanitizedFieldName}" already exists for your company`
            });
        }

        await connection.beginTransaction();

        try {
            // Only add column to customers table if it doesn't exist globally
            const [globalColumn] = await connection.query(
                `SELECT COLUMN_NAME 
                 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_SCHEMA = DATABASE() 
                 AND TABLE_NAME = 'customers' 
                 AND COLUMN_NAME = ?`,
                [sanitizedFieldName]
            );

            if (globalColumn.length === 0) {
                // Column doesn't exist, add it to customers table
                const alterQuery = `ALTER TABLE customers ADD COLUMN ${sanitizedFieldName} ${columnDefinition}`;
                logger.info(`Executing: ${alterQuery}`);
                await connection.query(alterQuery);
            }

            // Store field metadata for this company
            const enumValuesJson = (fieldType === 'ENUM' || fieldType === 'SET') && enumValues 
                ? JSON.stringify(enumValues) 
                : null;

            // If inactive field exists, reactivate it; otherwise insert new
            if (existingMetadata.length > 0 && !existingMetadata[0].is_active) {
                // Reactivate the existing field
                await connection.query(
                    `UPDATE custom_fields_metadata 
                     SET field_label = ?, field_type = ?, field_length = ?, enum_values = ?, 
                         default_value = ?, is_required = ?, is_editable = ?, show_in_list = ?, is_searchable = ?, is_active = true, 
                         created_by = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [
                        fieldName.trim(),
                        fieldType,
                        fieldLength || null,
                        enumValuesJson,
                        defaultValue || null,
                        isRequired || false,
                        isEditable !== false,
                        showInList || false,
                        isSearchable || false,
                        req.user.userId,
                        existingMetadata[0].id
                    ]
                );
            } else {
                // Insert new field
                await connection.query(
                    `INSERT INTO custom_fields_metadata 
                     (company_id, field_name, field_label, field_type, field_length, enum_values, 
                      default_value, is_required, is_editable, show_in_list, is_searchable, is_system_field, created_by) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?)`,
                    [
                        req.user.company_id,
                        sanitizedFieldName,
                        fieldName.trim(),
                        fieldType,
                        fieldLength || null,
                        enumValuesJson,
                        defaultValue || null,
                        isRequired || false,
                        isEditable !== false,
                        showInList || false,
                        isSearchable || false,
                        req.user.userId
                    ]
                );
            }

            await connection.commit();

            logger.info(`Custom field "${sanitizedFieldName}" added successfully for company ${req.user.company_id} by user ${req.user.userId}`);

            res.json({
                success: true,
                message: `Field "${sanitizedFieldName}" added successfully`,
                fieldName: sanitizedFieldName,
                fieldType: fieldType
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        }

    } catch (error) {
        logger.error('Error adding custom field:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add custom field',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Delete a custom field
 */
export const deleteCustomField = async (req, res) => {
    let connection;
    try {
        // Only Business Head and Super Admin
        if (!['business_head', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }

        const { fieldName } = req.params;

        // Prevent deleting core system fields and database-managed columns
        const protectedFields = [
            'id', 'company_id', 'C_unique_id', 'created_at', 'date_created', 
            'updated_at', 'last_updated', 'team_id', 'department_id', 
            'sub_department_id', 'assigned_to'
        ];

        if (protectedFields.includes(fieldName)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete system-managed fields' 
            });
        }

        const pool = connectDB();
        connection = await pool.getConnection();

        // Check if field exists for this company
        const [existing] = await connection.query(
            `SELECT id, is_system_field FROM custom_fields_metadata 
             WHERE company_id = ? AND field_name = ? AND is_active = true`,
            [req.user.company_id, fieldName]
        );

        if (existing.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Field not found for your company' 
            });
        }

        if (existing[0].is_system_field) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete system fields' 
            });
        }

        // Hard delete - permanently remove from custom_fields_metadata
        // Note: The column in customers table remains (other companies might use it)
        await connection.query(
            `DELETE FROM custom_fields_metadata 
             WHERE company_id = ? AND field_name = ?`,
            [req.user.company_id, fieldName]
        );

        logger.info(`Custom field "${fieldName}" permanently deleted for company ${req.user.company_id} by user ${req.user.userId}`);

        res.json({ 
            success: true, 
            message: `Field "${fieldName}" deleted successfully` 
        });

    } catch (error) {
        logger.error('Error deleting custom field:', error);
        res.status(500).json({ success: false, message: 'Failed to delete field' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Get all custom fields (columns) from customers table
 */
export const getCustomFields = async (req, res) => {
    let connection;

    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Create field_order table if it doesn't exist
        await connection.query(`
            CREATE TABLE IF NOT EXISTS field_order (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company_id INT NOT NULL,
                field_name VARCHAR(255) NOT NULL,
                display_order INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_company_field (company_id, field_name),
                FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
            )
        `);

        const companyId = req.user.company_id;
        logger.info(`Fetching custom fields for company_id: ${companyId}`);

        // Get fields from custom_fields_metadata for this company only
        const [companyFields] = await connection.query(
            `SELECT 
                cfm.field_name,
                cfm.field_label,
                cfm.field_type,
                cfm.field_length,
                cfm.enum_values,
                cfm.default_value,
                cfm.is_required,
                cfm.is_editable,
                cfm.show_in_list,
                cfm.is_searchable,
                cfm.is_system_field,
                cfm.display_order,
                cfm.is_active,
                c.COLUMN_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT
             FROM custom_fields_metadata cfm
             LEFT JOIN INFORMATION_SCHEMA.COLUMNS c 
                ON c.TABLE_SCHEMA = DATABASE() 
                AND c.TABLE_NAME = 'customers' 
                AND c.COLUMN_NAME = cfm.field_name
             WHERE cfm.company_id = ? 
             AND cfm.is_active = true
             ORDER BY cfm.display_order, cfm.field_name`,
            [companyId]
        );

        logger.info(`Found ${companyFields.length} fields for company ${companyId}`);

        // Format fields for frontend
        const formattedFields = companyFields.map(field => {
            let enumValues = null;
            
            // First try to get from metadata
            if (field.enum_values) {
                try {
                    enumValues = JSON.parse(field.enum_values);
                } catch (err) {
                    logger.error(`Failed to parse enum_values for field ${field.field_name}:`, err);
                    enumValues = null;
                }
            }
            
            // If not in metadata, parse from COLUMN_TYPE for ENUM/SET fields
            if (!enumValues && field.COLUMN_TYPE && (field.field_type === 'ENUM' || field.field_type === 'SET')) {
                const match = field.COLUMN_TYPE.match(/'([^']+)'/g);
                if (match) {
                    enumValues = match.map(s => s.replace(/'/g, ''));
                }
            }
            
            return {
                COLUMN_NAME: field.field_name,
                FIELD_LABEL: field.field_label,
                DATA_TYPE: field.field_type,
                FIELD_LENGTH: field.field_length,
                COLUMN_TYPE: field.COLUMN_TYPE || field.field_type,
                IS_NULLABLE: field.is_required ? 'NO' : 'YES',
                COLUMN_DEFAULT: field.default_value || field.COLUMN_DEFAULT,
                IS_REQUIRED: Boolean(field.is_required),
                IS_EDITABLE: Boolean(field.is_editable),
                SHOW_IN_LIST: Boolean(field.show_in_list),
                IS_SEARCHABLE: Boolean(field.is_searchable),
                IS_SYSTEM_FIELD: Boolean(field.is_system_field),
                DISPLAY_ORDER: field.display_order,
                ENUM_VALUES: enumValues
            };
        });

        res.json({
            success: true,
            fields: formattedFields
        });

    } catch (error) {
        logger.error('Error fetching custom fields:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch custom fields',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Reorder custom fields
 */
export const reorderCustomFields = async (req, res) => {
    let connection;

    try {
        // Only Business Head and Super Admin can reorder fields
        if (!['business_head', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Permission denied'
            });
        }

        const { fieldOrder } = req.body;

        if (!Array.isArray(fieldOrder)) {
            return res.status(400).json({
                success: false,
                message: 'fieldOrder must be an array'
            });
        }

        const pool = connectDB();
        connection = await pool.getConnection();
        const companyId = req.user.company_id;

        await connection.beginTransaction();

        // Update display_order in custom_fields_metadata for each field
        for (const item of fieldOrder) {
            await connection.query(
                `UPDATE custom_fields_metadata 
                 SET display_order = ? 
                 WHERE company_id = ? AND field_name = ?`,
                [item.displayOrder, companyId, item.fieldName]
            );
        }

        await connection.commit();

        logger.info(`Field order updated for company ${companyId} by user ${req.user.userId}`);

        res.json({
            success: true,
            message: 'Field order updated successfully'
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        logger.error('Error reordering fields:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reorder fields',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Edit/Update a custom field
 * Only accessible by Business Heads
 */
export const editCustomField = async (req, res) => {
    let connection;

    try {
        // Only Business Head and Super Admin can edit custom fields
        if (!['business_head', 'super_admin'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only Business Heads can edit custom fields'
            });
        }

        const { fieldName } = req.params;
        const { fieldLabel, fieldType, fieldLength, enumValues, defaultValue, isRequired, isEditable, showInList, isSearchable } = req.body;

        const pool = connectDB();
        connection = await pool.getConnection();

        // Get current field metadata
        const [existing] = await connection.query(
            `SELECT id, field_type, field_length, enum_values, is_system_field 
             FROM custom_fields_metadata 
             WHERE company_id = ? AND field_name = ? AND is_active = true`,
            [req.user.company_id, fieldName]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field not found for your company'
            });
        }

        if (existing[0].is_system_field) {
            return res.status(400).json({
                success: false,
                message: 'Cannot edit system fields'
            });
        }

        const currentFieldType = existing[0].field_type;
        const currentLength = existing[0].field_length;
        
        await connection.beginTransaction();

        try {
            let finalFieldType = fieldType || currentFieldType;
            let finalLength = fieldLength;
            let columnDefinition = '';

            // Build column definition based on type
            switch (finalFieldType) {
                case 'VARCHAR':
                    const length = parseInt(fieldLength) || 255;
                    if (length > 300) {
                        finalFieldType = 'TEXT';
                        finalLength = null;
                        columnDefinition = 'TEXT';
                    } else {
                        columnDefinition = `VARCHAR(${length})`;
                    }
                    break;
                case 'TEXT':
                    columnDefinition = 'TEXT';
                    finalLength = null;
                    break;
                case 'INT':
                    columnDefinition = 'INT';
                    finalLength = null;
                    break;
                case 'DECIMAL':
                    columnDefinition = 'DECIMAL(10,2)';
                    finalLength = null;
                    break;
                case 'DATE':
                    columnDefinition = 'DATE';
                    finalLength = null;
                    break;
                case 'DATETIME':
                    columnDefinition = 'DATETIME';
                    finalLength = null;
                    break;
                case 'ENUM':
                    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
                        const enumList = enumValues.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
                        columnDefinition = `ENUM(${enumList})`;
                    } else {
                        throw new Error('ENUM type requires at least one value');
                    }
                    finalLength = null;
                    break;
                case 'SET':
                    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
                        const setList = enumValues.map(v => `'${v.replace(/'/g, "''")}'`).join(',');
                        columnDefinition = `SET(${setList})`;
                    } else {
                        throw new Error('SET type requires at least one value');
                    }
                    finalLength = null;
                    break;
                default:
                    throw new Error('Invalid field type');
            }

            // Alter the column in customers table if type or definition changed
            const alterQuery = `ALTER TABLE customers MODIFY COLUMN ${fieldName} ${columnDefinition}`;
            logger.info(`Executing: ${alterQuery}`);
            await connection.query(alterQuery);

            // Prepare enum values JSON
            const enumValuesJson = (finalFieldType === 'ENUM' || finalFieldType === 'SET') && enumValues 
                ? JSON.stringify(enumValues) 
                : null;

            // Update metadata
            await connection.query(
                `UPDATE custom_fields_metadata 
                 SET field_label = ?, field_type = ?, field_length = ?, enum_values = ?, 
                     default_value = ?, is_required = ?, is_editable = ?, show_in_list = ?, is_searchable = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [fieldLabel || fieldName, finalFieldType, finalLength, enumValuesJson, defaultValue || null, isRequired || false, isEditable !== false, showInList || false, isSearchable || false, existing[0].id]
            );

            await connection.commit();

            logger.info(`Custom field "${fieldName}" updated for company ${req.user.company_id} by user ${req.user.userId}`);

            res.json({
                success: true,
                message: `Field "${fieldName}" updated successfully`,
                fieldType: finalFieldType,
                fieldLength: finalLength
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        }

    } catch (error) {
        logger.error('Error editing custom field:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to edit field',
            error: error.message
        });
    } finally {
        if (connection) connection.release();
    }
};
