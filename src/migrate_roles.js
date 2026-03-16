
import connectDB from './db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const migrateRoles = async () => {
    let pool;
    try {
        console.log('Connecting to database...');
        pool = connectDB();
        const connection = await pool.getConnection();
        console.log('Connected.');

        // 1. Add new roles if they don't exist
        console.log('Adding new roles...');
        const newRoles = ['dept_admin', 'sub_dept_admin'];
        for (const role of newRoles) {
            await connection.query('INSERT IGNORE INTO roles (role_name) VALUES (?)', [role]);
        }

        // 2. Map existing 'admin' to 'dept_admin'
        console.log('Migrating admin users to dept_admin...');
        const [adminRole] = await connection.query("SELECT id FROM roles WHERE role_name = 'admin'");
        const [deptAdminRole] = await connection.query("SELECT id FROM roles WHERE role_name = 'dept_admin'");

        if (adminRole.length > 0 && deptAdminRole.length > 0) {
            const [updateResult] = await connection.query(
                "UPDATE users SET role_id = ? WHERE role_id = ?",
                [deptAdminRole[0].id, adminRole[0].id]
            );
            console.log(`Migrated ${updateResult.affectedRows} users to dept_admin.`);
        }

        connection.release();
        console.log('Role migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error migrating roles:', error);
        process.exit(1);
    }
};

migrateRoles();
