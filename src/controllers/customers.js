// src/controllers/customers.js

import connectDB from '../db/index.js';

export const searchCustomers = async (req, res) => {
  const { query } = req.query;
  const user = req.user; // Get the current user from the request

  try {
    // Check if user exists in request
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const connection = await connectDB();
    let sql;
    let params;

    // Ensure user role exists, default to 'User' if undefined
    const userRole = req.user.role || 'User';

    const searchParam = `%${query}%`;
    const searchFields = [
      'c.first_name', 'c.last_name', 'c.company_name', 'c.phone_no',
      'c.email_id', 'c.address', 'c.lead_source', 'c.call_status',
      'c.call_outcome', 'c.product', 'c.budget', 'c.decision_making',
      'c.decision_time', 'c.lead_stage', 'c.agent_name', 'c.priority_level',
      'c.customer_category', 'c.tags_labels', 'c.communcation_channel', 'c.deal_value',
      'c.conversion_status', 'c.customer_history', 'c.agent_name', 'c.C_unique_id',
      'c.comment', 'c.last_updated', 'c.id'
    ];

    const searchConditions = searchFields.map(field => `${field} LIKE ?`).join(' OR ');

    // Build the base query with role-based access control
    if (userRole === 'super_admin') {
      // Super admin can search ALL customers from ALL companies
      sql = `
        SELECT c.* FROM customers c
        WHERE ${searchConditions}
      `;
      params = searchFields.map(() => searchParam);
    } else if (userRole === 'business_head') {
      // Business Head can search ALL customers from THEIR company
      sql = `
        SELECT c.* FROM customers c
        WHERE c.company_id = ? AND (${searchConditions})
      `;
      params = [req.user.company_id, ...searchFields.map(() => searchParam)];
    } else if (userRole === 'dept_admin' || userRole === 'sub_dept_admin' || userRole === 'admin') {
      // Dept Admin / Sub-Dept Admin can search within their assigned departments/sub-departments
      const [adminDepts] = await connection.query(
        `SELECT DISTINCT department_id, sub_department_id FROM admin_departments WHERE user_id = ?`,
        [req.user.userId]
      );

      if (adminDepts.length === 0) {
        return res.json({ success: true, data: [], count: 0 });
      }

      const assignedDeptIds = [...new Set(adminDepts.map(d => d.department_id))];
      const assignedSubDeptIds = adminDepts.map(d => d.sub_department_id).filter(id => id !== null);

      let scopeWhere = '';
      let scopeParams = [];

      if (userRole === 'sub_dept_admin') {
        if (assignedSubDeptIds.length > 0) {
          const placeholders = assignedSubDeptIds.map(() => '?').join(',');
          scopeWhere = `c.sub_department_id IN (${placeholders})`;
          scopeParams = [...assignedSubDeptIds];
        } else {
          return res.json({ success: true, data: [], count: 0 });
        }
      } else {
        const placeholders = assignedDeptIds.map(() => '?').join(',');
        scopeWhere = `c.department_id IN (${placeholders})`;
        scopeParams = [...assignedDeptIds];
      }

      sql = `
        SELECT c.* FROM customers c
        WHERE c.company_id = ? AND (${scopeWhere}) AND (${searchConditions})
      `;
      params = [req.user.company_id, ...scopeParams, ...searchFields.map(() => searchParam)];
    } else if (userRole === 'team_leader' || userRole === 'user') {
      // Team Leader / User search within their permitted scope
      const [permissions] = await connection.query(
        `SELECT p.permission_name FROM permissions p 
         JOIN user_permissions up ON p.id = up.permission_id 
         WHERE up.user_id = ? AND up.value = true`,
        [req.user.userId]
      );
      const userPermissions = permissions.map(p => p.permission_name);

      let scopeWhere = '';
      let scopeParams = [];

      if (userPermissions.includes('view_customer')) {
        // Full company access
        scopeWhere = 'c.company_id = ?';
        scopeParams = [req.user.company_id];
      } else if (userPermissions.includes('view_team_customers')) {
        // Team access
        scopeWhere = 'c.team_id = ? AND c.company_id = ?';
        scopeParams = [req.user.team_id, req.user.company_id];
      } else if (userPermissions.includes('view_assigned_customers')) {
        // Assigned only access
        scopeWhere = '(c.agent_name = ? OR c.assigned_to = ?) AND c.company_id = ?';
        scopeParams = [req.user.username, req.user.userId, req.user.company_id];
      } else {
        return res.json({ success: true, data: [], count: 0 });
      }

      sql = `
        SELECT c.* FROM customers c
        WHERE ${scopeWhere} AND (${searchConditions})
      `;
      params = [...scopeParams, ...searchFields.map(() => searchParam)];
    } else {
      return res.status(403).json({ message: 'Unauthorized role' });
    }

    // Add ORDER BY and LIMIT
    sql += ' ORDER BY c.last_updated DESC LIMIT 100';

    const [results] = await connection.execute(sql, params);

    return res.json({
      success: true,
      data: results,
      count: results.length
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ message: 'Error searching customers', error: error.message });
  }
};

