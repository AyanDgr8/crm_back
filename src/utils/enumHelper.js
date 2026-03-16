// src/utils/enumHelper.js

/**
 * Fetches enum field definitions from the database dynamically
 * @param {Object} connection - MySQL connection object
 * @param {string} tableName - Name of the table (default: 'customers')
 * @returns {Promise<Object>} - Object mapping field names to their enum values
 */
export const getEnumValues = async (connection, tableName = 'customers') => {
    try {
        const [columns] = await connection.query(`
            SELECT COLUMN_NAME, COLUMN_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ? 
            AND DATA_TYPE = 'enum'
        `, [tableName]);

        const enumMap = {};

        columns.forEach(col => {
            // Parse "enum('val1','val2','val3')" to ['val1', 'val2', 'val3']
            const matches = col.COLUMN_TYPE.match(/'([^']+)'/g);
            if (matches) {
                enumMap[col.COLUMN_NAME] = matches.map(m => m.replace(/'/g, ''));
            }
        });

        return enumMap;
    } catch (error) {
        console.error('Error fetching enum values:', error);
        return {};
    }
};

/**
 * Fetches all column definitions from the database
 * @param {Object} connection - MySQL connection object
 * @param {string} tableName - Name of the table (default: 'customers')
 * @returns {Promise<Array>} - Array of column definitions
 */
export const getAllColumns = async (connection, tableName = 'customers') => {
    try {
        const [columns] = await connection.query(`
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                COLUMN_TYPE,
                IS_NULLABLE,
                COLUMN_DEFAULT,
                COLUMN_KEY
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
        `, [tableName]);

        return columns;
    } catch (error) {
        console.error('Error fetching columns:', error);
        return [];
    }
};
