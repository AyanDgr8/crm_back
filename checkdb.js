// checkdb.js — Run with: node checkdb.js
// Verifies the DB has every table, column, role, and permission
// required by the full SQL migration stack.

import connectDB from './src/db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const REQUIRED_TABLES = [
    'companies',
    'company_licenses',
    'permissions',
    'roles',
    'teams',
    'users',
    'departments',
    'sub_departments',
    'admin_departments',
    'user_permissions',
    'customers',
    'updates_customer',
    'scheduler',
    'login_history',
    'lead_distribution_rules',      // lead_distribution_migration.sql
    'delete_approval_requests',     // v17b_lead_delete_migration.sql
    'notifications',                // v17b_lead_delete_migration.sql
];

const REQUIRED_COLUMNS = {
    users: [
        'id', 'company_id', 'username', 'email', 'password',
        'team_id', 'role_id', 'is_active', 'is_company_admin',
        'phone_no',                  // add_user_fields.sql
        'address',                   // add_user_fields.sql
        'lead_weight',               // lead_distribution_migration.sql
        'last_assigned_at',          // lead_distribution_migration.sql
        'requires_delete_approval',  // v17b_lead_delete_migration.sql
    ],
    customers: [
        'id', 'company_id', 'C_unique_id', 'first_name', 'phone_no',
        'agent_name', 'team_id',     // team_id needed by deleteTeam check
        'department_id', 'sub_department_id', 'assigned_to',
    ],
    teams: [
        'id', 'company_id', 'team_name', 'department_id',
        'sub_department_id', 'created_by',
    ],
    delete_approval_requests: [
        'id', 'requester_id', 'customer_id', 'customer_name',
        'approver_id', 'status', 'company_id', 'created_at', 'resolved_at',
    ],
    notifications: [
        'id', 'user_id', 'type', 'title', 'message',
        'ref_id', 'company_id', 'is_read', 'created_at',
    ],
};

const REQUIRED_ROLES = [
    'super_admin', 'business_head', 'team_leader',
    'user', 'mis', 'admin', 'dept_admin', 'sub_dept_admin',
];

const REQUIRED_PERMISSIONS = [
    'upload_document', 'download_data', 'create_customer',
    'edit_customer', 'delete_customer', 'view_customer',
    'view_team_customers', 'view_assigned_customers',
    'manage_users', 'manage_teams', 'view_reports',
];

// ─────────────────────────────────────────────────────────────────────────────

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

let issues = 0;

