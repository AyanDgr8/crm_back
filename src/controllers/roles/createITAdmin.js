// src/controllers/roles/createITAdmin.js

import bcrypt from 'bcrypt';
import connectDB from '../../db/index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const createITAdmin = async () => {
    // IT Admin credentials
    const username = 'Prashant Rajput';
    const email = 'prashant@multycomm.com';
    const plainPassword = 'Ayan1012';
    
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        
        // Get database connection from the pool
        const pool = connectDB();
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Get IT Admin role ID
            const [roleRows] = await connection.query(
                'SELECT id FROM roles WHERE role_name = ?',
                ['it_admin']
            );

            if (roleRows.length === 0) {
                throw new Error('IT Admin role not found');
            }

            // Create or update the IT Admin user
            const [userResult] = await connection.query(
                `INSERT INTO users (username, email, password, role_id)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 password = ?, role_id = ?`,
                [username, email, hashedPassword, roleRows[0].id, hashedPassword, roleRows[0].id]
            );

            // Get user ID
            const userId = userResult.insertId || userResult.id;

            // Get all permissions
            const [permissions] = await connection.query('SELECT id FROM permissions');

            // Assign all permissions to IT Admin
            for (const permission of permissions) {
                await connection.query(
                    `INSERT INTO user_permissions (user_id, permission_id, value)
                     VALUES (?, ?, true)
                     ON DUPLICATE KEY UPDATE value = true`,
                    [userId, permission.id]
                );
            }

            await connection.commit();
            console.log('IT Admin created/updated successfully with all permissions!');

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error creating IT Admin:', error);
    }
};

// Run the function
createITAdmin();
