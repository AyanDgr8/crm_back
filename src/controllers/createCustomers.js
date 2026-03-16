// src/controllers/createCustomer.js

import connectDB from '../db/index.js';

// Helper function to format date
const formatDate = (dateStr) => {
    if (!dateStr) return null;

    // Convert to string and trim
    const strDate = String(dateStr).trim();
    if (!strDate) return null;

    try {
        // First try to handle Excel date number (days since December 30, 1899)
        const numericDate = Number(strDate.replace(/[^0-9]/g, ''));
        if (!isNaN(numericDate)) {
            // Excel date starting point (December 30, 1899)
            const excelEpoch = new Date(1899, 11, 30);
            const date = new Date(excelEpoch.getTime() + (numericDate * 24 * 60 * 60 * 1000));

            // Validate the resulting date
            if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
                return date.toISOString().slice(0, 10);
            }
        }

        // Try DD/MM/YYYY format
        const parts = strDate.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10);
            const year = parseInt(parts[2], 10);

            if (day > 0 && day <= 31 &&
                month > 0 && month <= 12 &&
                year >= 2000 && year <= 2100) {
                const paddedDay = day.toString().padStart(2, '0');
                const paddedMonth = month.toString().padStart(2, '0');
                return `${year}-${paddedMonth}-${paddedDay}`;
            }
        }

        // Try parsing as regular date string
        const date = new Date(strDate);
        if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
            return date.toISOString().slice(0, 10);
        }

        console.warn(`Invalid date format for value: ${strDate}`);
        return null;
    } catch (error) {
        console.error(`Error formatting date: ${strDate}`, error);
        return null;
    }
};

const formatMySQLDateTime = (date) => {
    if (!date) return null;
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 19).replace('T', ' ');
    } catch (error) {
        console.error('Error formatting date:', error);
        return null;
    }
};