// *****************

export const getAllCustomers = async (req, res) => {
  const pool = await connectDB();
  let connection;
  try {
    console.log('Request user:', req.user);

    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    connection = await pool.getConnection();
    let sql;
    let params;

    const userRole = req.user.role;
    console.log('User role in getAllCustomers:', userRole);

    // Get user permissions first
    const [permissions] = await connection.query(
      `SELECT p.permission_name 
       FROM permissions p 
       JOIN user_permissions up ON p.id = up.permission_id 
       WHERE up.user_id = ? AND up.value = true`,
      [req.user.userId]
    );

    const userPermissions = permissions.map(p => p.permission_name);
    console.log('User permissions:', userPermissions);

    // Build query based on user role and permissions
    if (userRole === 'super_admin') {
      // Super admin can see ALL or filter by company/dept/sub-dept
      const { company_id, department_id, sub_department_id } = req.query;
      let where = 'WHERE 1=1';
      params = [];
      if (company_id) { where += ' AND company_id = ?'; params.push(company_id); }
      if (department_id) { where += ' AND department_id = ?'; params.push(department_id); }
      if (sub_department_id) { where += ' AND sub_department_id = ?'; params.push(sub_department_id); }

      sql = `SELECT * FROM customers ${where} ORDER BY last_updated DESC`;
    } else if (userRole === 'business_head') {
      // Business Head sees ALL customers from THEIR company only
      const { department_id, sub_department_id } = req.query;
      let where = 'WHERE company_id = ?';
      params = [req.user.company_id];
      if (department_id) { where += ' AND department_id = ?'; params.push(department_id); }
      if (sub_department_id) { where += ' AND sub_department_id = ?'; params.push(sub_department_id); }
      sql = `SELECT * FROM customers ${where} ORDER BY last_updated DESC`;
    } else if (userRole === 'dept_admin' || userRole === 'sub_dept_admin' || userRole === 'admin') {
      // Dept Admin / Sub-Dept Admin sees customers in their assigned departments only
      const { department_id, sub_department_id: requestedSubDeptId } = req.query;

      const [adminDepts] = await connection.query(
        `SELECT DISTINCT department_id, sub_department_id FROM admin_departments WHERE user_id = ?`,
        [req.user.userId]
      );

      if (adminDepts.length === 0) {
        return res.json({ success: true, data: [], count: 0, role: userRole, permissions: userPermissions });
      }

      const assignedDeptIds = [...new Set(adminDepts.map(d => d.department_id))];
      const assignedSubDeptIds = adminDepts.map(d => d.sub_department_id).filter(id => id !== null);

      let where = `WHERE company_id = ?`;
      params = [req.user.company_id];

      if (userRole === 'sub_dept_admin') {
        if (assignedSubDeptIds.length > 0) {
          const placeholders = assignedSubDeptIds.map(() => '?').join(',');
          where += ` AND sub_department_id IN (${placeholders})`;
          params.push(...assignedSubDeptIds);
        } else {
          return res.json({ success: true, data: [], count: 0 });
        }
      } else {
        const placeholders = assignedDeptIds.map(() => '?').join(',');
        where += ` AND department_id IN (${placeholders})`;
        params.push(...assignedDeptIds);
      }

      if (department_id) { where += ' AND department_id = ?'; params.push(department_id); }
      if (requestedSubDeptId) { where += ' AND sub_department_id = ?'; params.push(requestedSubDeptId); }

      sql = `SELECT * FROM customers ${where} ORDER BY last_updated DESC`;
    } else if (userPermissions.includes('view_customer')) {
      // User has explicit permission to see all company data
      sql = `SELECT * FROM customers WHERE company_id = ? ORDER BY last_updated DESC`;
      params = [req.user.company_id];
    } else if (userPermissions.includes('view_team_customers') && !userPermissions.includes('view_assigned_customers')) {
      // User can see entire team data ONLY (Strictly Team View)
      sql = `SELECT * FROM customers WHERE team_id = ? AND company_id = ? ORDER BY last_updated DESC, id DESC`;
      params = [req.user.team_id, req.user.company_id];
    } else if (userPermissions.includes('view_assigned_customers')) {
      // User/TL sees only their assigned leads (Priority View)
      // Even if they have view_team_customers, if view_assigned_customers is also checked, 
      // we show their personal view for segregation as per user request.
      sql = `SELECT * FROM customers WHERE (agent_name = ? OR assigned_to = ?) AND company_id = ? ORDER BY last_updated DESC`;
      params = [req.user.username, req.user.userId, req.user.company_id];
    } else {
      // Default return empty if no view permissions
      return res.json({ success: true, data: [], count: 0, message: 'No view permissions' });
    }

    console.log('[DEBUG] Final SQL Query:', sql);
    console.log('[DEBUG] SQL Params:', params);
    const [results] = await connection.query(sql, params);
    console.log('[DEBUG] Query Results Count:', results.length);

    res.json({
      success: true,
      data: results,
      count: results.length,
      role: req.user.role,
      permissions: userPermissions
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: error.message,
      details: error.stack
    });
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch (err) {
        console.error('Error releasing connection:', err);
      }
    }
  }
};



