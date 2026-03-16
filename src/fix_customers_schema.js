
import connectDB from './db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const fixCustomersSchema = async () => {
    let pool;
    try {
        console.log('Connecting to database...');
        pool = connectDB();
        const connection = await pool.getConnection();
        console.log('Connected.');

        const columnsToAdd = [
            { name: 'department_id', type: 'INT NULL' },
            { name: 'sub_department_id', type: 'INT NULL' },
            { name: 'team_id', type: 'INT NULL' },
            { name: 'scheduled_at', type: 'DATETIME NULL' }
        ];

        for (const col of columnsToAdd) {
            console.log(`Checking customers table for ${col.name}...`);
            const [cols] = await connection.query(`SHOW COLUMNS FROM customers LIKE '${col.name}'`);
            if (cols.length === 0) {
                console.log(`Adding ${col.name} column...`);
                await connection.query(`ALTER TABLE customers ADD COLUMN ${col.name} ${col.type}`);
                console.log(`${col.name} added.`);
            } else {
                console.log(`${col.name} column exists.`);
            }
        }

        connection.release();
        console.log('Customers schema fix completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error fixing customers schema:', error);
        process.exit(1);
    }
};

fixCustomersSchema();
