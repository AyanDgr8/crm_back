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
        const allowedTypes = ['VARCHAR', 'INT', 'DECIMAL', 'DATETIME', 'DATE', 'TEXT', 'ENUM'];
        if (!allowedTypes.includes(fieldType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid field type'
            });
        }

        const pool = connectDB();
        connection = await pool.getConnection();

        // Check if field already exists
        const [existingColumns] = await connection.query(
            `SELECT COLUMN_NAME 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'customers' 
             AND COLUMN_NAME = ?`,
            [sanitizedFieldName]
        );

        if (existingColumns.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Field "${sanitizedFieldName}" already exists`
            });
        }

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
        }

        // Add NULL/NOT NULL constraint
        columnDefinition += isRequired ? ' NOT NULL' : ' NULL';

        // Add default value if provided
        if (defaultValue && defaultValue.trim() !== '') {
            if (fieldType === 'VARCHAR' || fieldType === 'TEXT' || fieldType === 'ENUM') {
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

        // Execute ALTER TABLE query
        const alterQuery = `ALTER TABLE customers ADD COLUMN ${sanitizedFieldName} ${columnDefinition}`;

        logger.info(`Executing: ${alterQuery}`);
        await connection.query(alterQuery);

        logger.info(`Custom field "${sanitizedFieldName}" added successfully by user ${req.user.userId}`);

        res.json({
            success: true,
            message: `Field "${sanitizedFieldName}" added successfully`,
            fieldName: sanitizedFieldName,
            fieldType: fieldType
        });

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

        // Prevent deleting standard system fields
        const standardFields = [
            'id', 'created_at', 'updated_at', 'last_updated',
            'first_name', 'last_name', 'company_name', 'phone_no', 'email_id',
            'address', 'lead_source', 'call_date_time', 'call_status',
            'call_outcome', 'call_recording', 'product', 'budget',
            'decision_making', 'decision_time', 'lead_stage', 'next_follow_up',
            'assigned_agent', 'reminder_notes', 'priority_level', 'customer_category',
            'tags_labels', 'communcation_channel', 'deal_value', 'conversion_status',
            'customer_history', 'comment', 'agent_name', 'company_id', 'team_id', 'C_unique_id'
        ];

        if (standardFields.includes(fieldName)) {
            return res.status(400).json({ success: false, message: 'Cannot delete system fields' });
        }

        const pool = connectDB();
        connection = await pool.getConnection();

        // Check if field exists
        const [existing] = await connection.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'customers' 
             AND COLUMN_NAME = ?`,
            [fieldName]
        );

        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Field not found' });
        }

        // Drop the column
        await connection.query(`ALTER TABLE customers DROP COLUMN ${fieldName}`);

        logger.info(`Custom field "${fieldName}" deleted by user ${req.user.userId}`);

        res.json({ success: true, message: `Field "${fieldName}" deleted successfully` });

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

        // Get all columns from customers table
        const [columns] = await connection.query(
            `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'customers'
             ORDER BY ORDINAL_POSITION`
        );

        res.json({
            success: true,
            fields: columns
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
