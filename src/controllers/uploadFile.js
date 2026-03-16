// src/controllers/uploadFile.js

import { v4 as uuid } from 'uuid';
import { getDistributor } from '../utils/distributionHelper.js';
import connectDB from '../db/index.js';
import { getEnumValues } from '../utils/enumHelper.js';

const uploadDataStore = new Map();

export const uploadCustomerData = async (req, res) => {
    try {
        const { headerMapping, customerData, distributionOptions } = req.body;

        if (!headerMapping || typeof headerMapping !== 'object' || Object.keys(headerMapping).length === 0) {
            return res.status(400).json({ message: 'Invalid header mapping provided' });
        }

        if (!Array.isArray(customerData) || customerData.length === 0) {
            return res.status(400).json({ message: 'customerData must be a non-empty array.' });
        }

        const pool = await connectDB();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // Fetch enum definitions dynamically from database
            const enumDefinitions = await getEnumValues(connection, 'customers');

            // Get all users for validation and mapping
            const [userResults] = await connection.query(
                'SELECT id, username, team_id FROM users'
            );

            if (userResults.length === 0) {
                return res.status(400).json({ message: 'No users found in the system.' });
            }

            // Create maps for quick lookup
            const validAgents = new Map(userResults.map(user => [user.username, user.team_id])); // Name -> TeamID
            const userMap = new Map(userResults.map(user => [user.id, user])); // ID -> UserObj

            // Initialize distributor if options provided
            let distributor = null;
            if (distributionOptions) {
                distributor = await getDistributor(connection, {
                    ...distributionOptions,
                    companyId: req.user.company_id
                });
            } else {
                // Only validate agent names from CSV if NO auto-distribution
                const agentValidationPromises = customerData.map(async (record, index) => {
                    const agentName = record[headerMapping['agent_name']];
                    if (!agentName) return { valid: false, index, agentName: 'empty' };
                    return { valid: validAgents.has(agentName), index, agentName };
                });

                const agentValidations = await Promise.all(agentValidationPromises);
                const invalidAgents = agentValidations.filter(v => !v.valid);

                if (invalidAgents.length > 0) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: 'Invalid agent names found',
                        invalidAgents: invalidAgents.map(agent => ({
                            index: agent.index,
                            agentName: agent.agentName
                        }))
                    });
                }
            }

            // Check for duplicates first
            const duplicates = [];
            const newRecords = [];

            // Process each record
            for (const record of customerData) {
                const phone = record[headerMapping['phone_no']];
                const firstName = record[headerMapping['first_name']];

                // If distribution is active, agentName might not be in CSV
                let agentName = record[headerMapping['agent_name']];
                let teamId = null;
                let assignedUserId = null;

                // Logic to determine Agent & Team
                if (distributor) {
                    // Auto-assign using distributor logic
                    const assignment = await distributor();
                    assignedUserId = assignment.assigned_to;
                    teamId = assignment.team_id;

                    if (assignedUserId) {
                        const user = userMap.get(assignedUserId);
                        if (user) agentName = user.username;
                    }
                } else {
                    // Manual CSV mapping
                    if (!agentName) continue; // Skip if no agent in CSV and no auto-dist
                    teamId = validAgents.get(agentName);
                    // Find user ID for this agent name (optional, but good for consistency)
                    const user = userResults.find(u => u.username === agentName);
                    if (user) assignedUserId = user.id;
                }

                // Skip empty records (now checking agentName which might be auto-filled)
                if (!firstName || !phone || (!agentName && !teamId)) {
                    continue;
                }

                // Build dynamic duplicate check query
                let duplicateQuery = `
                    SELECT * FROM customers 
                    WHERE company_id = ?
                    AND phone_no = ?
                    AND first_name = ?
                `;

                let queryParams = [req.user.company_id, phone, firstName];

                if (headerMapping['email_id']) {
                    const email = record[headerMapping['email_id']];
                    if (email) {
                        const [emailColumnCheck] = await connection.query(`
                            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
                            WHERE TABLE_SCHEMA = DATABASE() 
                            AND TABLE_NAME = 'customers' 
                            AND COLUMN_NAME = 'email_id'
                        `);

                        if (emailColumnCheck.length > 0) {
                            duplicateQuery = `
                                SELECT * FROM customers 
                                WHERE company_id = ?
                                AND (phone_no = ? OR email_id = ?)
                                AND first_name = ?
                            `;
                            queryParams = [req.user.company_id, phone, email, firstName];
                        }
                    }
                }

                const [existingRecords] = await connection.query(duplicateQuery, queryParams);

                const processedRecord = {
                    ...record,
                    agent_name: agentName,
                    team_id: teamId,
                    assigned_user_id: assignedUserId, // Store ID for update tracking
                    department_id: distributionOptions?.departmentId || null,
                    sub_department_id: distributionOptions?.subDepartmentId || null,
                    team_id: teamId // teamId is already determined above
                };

                if (existingRecords.length > 0) {
                    duplicates.push({
                        new_record: processedRecord,
                        existing_record: existingRecords[0],
                        agent_name: agentName,
                        team_id: teamId
                    });
                } else {
                    newRecords.push(processedRecord);
                }
            }

            // Generate a unique upload ID
            const uploadId = uuid();

            // Store the processed data
            uploadDataStore.set(uploadId, {
                newRecords,
                duplicates,
                headerMapping,
                distributionActive: !!distributor
            });

            await connection.commit();

            res.json({
                success: true,
                message: 'Upload processed successfully',
                duplicates: duplicates.map(d => ({
                    new_record: d.new_record,
                    existing_record: d.existing_record,
                    agent_name: d.agent_name
                })),
                duplicateCount: duplicates.length,
                totalRecords: customerData.length,
                uniqueRecords: newRecords.length,
                uploadId
            });

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error processing upload:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process upload',
            error: error.message
        });
    }
};