function ok(msg) { console.log(`  ${PASS}  ${msg}`); }
function fail(msg) { console.log(`  ${FAIL}  ${msg}`); issues++; }
function warn(msg) { console.log(`  ${WARN} ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────────

const checkDB = async () => {
    console.log('\n═══════════════════════════════════════════════════');
    console.log('  CRM Database Health Check');
    console.log('═══════════════════════════════════════════════════\n');

    const pool = connectDB();
    const conn = await pool.getConnection();

    try {
        // ── 1. Tables ──────────────────────────────────────────────────────
        console.log('── Tables ──────────────────────────────────────────');
        const [tables] = await conn.query(
            `SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()`
        );
        const tableNames = tables.map(t => t.TABLE_NAME.toLowerCase());

        for (const tbl of REQUIRED_TABLES) {
            if (tableNames.includes(tbl.toLowerCase())) {
                ok(tbl);
            } else {
                fail(`MISSING TABLE: ${tbl}`);
            }
        }

        // ── 2. Columns ─────────────────────────────────────────────────────
        console.log('\n── Columns ─────────────────────────────────────────');
        const [allCols] = await conn.query(
            `SELECT TABLE_NAME, COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()`
        );

        const colMap = {};
        for (const { TABLE_NAME, COLUMN_NAME } of allCols) {
            const t = TABLE_NAME.toLowerCase();
            if (!colMap[t]) colMap[t] = new Set();
            colMap[t].add(COLUMN_NAME.toLowerCase());
        }

        for (const [tbl, cols] of Object.entries(REQUIRED_COLUMNS)) {
            if (!tableNames.includes(tbl.toLowerCase())) {
                fail(`Table '${tbl}' missing — skipping column check`);
                continue;
            }
            for (const col of cols) {
                if (colMap[tbl.toLowerCase()]?.has(col.toLowerCase())) {
                    ok(`${tbl}.${col}`);
                } else {
                    fail(`MISSING COLUMN: ${tbl}.${col}`);
                }
            }
        }

        // ── 3. Roles ───────────────────────────────────────────────────────
        console.log('\n── Roles ───────────────────────────────────────────');
        if (tableNames.includes('roles')) {
            const [roleRows] = await conn.query('SELECT role_name FROM roles');
            const existingRoles = roleRows.map(r => r.role_name);
            for (const role of REQUIRED_ROLES) {
                if (existingRoles.includes(role)) {
                    ok(role);
                } else {
                    fail(`MISSING ROLE: ${role}`);
                }
            }
        } else {
            fail('roles table missing — cannot check roles');
        }

        // ── 4. Permissions ─────────────────────────────────────────────────
        console.log('\n── Permissions ─────────────────────────────────────');
        if (tableNames.includes('permissions')) {
            const [permRows] = await conn.query('SELECT permission_name FROM permissions');
            const existingPerms = permRows.map(p => p.permission_name);
            for (const perm of REQUIRED_PERMISSIONS) {
                if (existingPerms.includes(perm)) {
                    ok(perm);
                } else {
                    fail(`MISSING PERMISSION: ${perm}`);
                }
            }
        } else {
            fail('permissions table missing — cannot check permissions');
        }

        // ── 5. Super Admin user ────────────────────────────────────────────
        console.log('\n── Super Admin ─────────────────────────────────────');
        if (tableNames.includes('users') && tableNames.includes('roles')) {
            const [saRows] = await conn.query(
                `SELECT u.id, u.username, u.email, u.is_active
                 FROM users u
                 JOIN roles r ON u.role_id = r.id
                 WHERE r.role_name = 'super_admin'`
            );
            if (saRows.length > 0) {
                for (const sa of saRows) {
                    ok(`Super admin found: ${sa.username} <${sa.email}> (active=${sa.is_active})`);
                }
            } else {
                warn('No super_admin user found — run createSuperAdmin.js script');
            }
        }

        // ── 6. Foreign key integrity check on teams ────────────────────────
        console.log('\n── Foreign Key Integrity ───────────────────────────');
        if (tableNames.includes('users') && tableNames.includes('teams')) {
            const [orphanUsers] = await conn.query(
                `SELECT COUNT(*) as cnt FROM users
                 WHERE team_id IS NOT NULL
                 AND team_id NOT IN (SELECT id FROM teams)`
            );
            if (orphanUsers[0].cnt > 0) {
                fail(`${orphanUsers[0].cnt} user(s) have a team_id pointing to a non-existent team`);
            } else {
                ok('All users.team_id values are valid');
            }
        }

        if (tableNames.includes('customers') && tableNames.includes('teams')
            && colMap['customers']?.has('team_id')) {
            const [orphanLeads] = await conn.query(
                `SELECT COUNT(*) as cnt FROM customers
                 WHERE team_id IS NOT NULL
                 AND team_id NOT IN (SELECT id FROM teams)`
            );
            if (orphanLeads[0].cnt > 0) {
                fail(`${orphanLeads[0].cnt} customer(s) have a team_id pointing to a non-existent team`);
            } else {
                ok('All customers.team_id values are valid');
            }
        }

        // ── Summary ────────────────────────────────────────────────────────
        console.log('\n═══════════════════════════════════════════════════');
        if (issues === 0) {
            console.log(`  ${PASS}  All checks passed — database is healthy!\n`);
        } else {
            console.log(`  ${FAIL}  ${issues} issue(s) found.\n`);
            console.log('  Fix guide:');
            console.log('    1. Re-run schema_multitenant.sql on a fresh DB');
            console.log('    2. Run lead_distribution_migration.sql');
            console.log('    3. Run role_separation_migration.sql');
            console.log('    4. Run v17b_lead_delete_migration.sql');
            console.log('    5. Run add_user_fields.sql');
            console.log('    6. Run: node src/controllers/roles/createSuperAdmin.js\n');
        }
        console.log('═══════════════════════════════════════════════════\n');

    } finally {
        conn.release();
        process.exit(issues > 0 ? 1 : 0);
    }
};

checkDB().catch(err => {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
});
