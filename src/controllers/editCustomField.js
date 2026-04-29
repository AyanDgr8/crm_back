// src/controllers/editCustomField.js

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

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
        const { fieldLength, isRequired } = req.body;

        const pool = connectDB();
        connection = await pool.getConnection();

        // Get current field metadata
        const [existing] = await connection.query(
            `SELECT id, field_type, field_length, is_system_field 
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
            let newFieldType = currentFieldType;
            let newLength = fieldLength;

            // Auto-convert VARCHAR to TEXT if length > 300
            if (currentFieldType === 'VARCHAR' && parseInt(fieldLength) > 300) {
                newFieldType = 'TEXT';
                newLength = null;

                // Alter the column in customers table
                const alterQuery = `ALTER TABLE customers MODIFY COLUMN ${fieldName} TEXT`;
                logger.info(`Executing: ${alterQuery}`);
                await connection.query(alterQuery);
            } else if (currentFieldType === 'VARCHAR' && parseInt(fieldLength) !== parseInt(currentLength)) {
                // Just update VARCHAR length
                const alterQuery = `ALTER TABLE customers MODIFY COLUMN ${fieldName} VARCHAR(${fieldLength})`;
                logger.info(`Executing: ${alterQuery}`);
                await connection.query(alterQuery);
            }

            // Update metadata
            await connection.query(
                `UPDATE custom_fields_metadata 
                 SET field_type = ?, field_length = ?, is_required = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [newFieldType, newLength, isRequired || false, existing[0].id]
            );

            await connection.commit();

            logger.info(`Custom field "${fieldName}" updated for company ${req.user.company_id} by user ${req.user.userId}`);

            res.json({
                success: true,
                message: `Field "${fieldName}" updated successfully`,
                fieldType: newFieldType,
                fieldLength: newLength
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
