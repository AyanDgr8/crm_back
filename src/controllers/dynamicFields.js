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
            isRequired
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
                columnDefinition = `VARCHAR(${Math.min(length, 65535)})`;
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
            `SELECT id FROM custom_fields_metadata 
             WHERE company_id = ? AND field_name = ?`,
            [req.user.company_id, sanitizedFieldName]
        );

        if (existingMetadata.length > 0) {
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

            await connection.query(
                `INSERT INTO custom_fields_metadata 
                 (company_id, field_name, field_label, field_type, field_length, enum_values, 
                  default_value, is_required, is_system_field, created_by) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, false, ?)`,
                [
                    req.user.company_id,
                    sanitizedFieldName,
                    fieldName.trim(), // Original field name as label
                    fieldType,
                    fieldLength || null,
                    enumValuesJson,
                    defaultValue || null,
                    isRequired || false,
                    req.user.userId
                ]
            );

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

        // Soft delete - mark as inactive instead of dropping column
        // This way other companies can still use the same column name
        await connection.query(
            `UPDATE custom_fields_metadata 
             SET is_active = false 
             WHERE company_id = ? AND field_name = ?`,
            [req.user.company_id, fieldName]
        );

        logger.info(`Custom field "${fieldName}" deleted for company ${req.user.company_id} by user ${req.user.userId}`);

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

        // Format fields for frontend
        const formattedFields = companyFields.map(field => ({
            COLUMN_NAME: field.field_name,
            FIELD_LABEL: field.field_label,
            DATA_TYPE: field.field_type,
            COLUMN_TYPE: field.COLUMN_TYPE || field.field_type,
            IS_NULLABLE: field.is_required ? 'NO' : 'YES',
            COLUMN_DEFAULT: field.default_value || field.COLUMN_DEFAULT,
            IS_REQUIRED: field.is_required,
            IS_SYSTEM_FIELD: field.is_system_field,
            DISPLAY_ORDER: field.display_order,
            ENUM_VALUES: field.enum_values ? JSON.parse(field.enum_values) : null
        }));

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

        // Delete existing order for this company
        await connection.query(
            `DELETE FROM field_order WHERE company_id = ?`,
            [companyId]
        );

        // Insert new order
        for (const item of fieldOrder) {
            await connection.query(
                `INSERT INTO field_order (company_id, field_name, display_order) VALUES (?, ?, ?)`,
                [companyId, item.fieldName, item.displayOrder]
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