// *****************

// Helper function to get available users
const getAvailableUsers = async (connection) => {
  try {
    const [users] = await connection.execute(
      'SELECT username FROM users'
    );
    return users.map(u => u.username);
  } catch (error) {
    console.error('Error getting available users:', error);
    return [];
  }
};

// ***********


export const viewCustomer = async (req, res) => {
  const uniqueId = req.params.uniqueId; // Get the unique customer ID from the request parameters

  try {
    // Check if user exists in request
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const connection = await connectDB();

    // SQL query to retrieve customer details by unique ID with company isolation
    let query;
    let params;

    if (req.user.role === 'super_admin') {
      // Super admin can view any customer from any company
      query = `SELECT * FROM customers WHERE C_unique_id = ? ORDER BY last_updated DESC, id DESC`;
      params = [uniqueId];
    } else {
      // All other users can only view customers from their company
      query = `SELECT * FROM customers WHERE C_unique_id = ? AND company_id = ? ORDER BY last_updated DESC, id DESC`;
      params = [uniqueId, req.user.company_id];
    }

    const [rows] = await connection.execute(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found or access denied' });
    }

    res.status(200).json(rows[0]); // Return the first (and should be only) customer found
  } catch (error) {
    console.error('Error fetching customer details:', error);
    res.status(500).json({ message: 'Failed to fetch customer details' });
  }
};
// ******************