export const makeNewRecord = async (req, res) => {
    let connection;
    try {
        // Check if user exists in request
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        connection = await connectDB();

        // Constants for ENUM values matching database schema exactly
        const VALID_LEAD_SOURCES = ['website', 'data', 'referral', 'ads'];
        const VALID_CALL_STATUS = ['connected', 'not connected', 'follow_up'];
        const VALID_CALL_OUTCOMES = ['interested', 'not interested', 'call_later', 'wrong_number'];
        const VALID_DECISION_MAKING = ['yes', 'no'];
        const VALID_DECISION_TIME = ['imeediate', '1_week', '1_month', 'future_investment'];
        const VALID_LEAD_STAGE = ['new', 'in_progeress', 'qualified', 'converted', 'lost'];
        const VALID_PRIORITY_LEVEL = ['low', 'medium', 'high'];
        const VALID_CUSTOMER_CATEGORY = ['hot', 'warm', 'cold'];
        const VALID_TAGS_LABELS = ['premium_customer', 'repeat_customer', 'demo_required'];
        const VALID_COMMUNICATION_CHANNEL = ['call', 'whatsapp', 'email', 'sms'];
        const VALID_CONVERSION_STATUS = ['lead', 'opportunity', 'customer'];
        const VALID_CUSTOMER_HISTORY = ['previous calls', 'purchases', 'interactions78'];

        // Validation functions
        const validateEnum = (value, validValues, defaultValue) => {
            if (!value) return defaultValue;
            const normalizedValue = value.toString().toLowerCase().trim();
            return validValues.includes(normalizedValue) ? normalizedValue : defaultValue;
        };

        const validateVarchar = (value, maxLength) => {
            if (!value) return null;
            return value.toString().substring(0, maxLength);
        };

        const validateMobileNumber = (value) => {
            if (!value) return null;
            // Remove any non-digit characters
            const digits = value.toString().replace(/\D/g, '');
            // Check if the number has more than 15 digits
            if (digits.length > 15) {
                throw new Error('Phone number cannot exceed 15 digits');
            }
            return digits;
        };

        // Extract variables from req.body
        const {
            first_name, last_name, company_name, phone_no, email_id, address,
            lead_source, call_date_time, call_status, call_outcome, call_recording,
            product, budget, decision_making, decision_time, lead_stage,
            next_follow_up, assigned_agent, reminder_notes, priority_level,
            customer_category, tags_labels, communcation_channel, deal_value,
            conversion_status, customer_history, comment, scheduled_at, agent_name
        } = req.body;

        const errors = [];

        // Validate required fields
        if (!phone_no) {
            errors.push('Phone number is required.');
        }
        if (!first_name) {
            errors.push('First name is required.');
        }

        // Validate phone numbers
        try {
            if (phone_no) {
                validateMobileNumber(phone_no);
            }
        } catch (error) {
            errors.push(error.message);
        }

        // Helper to check if value is non-null and non-empty
        const isValidValue = (value) => {
            return value !== undefined && value !== null && value !== '';
        };

        // Check for duplicates in the database
        const conditions = [];
        const params = [];

        // Add conditions for each field that needs to be checked
        if (isValidValue(phone_no)) {
            conditions.push('(phone_no = ? AND phone_no IS NOT NULL AND phone_no != "")');
            params.push(phone_no);
        }
        if (isValidValue(email_id)) {
            conditions.push('(email_id = ? AND email_id IS NOT NULL AND email_id != "")');
            params.push(email_id);
        }

        if (conditions.length > 0) {
            const [existRecords] = await connection.query(`
                SELECT phone_no, email_id
                FROM customers 
                WHERE company_id = ? AND (${conditions.join(' OR ')})
            `, [req.user.company_id, ...params]);

            // Check which fields are in use and push appropriate messages
            if (existRecords.length > 0) {
                existRecords.forEach(record => {
                    if (isValidValue(phone_no) && isValidValue(record.phone_no) && record.phone_no === phone_no) {
                        errors.push('This phone number is already registered in our system');
                    }
                    if (isValidValue(email_id) && isValidValue(record.email_id) && record.email_id === email_id) {
                        errors.push('This email ID is already registered in our system');
                    }
                });
            }
        }

        // If there are validation errors, return them
        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }

        // Validate all fields
        const validatedData = {
            first_name: validateVarchar(first_name, 100),
            last_name: validateVarchar(last_name, 100),
            company_name: validateVarchar(company_name, 200),
            phone_no: validateMobileNumber(phone_no),
            email_id: validateVarchar(email_id, 50),
            address: validateVarchar(address, 300),
            lead_source: validateEnum(lead_source, VALID_LEAD_SOURCES, null),
            call_date_time: formatMySQLDateTime(call_date_time),
            call_status: validateEnum(call_status, VALID_CALL_STATUS, null),
            call_outcome: validateEnum(call_outcome, VALID_CALL_OUTCOMES, null),
            call_recording: validateVarchar(call_recording, 300),
            product: validateVarchar(product, 200),
            budget: validateVarchar(budget, 100),
            decision_making: validateEnum(decision_making, VALID_DECISION_MAKING, null),
            decision_time: validateEnum(decision_time, VALID_DECISION_TIME, null),
            lead_stage: validateEnum(lead_stage, VALID_LEAD_STAGE, null),
            next_follow_up: formatMySQLDateTime(next_follow_up),
            reminder_notes: comment, // Using comment as reminder_notes
            priority_level: validateEnum(priority_level, VALID_PRIORITY_LEVEL, null),
            customer_category: validateEnum(customer_category, VALID_CUSTOMER_CATEGORY, null),
            tags_labels: validateEnum(tags_labels, VALID_TAGS_LABELS, null),
            communcation_channel: validateEnum(communcation_channel, VALID_COMMUNICATION_CHANNEL, null),
            deal_value: validateVarchar(deal_value, 30),
            conversion_status: validateEnum(conversion_status, VALID_CONVERSION_STATUS, null),
            customer_history: validateEnum(customer_history, VALID_CUSTOMER_HISTORY, null),
            comment: validateVarchar(comment, 1000),
            scheduled_at: formatMySQLDateTime(scheduled_at) || formatMySQLDateTime(new Date()),
            agent_name: validateVarchar(agent_name || req.user.username, 100)
        };

        // Get the latest C_unique_id
        const [lastIdResult] = await connection.query(
            'SELECT C_unique_id FROM customers ORDER BY CAST(SUBSTRING(C_unique_id, 4) AS UNSIGNED) DESC LIMIT 1'
        );

        const lastId = lastIdResult[0]?.C_unique_id || 'FF_0';
        const lastNumericPart = parseInt(lastId.split('_')[1]) || 0;
        const nextUniqueId = `FF_${lastNumericPart + 1}__1`;

        // --- Dynamic Fields Handling ---
        // Fetch all columns from the table to identify custom fields
        const [dbColumns] = await connection.query('SHOW COLUMNS FROM customers');
        const dbColumnNames = dbColumns.map(c => c.Field);

        // Define system/ignored fields that shouldn't be auto-mapped from body
        const ignoredFields = [
            'id', 'created_at', 'updated_at', 'last_updated',
            'company_id', 'C_unique_id', // Handled explicitly
            ...Object.keys(validatedData) // Already validated standard fields
        ];

        // Add custom fields from req.body to validatedData if they exist in DB columns
        dbColumnNames.forEach(col => {
            if (!ignoredFields.includes(col) && req.body[col] !== undefined) {
                // We accept the value as-is for custom fields (or add basic sanitization if needed)
                // For now, passing raw value is acceptable as utilizing parameterized queries prevents SQLi
                validatedData[col] = req.body[col];
            }
        });

        // Add system managed fields to data object for query construction
        validatedData.company_id = req.user.company_id;
        validatedData.C_unique_id = nextUniqueId;

        // Construct dynamic Insert SQL
        const insertColumns = Object.keys(validatedData);
        const insertValues = Object.values(validatedData);

        const sql = `INSERT INTO customers (${insertColumns.join(', ')}) 
                     VALUES (${insertColumns.map(() => '?').join(', ')})`;

        const values = insertValues;

        // Begin transaction
        await connection.beginTransaction();

        // Insert the record
        const [result] = await connection.query(sql, values);

        // Commit the transaction
        await connection.commit();

        // Return success response
        return res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            customerId: result.insertId,
            C_unique_id: nextUniqueId
        });

    } catch (error) {
        console.error('Error in makeNewRecord:', error);

        // Rollback transaction if it was started
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        // Return error response
        return res.status(500).json({
            success: false,
            message: 'Failed to create customer',
            error: error.message
        });
    } finally {
        // Release connection if it was acquired
        if (connection) {
            try {
                connection.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
};

// Function to check for duplicates
const checkDuplicates = async (connection, phone_no, email_id, first_name) => {
    const duplicates = {
        exists: false,
        phone_no_exists: false,
        email_exists: false,
        existing_record: null
    };

    if (phone_no) {
        const [phoneResults] = await connection.query(
            'SELECT * FROM customers WHERE phone_no = ?',
            [phone_no]
        );
        if (phoneResults.length > 0) {
            duplicates.exists = true;
            duplicates.phone_no_exists = true;
            duplicates.existing_record = phoneResults[0];
        }
    }

    if (email_id && !duplicates.exists) {
        const [emailResults] = await connection.query(
            'SELECT * FROM customers WHERE email_id = ?',
            [email_id]
        );
        if (emailResults.length > 0) {
            duplicates.exists = true;
            duplicates.email_exists = true;
            duplicates.existing_record = emailResults[0];
        }
    }

    // Check for duplicates based on phone number AND first name
    if (phone_no && first_name && !duplicates.exists) {
        const [phoneResults] = await connection.query(
            'SELECT * FROM customers WHERE phone_no = ? AND first_name = ?',
            [phone_no, first_name]
        );
        if (phoneResults.length > 0) {
            duplicates.exists = true;
            duplicates.phone_no_exists = true;
            duplicates.existing_record = phoneResults[0];
        }
    }

    // Check for duplicates based on email AND first name
    if (email_id && first_name && !duplicates.exists) {
        const [emailResults] = await connection.query(
            'SELECT * FROM customers WHERE email_id = ? AND first_name = ?',
            [email_id, first_name]
        );
        if (emailResults.length > 0) {
            duplicates.exists = true;
            duplicates.email_exists = true;
            duplicates.existing_record = emailResults[0];
        }
    }

    return duplicates;
};

// Function to handle duplicate records
const handleDuplicate = async (connection, customerData, existingRecord, action) => {
    try {
        if (action === 'skip') {
            return { success: false, message: 'Record skipped due to duplicate' };
        }

        if (action === 'replace') {
            // Get column names for update
            const [columns] = await connection.query('SHOW COLUMNS FROM customers');
            const columnNames = columns.map(col => col.Field)
                .filter(name => !['id', 'C_unique_id', 'date_created', 'last_updated', 'scheduled_at'].includes(name));

            const updateQuery = `UPDATE customers SET ${columnNames.map(col => `${col} = ?`).join(', ')
                }, last_updated = NOW() WHERE id = ?`;

            const values = columnNames.map(colName => {
                return customerData[colName] || null;
            });

            // Add WHERE clause value
            values.push(existingRecord.id);

            // Execute the update
            await connection.query(updateQuery, values);

            // Return the existing record with its C_unique_id preserved
            customerData.C_unique_id = existingRecord.C_unique_id;
            return { success: true, data: customerData, replaced: true };
        }

        if (action === 'append') {
            // Get the base C_unique_id from the existing record
            const baseId = existingRecord.C_unique_id.split('__')[0];

            // Find all records with this base ID to determine next suffix
            const [suffixResults] = await connection.query(
                'SELECT C_unique_id FROM customers WHERE C_unique_id LIKE ? OR C_unique_id = ? ORDER BY CAST(SUBSTRING_INDEX(C_unique_id, "__", -1) AS UNSIGNED) DESC LIMIT 1',
                [`${baseId}__%`, baseId]
            );

            let newCUniqueId;
            if (suffixResults.length === 0 || suffixResults[0].C_unique_id === baseId) {
                // No suffixed records exist yet
                newCUniqueId = `${baseId}__1`;
            } else {
                // Get the highest suffix and increment
                const currentId = suffixResults[0].C_unique_id;
                const currentSuffix = parseInt(currentId.split('__')[1]);
                newCUniqueId = `${baseId}__${currentSuffix + 1}`;
            }

            customerData.C_unique_id = newCUniqueId;
            return { success: true, data: customerData };
        }

        return { success: false, message: 'Invalid duplicate action' };
    } catch (error) {
        console.error('Error handling duplicate:', error);
        return { success: false, message: error.message };
    }
};

// Create new customer
export const createCustomer = async (req, res) => {
    let connection;
    try {
        // Check if user exists in request
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();
        await connection.beginTransaction();

        let customerData = req.body;
        const duplicateAction = req.body.duplicateAction || 'skip'; // Get duplicate action from request

        // Check for duplicates
        const duplicates = await checkDuplicates(connection, customerData.phone_no, customerData.email_id, customerData.first_name);

        if (duplicates.exists) {
            if (duplicateAction === 'prompt') {
                // Return duplicate info to frontend for user decision
                return res.status(409).json({
                    duplicate: true,
                    phone_no_exists: duplicates.phone_no_exists,
                    email_exists: duplicates.email_exists,
                    existing_record: duplicates.existing_record
                });
            }

            // Handle duplicate based on specified action
            const handleResult = await handleDuplicate(connection, customerData, duplicates.existing_record, duplicateAction);

            if (!handleResult.success) {
                return res.status(400).json({ message: handleResult.message });
            }

            // If the record was replaced, we don't need to insert a new one
            if (handleResult.replaced) {
                await connection.commit();
                return res.json({
                    success: true,
                    message: 'Customer updated successfully',
                    customerId: duplicates.existing_record.id,
                    C_unique_id: duplicates.existing_record.C_unique_id
                });
            }

            customerData = handleResult.data;
        }

        // Get the latest C_unique_id (only if not handling a duplicate)
        let nextId;
        if (!duplicates.exists || duplicateAction === 'skip') {
            const [lastIdResult] = await connection.query(
                'SELECT C_unique_id FROM customers ORDER BY CAST(SUBSTRING(C_unique_id, 4) AS UNSIGNED) DESC LIMIT 1'
            );

            const lastId = lastIdResult[0]?.C_unique_id || 'FF_0';
            const lastNumericPart = parseInt(lastId.split('_')[1]) || 0;
            nextId = `FF_${lastNumericPart + 1}`;
        } else {
            nextId = customerData.C_unique_id; // Use the ID generated by handleDuplicate
        }

        // --- Dynamic Fields Handling ---
        // Fetch all columns from the table to identify which fields exist
        const [dbColumns] = await connection.query('SHOW COLUMNS FROM customers');
        const dbColumnNames = dbColumns.map(c => c.Field);

        // Define system/ignored fields that shouldn't be auto-mapped from body
        const ignoredFields = [
            'id', 'created_at', 'updated_at', 'last_updated'
        ];

        // Build the data object with all available fields
        const insertData = {
            company_id: req.user.company_id,
            C_unique_id: nextId
        };

        // Add all fields from customerData that exist in the database
        dbColumnNames.forEach(col => {
            if (!ignoredFields.includes(col) && col !== 'company_id' && col !== 'C_unique_id') {
                if (customerData[col] !== undefined) {
                    insertData[col] = customerData[col] || null;
                } else {
                    // Set default for agent_name if not provided
                    if (col === 'agent_name') {
                        insertData[col] = req.user.username;
                    }
                }
            }
        });

        // Construct dynamic INSERT SQL
        const insertColumns = Object.keys(insertData);
        const insertValues = Object.values(insertData);

        const sql = `INSERT INTO customers (${insertColumns.join(', ')}) 
                     VALUES (${insertColumns.map(() => '?').join(', ')})`;

        // Insert new customer
        const [result] = await connection.query(sql, insertValues);


        await connection.commit();

        res.json({
            success: true,
            message: 'Customer created successfully',
            customerId: result.insertId,
            C_unique_id: nextId
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error creating customer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create customer',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};