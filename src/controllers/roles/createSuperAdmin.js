// src/controllers/roles/createSuperAdmin.js
//
// Run with:  node src/controllers/roles/createSuperAdmin.js
//
// Supports the full schema stack:
//   1. schema_multitenant.sql          (base tables)
//   2. role_separation_migration.sql   (dept_admin, sub_dept_admin roles)
//   3. add_user_fields.sql             (phone_no, address columns)
//   4. lead_distribution_migration.sql (lead_weight, last_assigned_at columns)
//   5. v17b_lead_delete_migration.sql  (requires_delete_approval column)

import bcrypt from 'bcrypt';
import connectDB from '../../db/index.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../../.env') });

const createSuperAdmin = async () => {
    // ── Super Admin credentials ──────────────────────────────────────────────
    const username = 'Ayan Khan';
    const email = 'ayan@multycomm.com';
    const plainPassword = 'Ayan1012';
    // ────────────────────────────────────────────────────────────────────────

    try {
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const pool = connectDB();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // ── 1. Get super_admin role ID ───────────────────────────────────
            const [roleRows] = await connection.query(
                'SELECT id FROM roles WHERE role_name = ?',
                ['super_admin']
            );

            if (roleRows.length === 0) {
                throw new Error(
                    'super_admin role not found. Run schema_multitenant.sql first.'
                );
            }

            const roleId = roleRows[0].id;

            // ── 2. Check which optional columns exist on users table ─────────
            const [columns] = await connection.query(`
                SELECT COLUMN_NAME
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME   = 'users'
            `);
            const colNames = columns.map(c => c.COLUMN_NAME);

            const has = (col) => colNames.includes(col);

            // ── 3. Build INSERT dynamically based on existing columns ────────
            //   company_id           = NULL  (super_admin has no company)
            //   is_active            = true  (from schema_multitenant)
            //   requires_delete_approval = 0 (from v17b — super admin never needs approval)
            //   lead_weight          = 1     (from lead_distribution_migration)
            //   last_assigned_at     = NULL  (from lead_distribution_migration)
            //   phone_no / address   = NULL  (from add_user_fields)

            let insertCols = ['username', 'email', 'password', 'role_id', 'company_id', 'is_active'];
            let insertVals = [username, email, hashedPassword, roleId, null, true];
            let updateClauses = [
                'username  = VALUES(username)',
                'password  = VALUES(password)',
                'role_id   = VALUES(role_id)',
                'is_active = true'
            ];

            if (has('requires_delete_approval')) {
                insertCols.push('requires_delete_approval');
                insertVals.push(0);
                updateClauses.push('requires_delete_approval = 0');
            }
            if (has('lead_weight')) {
                insertCols.push('lead_weight');
                insertVals.push(1);
            }

            const placeholders = insertVals.map(() => '?').join(', ');
            const colList = insertCols.join(', ');
            const updateStr = updateClauses.join(',\n                 ');

            await connection.query(
                `INSERT INTO users (${colList})
                 VALUES (${placeholders})
                 ON DUPLICATE KEY UPDATE
                 ${updateStr}`,
                insertVals
            );

            // ── 4. Get the actual user ID (insertId = 0 on UPDATE) ──────────
            const [existingUser] = await connection.query(
                'SELECT id FROM users WHERE email = ?',
                [email]
            );

            if (existingUser.length === 0) {
                throw new Error('User was not created — check for constraint errors.');
            }

            const userId = existingUser[0].id;

            // ── 5. Get all permissions and assign them to super admin ────────
            const [permissions] = await connection.query('SELECT id FROM permissions');

            if (permissions.length === 0) {
                console.warn('⚠️  No permissions found. Run schema_multitenant.sql seed data first.');
            }

            for (const permission of permissions) {
                await connection.query(
                    `INSERT INTO user_permissions (user_id, permission_id, value)
                     VALUES (?, ?, true)
                     ON DUPLICATE KEY UPDATE value = true`,
                    [userId, permission.id]
                );
            }

            await connection.commit();

            console.log('\n✅ Super Admin created/updated successfully!\n');
            console.log(`   Username              : ${username}`);
            console.log(`   Email                 : ${email}`);
            console.log(`   Password              : ${plainPassword}  (stored hashed)`);
            console.log(`   User ID               : ${userId}`);
            console.log(`   company_id            : NULL (platform-level admin)`);
            console.log(`   Permissions assigned  : ${permissions.length}`);
            console.log('');

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('\n❌ Error creating Super Admin:', error.message);
        process.exit(1);
    }

    process.exit(0);
};

createSuperAdmin();