// ***********
// Function to get list of users for agent assignment
export const getUsers = async (req, res) => {
  try {
    // Check if user exists in request
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const connection = await connectDB();
    let query;
    let params = [];

    // If team_leader, only show users from their team within their company
    if (req.user.role === 'team_leader' && req.user.team_id) {
      query = `
                SELECT u.id, u.username, u.role
                FROM users u
                WHERE u.username IS NOT NULL
                AND u.team_id = ?
                AND u.company_id = ?
                ORDER BY u.username
            `;
      params = [req.user.team_id, req.user.company_id];
    } else if (req.user.role === 'super_admin') {
      // Super_Admin can see all users from all companies
      query = `
                SELECT id, username, role
                FROM users 
                WHERE username IS NOT NULL
                ORDER BY username
            `;
    } else {
      // Business Head and other roles see only users from their company
      query = `
                SELECT id, username, role
                FROM users 
                WHERE username IS NOT NULL
                AND company_id = ?
                ORDER BY username
            `;
      params = [req.user.company_id];
    }

    // Execute query and send response
    const [users] = await connection.execute(query, params);
    res.json(users);

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

// New function to assign customer to team
export const assignCustomerToTeam = async (req, res) => {
  let connection;
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const pool = connectDB();
    connection = await pool.getConnection();

    // Check if user has permission to assign customers
    const userRole = req.user.role;
    const isAdmin = ['super_admin', 'it_admin', 'business_head'].includes(userRole);
    const isTeamLeader = userRole === 'team_leader';

    if (!isAdmin && !isTeamLeader) {
      return res.status(403).json({ error: 'Access denied. Only admins and team leaders can assign customers.' });
    }

    const { agent_id, customer_ids } = req.body;
    console.log('Assignment request:', { agent_id, customer_ids, userRole });

    // Validate input
    if (!agent_id || !customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
      return res.status(400).json({ error: 'Invalid input. Please provide agent_id and customer_ids.' });
    }

    // Get agent details including username for customer assignment
    const [agents] = await connection.query(
      'SELECT id, username, team_id, role_id FROM users WHERE id = ?',
      [agent_id]
    );

    if (agents.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agents[0];

    // For team leaders, verify they are assigning to their own team members
    if (isTeamLeader) {
      const teamLeaderTeamId = req.user.team_id;

      if (!teamLeaderTeamId) {
        return res.status(403).json({
          error: 'Team leader team information not found',
          details: {
            user: req.user.username,
            role: req.user.role
          }
        });
      }

      if (agent.team_id !== teamLeaderTeamId) {
        return res.status(403).json({
          error: 'Cannot assign customers to users outside your team',
          details: {
            user: req.user.username,
            role: req.user.role,
            team_id: teamLeaderTeamId,
            agent_team_id: agent.team_id
          }
        });
      }

      // Check if customers are already assigned to other teams
      const [customerAgents] = await connection.query(
        'SELECT c.id, c.agent_name, u.team_id ' +
        'FROM customers c ' +
        'LEFT JOIN users u ON c.agent_name = u.username ' +
        'WHERE c.id IN (?)',
        [customer_ids]
      );

      const invalidCustomers = customerAgents.filter(c =>
        c.agent_name !== null && c.team_id !== null && c.team_id !== teamLeaderTeamId
      );

      if (invalidCustomers.length > 0) {
        return res.status(403).json({
          error: 'Some customers are already assigned to other teams',
          details: {
            invalidCustomerIds: invalidCustomers.map(c => c.id)
          }
        });
      }
    }

    // Begin transaction
    await connection.beginTransaction();

    try {
      // Update customer assignments using the agent's username
      await connection.query(
        'UPDATE customers SET agent_name = ? WHERE id IN (?)',
        [agent.username, customer_ids]
      );

      // Get team leader information from users table
      const [teamInfo] = await connection.query(
        `SELECT u2.username as team_leader_name 
         FROM users u1 
         JOIN users u2 ON u1.team_id = u2.team_id 
         JOIN roles r ON u2.role_id = r.id
         WHERE r.role_name = 'team_leader' 
         AND u1.username = ?`,
        [agent.username]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Customers assigned successfully',
        details: {
          agent_name: agent.username,
          team_leader: teamInfo.length > 0 ? teamInfo[0].team_leader_name : null,
          customer_count: customer_ids.length
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    }

  } catch (error) {
    console.error('Error assigning customers:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};


// ******************


// New function to get teams list
export const getTeams = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const connection = await connectDB();
    let query;
    let params = [];

    if (req.user.role === 'super_admin' || req.user.role === 'it_admin' || req.user.role === 'business_head') {
      // Super_Admin, IT Admin and Business Head can see all teams
      query = 'SELECT id, team_name as name FROM teams ORDER BY team_name';
    } else if (['dept_admin', 'admin'].includes(req.user.role)) {
      // dept_admin can see teams in assigned departments
      query = `
        SELECT DISTINCT t.id, t.team_name as name 
        FROM teams t
        JOIN admin_departments ad ON ad.department_id = t.department_id
        WHERE ad.user_id = ?
        ORDER BY t.team_name`;
      params = [req.user.userId];
    } else if (req.user.role === 'sub_dept_admin') {
      // sub_dept_admin can see teams in assigned sub-departments
      query = `
        SELECT DISTINCT t.id, t.team_name as name 
        FROM teams t
        JOIN admin_departments ad ON ad.sub_department_id = t.sub_department_id
        WHERE ad.user_id = ?
        ORDER BY t.team_name`;
      params = [req.user.userId];
    } else if (req.user.role === 'team_leader') {
      // team_leader can only see their team
      query = 'SELECT id, team_name as name FROM teams WHERE id = ?';
      params = [req.user.team_id];
    } else {
      // Regular users...
      query = `
        SELECT t.id, t.team_name as name 
        FROM teams t
        INNER JOIN users u ON t.id = u.team_id
        WHERE u.id = ?
      `;
      params = [req.user.userId];
    }

    const [rows] = await connection.execute(query, params);
    res.status(200).json(rows);
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ message: 'Failed to fetch teams' });
  }
};


// Add this new function to check for duplicates
export const checkDuplicates = async (req, res) => {
  try {
    const connection = await connectDB();
    const { currentCustomerId, phone_no, email_id } = req.body;

    const conditions = [];
    const params = [currentCustomerId]; // Start with customerId for the != condition
    const duplicates = [];

    // Helper to check if value is non-null and non-empty
    const isValidValue = (value) => {
      return value !== null && value !== undefined && value.toString().trim() !== '';
    };

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
                SELECT id, phone_no, email_id, first_name
                FROM customers 
                WHERE id != ? AND (${conditions.join(' OR ')})
            `, params);

      // Check which fields are in use and push detailed error messages
      if (existRecords.length > 0) {
        existRecords.forEach(record => {
          const customerInfo = `${record.first_name} `;

          if (isValidValue(phone_no) && isValidValue(record.phone_no) && record.phone_no === phone_no) {
            duplicates.push(`Phone number ${phone_no} is already registered with customer ${customerInfo}`);
          }
          if (isValidValue(email_id) && isValidValue(record.email_id) && record.email_id === email_id) {
            duplicates.push(`Email ID ${email_id} is already registered with customer ${customerInfo}`);
          }
        });
      }
    }

    res.status(200).json({
      duplicates,
      hasDuplicates: duplicates.length > 0
    });

  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({
      message: 'Error checking for duplicates',
      error: error.message
    });
  }
};

// ****************

// Function to get team records with field mapping
export const getTeamRecords = async (req, res) => {
  let connection;
  try {
    const pool = await connectDB();
    connection = await pool.getConnection();

    const team_leader = req.params.team_leader;
    if (!team_leader) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: "Team leader name is required"
      });
    }

    // For admin users (IT_ADMIN, BUSINESS_HEAD), allow access to any team's records
    // For team leaders, only allow access to their own team's records
    if (req.user.role.toLowerCase() === 'team_leader' &&
      req.user.username.toLowerCase() !== team_leader.toLowerCase()) {
      connection.release();
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only view your own team's records."
      });
    }

    // Query records for the specified team leader
    const query = `
          SELECT first_name, phone_no, email_id, agent_name 
          FROM customers 
          WHERE agent_name = ?
          ORDER BY last_updated DESC, id DESC
      `;

    const [records] = await connection.query(query, [team_leader]);

    // Check if request body is empty
    const hasBody = req.body && Object.keys(req.body).length > 0;

    // If no body, return records directly
    if (!hasBody) {
      connection.release();
      return res.status(200).json({
        success: true,
        count: records.length,
        data: records
      });
    }

    // If body exists, apply field mapping
    const { first_name = "first_name", number = "phone_no" } = req.body;
    const mappedRecords = records.map(record => ({
      [first_name]: record.first_name,
      [number]: record.phone_no,
      priority: "1"
    }));

    connection.release();
    return res.status(200).json({
      success: true,
      count: mappedRecords.length,
      data: mappedRecords
    });

  } catch (error) {
    console.error("Error in getTeamRecords:", error);
    if (connection) {
      connection.release();
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ******************

// Function to get customers by last_updated date range
export const getCustomersByDateRange = async (req, res) => {
  let connection;
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    // Convert dates to MySQL format
    const start = new Date(startDate);
    const end = new Date(endDate);
    // Set end date to end of day
    end.setHours(23, 59, 59, 999);

    const pool = await connectDB();
    connection = await pool.getConnection();

    const [results] = await connection.query(
      `SELECT * FROM customers 
             WHERE last_updated >= ? AND last_updated <= ?
             ORDER BY last_updated DESC`,
      [start, end]
    );

    res.json({
      success: true,
      data: results,
      count: results.length,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching customers by date range:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching customers',
      error: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// **********