export const confirmUpload = async (req, res) => {
    let connection;
    let recordsUploaded = 0;

    try {
        const { uploadId, proceed, duplicateActions } = req.body;

        if (!uploadId) return res.status(400).json({ success: false, message: 'Upload ID is required' });

        if (!proceed) {
            uploadDataStore.delete(uploadId);
            return res.json({ success: true, message: 'Upload cancelled', recordsUploaded: 0 });
        }

        const uploadData = uploadDataStore.get(uploadId);
        if (!uploadData) return res.status(404).json({ success: false, message: 'Upload data expired.' });

        const { duplicates = [], newRecords = [], headerMapping } = uploadData;
        const pool = await connectDB();
        connection = await pool.getConnection();

        await connection.beginTransaction();

        const enumDefinitions = await getEnumValues(connection, 'customers');
        const assignedUserIds = new Set(); // Track users to update stats

        // Process new records
        if (newRecords && newRecords.length > 0) {
            const [lastIdResult] = await connection.query(
                'SELECT C_unique_id FROM customers ORDER BY CAST(SUBSTRING(C_unique_id, 4) AS UNSIGNED) DESC LIMIT 1'
            );
            const lastId = lastIdResult[0]?.C_unique_id || 'FF_0';
            let nextId = (parseInt(lastId.split('_')[1]) || 0) + 1;

            const [columns] = await connection.query('SHOW COLUMNS FROM customers');
            const columnNames = columns.map(col => col.Field)
                .filter(name => !['id', 'date_created', 'last_updated', 'scheduled_at'].includes(name));

            // Ensure team_id and agent_name are in columns if they exist in schema
            // Assuming they are standard columns. If not, filtered out.

            const insertQuery = `INSERT INTO customers (${columnNames.join(', ')}) VALUES ?`;
            const values = newRecords.map(record => {
                if (record.assigned_user_id) assignedUserIds.add(record.assigned_user_id);

                return columnNames.map(colName => {
                    if (colName === 'C_unique_id') return `FF_${nextId++}`;
                    if (colName === 'company_id') return req.user.company_id;

                    // Prioritize our calculated values for agent_name/team_id/assigned_to
                    if (colName === 'agent_name' && record.agent_name !== undefined) return record.agent_name;
                    if (colName === 'team_id' && record.team_id !== undefined) return record.team_id;
                    if (colName === 'assigned_to' && record.assigned_user_id !== undefined) return record.assigned_user_id;

                    if (colName === 'department_id' && record.department_id) return record.department_id;
                    if (colName === 'sub_department_id' && record.sub_department_id) return record.sub_department_id;

                    const dateTimeColumns = ['call_date_time', 'next_follow_up'];
                    let value = record[headerMapping[colName]] || null;

                    if (dateTimeColumns.includes(colName)) value = formatDate(value);
                    else if (enumDefinitions[colName]) value = validateEnumValue(value, enumDefinitions[colName]);

                    return value;
                });
            });

            const [insertResult] = await connection.query(insertQuery, [values]);
            recordsUploaded += insertResult.affectedRows;
        }

        // Process duplicates... (Existing logic mostly, just need to ensure assignedUserIds are tracked if action=append/replace)
        if (duplicates && duplicates.length > 0) {
            for (const [index, duplicate] of duplicates.entries()) {
                const action = duplicateActions[index] || 'skip';
                if (action === 'skip') continue;

                const record = duplicate.new_record;
                if (record.assigned_user_id) assignedUserIds.add(record.assigned_user_id);
                // ... (Existing duplicate logic logic - condensed for brevity as it is largely same but needs access to `record` variables)
                // RE-INSERTING THE DUPLICATE LOGIC BLOCK HERE TO ENSURE INTEGRITY

                const existingRecord = duplicate.existing_record;

                if (action === 'append') {
                    const baseId = existingRecord.C_unique_id.split('__')[0];
                    const [suffixResults] = await connection.query(
                        'SELECT C_unique_id FROM customers WHERE C_unique_id LIKE ? OR C_unique_id = ? ORDER BY CAST(SUBSTRING_INDEX(C_unique_id, "__", -1) AS UNSIGNED) DESC LIMIT 1',
                        [`${baseId}__%`, baseId]
                    );

                    let newCUniqueId = (suffixResults.length === 0 || suffixResults[0].C_unique_id === baseId)
                        ? `${baseId}__1`
                        : `${baseId}__${parseInt(suffixResults[0].C_unique_id.split('__')[1]) + 1}`;

                    const [columns] = await connection.query('SHOW COLUMNS FROM customers');
                    const columnNames = columns.map(col => col.Field).filter(n => !['id', 'date_created', 'last_updated', 'scheduled_at'].includes(n));
                    const insertQuery = `INSERT INTO customers (${columnNames.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;

                    const values = columnNames.map(colName => {
                        if (colName === 'C_unique_id') return newCUniqueId;
                        if (colName === 'company_id') return req.user.company_id;
                        if (colName === 'agent_name' && record.agent_name !== undefined) return record.agent_name;
                        if (colName === 'team_id' && record.team_id !== undefined) return record.team_id;
                        if (colName === 'assigned_to' && record.assigned_user_id !== undefined) return record.assigned_user_id;

                        let value = record[headerMapping[colName]] || null;
                        if (['call_date_time', 'next_follow_up'].includes(colName)) value = formatDate(value);
                        else if (enumDefinitions[colName]) value = validateEnumValue(value, enumDefinitions[colName]);
                        return value;
                    });

                    const [insertResult] = await connection.query(insertQuery, values);
                    recordsUploaded += insertResult.affectedRows;

                } else if (action === 'replace') {
                    const [columns] = await connection.query('SHOW COLUMNS FROM customers');
                    const columnNames = columns.map(col => col.Field).filter(n => !['id', 'C_unique_id', 'date_created', 'last_updated', 'scheduled_at'].includes(n));
                    const updateQuery = `UPDATE customers SET ${columnNames.map(c => `${c} = ?`).join(', ')} WHERE phone_no = ? AND first_name = ?`;

                    const values = columnNames.map(colName => {
                        if (colName === 'company_id') return req.user.company_id;
                        if (colName === 'agent_name' && record.agent_name !== undefined) return record.agent_name;
                        if (colName === 'team_id' && record.team_id !== undefined) return record.team_id;
                        if (colName === 'assigned_to' && record.assigned_user_id !== undefined) return record.assigned_user_id;

                        let value = record[headerMapping[colName]] || null;
                        if (['call_date_time', 'next_follow_up'].includes(colName)) value = formatDate(value);
                        else if (enumDefinitions[colName]) value = validateEnumValue(value, enumDefinitions[colName]);
                        return value;
                    });
                    values.push(record[headerMapping['phone_no']], record[headerMapping['first_name']]);

                    const [updateResult] = await connection.query(updateQuery, values);
                    recordsUploaded += updateResult.affectedRows;
                }
            }
        }

        // UPDATE ROUND ROBIN STATS
        if (assignedUserIds.size > 0) {
            const ids = Array.from(assignedUserIds);
            await connection.query(
                `UPDATE users SET last_assigned_at = NOW() WHERE id IN (?)`,
                [ids]
            );
        }

        await connection.commit();
        uploadDataStore.delete(uploadId);
        res.status(200).json({ success: true, message: `Successfully processed ${recordsUploaded} records`, recordsUploaded });

    } catch (error) {
        console.error('Error in confirmUpload:', error);
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, message: 'Failed to process upload confirmation', error: error.message });
    } finally {
        if (connection) connection.release();
    }
};