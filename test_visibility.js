
import mysql from 'mysql2/promise';

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'Ayan@1012',
    database: 'knowledgeBase_multitenant'
};

const testAll = async () => {
    const connection = await mysql.createConnection(dbConfig);

    // Simulate req.user for Heena (ID 53, Team 15, Role 'team_leader')
    const user = {
        userId: 53,
        username: 'heena',
        role: 'team_leader',
        team_id: 15,
        company_id: 8
    };

    console.log(`--- Testing Visibility and Search for ${user.username} (Role: ${user.role}) ---`);

    // 1. Fetch real permissions
    const [permissions] = await connection.query(
        `SELECT p.permission_name 
       FROM permissions p 
       JOIN user_permissions up ON p.id = up.permission_id 
       WHERE up.user_id = ? AND up.value = true`,
        [user.userId]
    );
    const userPermissions = permissions.map(p => p.permission_name);
    console.log('Real permissions from DB:', userPermissions);

    // 2. Replicate NEW getAllCustomers logic
    const getSql = (perms) => {
        let sql, params;
        if (perms.includes('view_customer')) {
            sql = 'SELECT COUNT(*) as count FROM customers WHERE company_id = ?';
            params = [user.company_id];
        } else if (perms.includes('view_team_customers') && !perms.includes('view_assigned_customers')) {
            sql = 'SELECT COUNT(*) as count FROM customers WHERE team_id = ? AND company_id = ?';
            params = [user.team_id, user.company_id];
        } else if (perms.includes('view_assigned_customers')) {
            sql = 'SELECT COUNT(*) as count FROM customers WHERE (agent_name = ? OR assigned_to = ?) AND company_id = ?';
            params = [user.username, user.userId, user.company_id];
        } else {
            sql = 'SELECT 0 as count';
            params = [];
        }
        return { sql, params };
    };

    // 3. Replicate NEW searchCustomers logic
    const getSearchSql = (perms, query) => {
        let sql, params;
        const searchParam = `%${query}%`;
        let scopeWhere = '';
        let scopeParams = [];

        if (perms.includes('view_customer')) {
            scopeWhere = 'company_id = ?';
            scopeParams = [user.company_id];
        } else if (perms.includes('view_team_customers')) {
            scopeWhere = 'team_id = ? AND company_id = ?';
            scopeParams = [user.team_id, user.company_id];
        } else if (perms.includes('view_assigned_customers')) {
            scopeWhere = '(agent_name = ? OR assigned_to = ?) AND company_id = ?';
            scopeParams = [user.username, user.userId, user.company_id];
        } else {
            return { sql: 'SELECT 0 as count', params: [] };
        }

        sql = `SELECT COUNT(*) as count FROM customers WHERE ${scopeWhere} AND (first_name LIKE ?)`;
        params = [...scopeParams, searchParam];
        return { sql, params };
    };

    const run = async (perms, label) => {
        const { sql: vSql, params: vParams } = getSql(perms);
        const [vResults] = await connection.query(vSql, vParams);

        const { sql: sSql, params: sParams } = getSearchSql(perms, 'e'); // Search for any lead with 'e'
        const [sResults] = await connection.query(sSql, sParams);

        console.log(`[${label}] Visibility Count: ${vResults[0].count} | Search Count ('e'): ${sResults[0].count}`);
    };

    await run(userPermissions, 'BOTH CHECKED');
    await run(userPermissions.filter(p => p !== 'view_team_customers'), 'ASSIGNED ONLY');
    await run(userPermissions.filter(p => p !== 'view_assigned_customers'), 'TEAM ONLY');

    await connection.end();
};

testAll().catch(console.error);
