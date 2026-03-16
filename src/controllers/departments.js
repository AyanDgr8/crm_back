// src/controllers/departments.js
// Department and Sub-Department CRUD for IT Admin

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

// ============================================================================
// HELPER: Check if requester is IT Admin (business_head) or Super Admin
// ============================================================================
const isITAdminOrSuperAdmin = (role) =>
    ['super_admin', 'business_head'].includes(role);

// ============================================================================
// DEPARTMENTS
// ============================================================================

/**
 * Create a department
 * Only IT Admin (business_head) of the company can create departments
 */
export const createDepartment = async (req, res) => {
    const { department_name, description } = req.body;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Only IT Admin can create departments' });
    }
    if (!department_name?.trim()) {
        return res.status(400).json({ success: false, message: 'department_name is required' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Check duplicate name within company
        const [existing] = await connection.query(
            'SELECT id FROM departments WHERE company_id = ? AND department_name = ?',
            [company_id, department_name.trim()]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Department name already exists in this company' });
        }

        const [result] = await connection.query(
            `INSERT INTO departments (company_id, department_name, description, created_by)
             VALUES (?, ?, ?, ?)`,
            [company_id, department_name.trim(), description?.trim() || null, userId]
        );

        logger.info(`Department created: ${department_name} (ID: ${result.insertId}) by user ${userId}`);

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: { id: result.insertId, department_name: department_name.trim(), company_id }
        });
    } catch (error) {
        logger.error('Error creating department:', error);
        res.status(500).json({ success: false, message: 'Failed to create department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Get all departments for the requester's company
 * IT Admin sees all; admin sees only their assigned depts
 */
export const getDepartments = async (req, res) => {
    const { role, company_id: userCompanyId, userId } = req.user;

    // Super admin can query any company's departments via ?company_id=X
    const company_id = (role === 'super_admin' && req.query.company_id)
        ? req.query.company_id
        : userCompanyId;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        let departments;

        if (isITAdminOrSuperAdmin(role) || role === 'admin') {
            // IT Admin / Dept Admin: see enriched data
            // Note: Original logic for 'admin' was restricted to assigned depts. 
            // But for Upload Dropdowns, they might need to see ALL depts to target them?
            // Actually, for distribution wizard, seeing all depts in company is fine for selection.
            // Let's keep specific logic for Admin/IT Admin if we want to show stats, 
            // but for "User" role, we just need the list.

            // Simpler approach: Allow ALL roles to see ALL departments in their company.
            // If we need to restrict 'admin' to only their managed depts for MANAGEMENT purposes, 
            // that should be a separate "manage" endpoint or filtered UI.
            // For now, "getDepartments" is used for Dropdowns.

            // Let's stick to the existing "Super/IT Admin" view for them, 
            // and for everyone else (including 'user'), show the basic department list.
        }

        let query, params;

        if (isITAdminOrSuperAdmin(role)) {
            query = `SELECT d.*,
                        COUNT(DISTINCT sd.id) AS sub_department_count,
                        COUNT(DISTINCT t.id)  AS team_count,
                        GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS admins
                 FROM departments d
                 LEFT JOIN sub_departments sd ON sd.department_id = d.id AND sd.is_active = true
                 LEFT JOIN teams t ON t.department_id = d.id
                 LEFT JOIN admin_departments ad ON ad.department_id = d.id AND ad.sub_department_id IS NULL
                 LEFT JOIN users u ON u.id = ad.user_id
                 WHERE d.company_id = ?
                 GROUP BY d.id
                 ORDER BY d.department_name`;
            params = [company_id];
        } else if (role === 'dept_admin' || role === 'sub_dept_admin' || role === 'admin') {
            // Dept Admin / Sub-Dept Admin: see ONLY their assigned depts
            query = `SELECT d.*,
                        COUNT(DISTINCT sd.id) AS sub_department_count,
                        COUNT(DISTINCT t.id) AS team_count
                 FROM departments d
                 JOIN admin_departments ad ON ad.department_id = d.id
                 LEFT JOIN sub_departments sd ON sd.department_id = d.id AND sd.is_active = true
                 LEFT JOIN teams t ON t.department_id = d.id
                 WHERE ad.user_id = ? AND d.company_id = ? AND d.is_active = true
                 GROUP BY d.id
                 ORDER BY d.department_name`;
            params = [userId, company_id];
        } else {
            // For Team Leader, User, MIS: Generic list
            query = `SELECT d.id, d.department_name, d.description 
                      FROM departments d
                      WHERE d.company_id = ? AND d.is_active = true
                      ORDER BY d.department_name`;
            params = [company_id];
        }

        [departments] = await connection.query(query, params);
        res.json({ success: true, data: departments });

        /* 
           Preserving old logic block below for reference but bypassing it above.
           The previous block had specific logic for 'admin' role that restricted visibility.
           User requested "just fetch it".
        */
    } catch (error) {
        logger.error('Error fetching departments:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch departments' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Update a department
 */
export const updateDepartment = async (req, res) => {
    const { id } = req.params;
    const { department_name, description, is_active } = req.body;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Only IT Admin can update departments' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [existing] = await connection.query(
            'SELECT id FROM departments WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        const updates = [];
        const values = [];

        if (department_name !== undefined) { updates.push('department_name = ?'); values.push(department_name.trim()); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
        if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }

        if (updates.length > 0) {
            values.push(id);
            await connection.query(`UPDATE departments SET ${updates.join(', ')} WHERE id = ?`, values);
        }

        logger.info(`Department updated: ID ${id} by user ${userId}`);
        res.json({ success: true, message: 'Department updated successfully' });
    } catch (error) {
        logger.error('Error updating department:', error);
        res.status(500).json({ success: false, message: 'Failed to update department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Delete a department (soft delete via is_active = false)
 */
export const deleteDepartment = async (req, res) => {
    const { id } = req.params;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Only IT Admin can delete departments' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [existing] = await connection.query(
            'SELECT id FROM departments WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        await connection.query('UPDATE departments SET is_active = false WHERE id = ?', [id]);

        logger.info(`Department deactivated: ID ${id} by user ${userId}`);
        res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error) {
        logger.error('Error deleting department:', error);
        res.status(500).json({ success: false, message: 'Failed to delete department' });
    } finally {
        if (connection) connection.release();
    }
};

// ============================================================================
// SUB-DEPARTMENTS
// ============================================================================

/**
 * Create a sub-department under a department
 */
export const createSubDepartment = async (req, res) => {
    const { department_id, sub_department_name, description } = req.body;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role) && role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only IT Admin or Dept Admin can create sub-departments' });
    }
    if (!department_id || !sub_department_name?.trim()) {
        return res.status(400).json({ success: false, message: 'department_id and sub_department_name are required' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Verify department belongs to company
        const [dept] = await connection.query(
            'SELECT id FROM departments WHERE id = ? AND company_id = ? AND is_active = true',
            [department_id, company_id]
        );
        if (dept.length === 0) {
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        // If admin role, verify they manage this department
        if (role === 'admin') {
            const [adminDept] = await connection.query(
                'SELECT id FROM admin_departments WHERE user_id = ? AND department_id = ?',
                [userId, department_id]
            );
            if (adminDept.length === 0) {
                return res.status(403).json({ success: false, message: 'You do not manage this department' });
            }
        }

        // Check duplicate
        const [existing] = await connection.query(
            'SELECT id FROM sub_departments WHERE department_id = ? AND sub_department_name = ?',
            [department_id, sub_department_name.trim()]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Sub-department name already exists in this department' });
        }

        const [result] = await connection.query(
            `INSERT INTO sub_departments (company_id, department_id, sub_department_name, description, created_by)
             VALUES (?, ?, ?, ?, ?)`,
            [company_id, department_id, sub_department_name.trim(), description?.trim() || null, userId]
        );

        logger.info(`Sub-department created: ${sub_department_name} (ID: ${result.insertId}) by user ${userId}`);

        res.status(201).json({
            success: true,
            message: 'Sub-department created successfully',
            data: { id: result.insertId, sub_department_name: sub_department_name.trim(), department_id, company_id }
        });
    } catch (error) {
        logger.error('Error creating sub-department:', error);
        res.status(500).json({ success: false, message: 'Failed to create sub-department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Get sub-departments for a department
 */
export const getSubDepartments = async (req, res) => {
    const { department_id } = req.params;
    const { role, company_id, userId } = req.user;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // For non-super-admin: verify department belongs to their company
        if (role !== 'super_admin') {
            const [dept] = await connection.query(
                'SELECT id FROM departments WHERE id = ? AND company_id = ?',
                [department_id, company_id]
            );
            if (dept.length === 0) {
                return res.status(404).json({ success: false, message: 'Department not found' });
            }
        }

        let subDepts;
        if (isITAdminOrSuperAdmin(role) || role === 'dept_admin') {
            // See all sub-depts of the department
            [subDepts] = await connection.query(
                `SELECT sd.*, COUNT(DISTINCT t.id) AS team_count
                 FROM sub_departments sd
                 LEFT JOIN teams t ON t.sub_department_id = sd.id
                 WHERE sd.department_id = ? AND sd.is_active = true
                 GROUP BY sd.id
                 ORDER BY sd.sub_department_name`,
                [department_id]
            );
        } else if (role === 'sub_dept_admin' || role === 'admin') {
            // Sub-Dept Admin: see ONLY assigned sub-departments
            [subDepts] = await connection.query(
                `SELECT sd.*, COUNT(DISTINCT t.id) AS team_count
                 FROM sub_departments sd
                 JOIN admin_departments ad ON ad.sub_department_id = sd.id
                 LEFT JOIN teams t ON t.sub_department_id = sd.id
                 WHERE ad.user_id = ? AND sd.department_id = ? AND sd.is_active = true
                 GROUP BY sd.id
                 ORDER BY sd.sub_department_name`,
                [userId, department_id]
            );
        } else {
            // Generic list for others
            [subDepts] = await connection.query(
                `SELECT sd.id, sd.sub_department_name, sd.description, sd.department_id
                FROM sub_departments sd
                WHERE sd.department_id = ? AND sd.is_active = true
                ORDER BY sd.sub_department_name`,
                [department_id]
            );
        }

        res.json({ success: true, data: subDepts });
    } catch (error) {
        logger.error('Error fetching sub-departments:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch sub-departments' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Update a sub-department
 */
export const updateSubDepartment = async (req, res) => {
    const { id } = req.params;
    const { sub_department_name, description, is_active } = req.body;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role) && role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [existing] = await connection.query(
            'SELECT id FROM sub_departments WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Sub-department not found' });
        }

        const updates = [];
        const values = [];
        if (sub_department_name !== undefined) { updates.push('sub_department_name = ?'); values.push(sub_department_name.trim()); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description?.trim() || null); }
        if (is_active !== undefined) { updates.push('is_active = ?'); values.push(is_active); }

        if (updates.length > 0) {
            values.push(id);
            await connection.query(`UPDATE sub_departments SET ${updates.join(', ')} WHERE id = ?`, values);
        }

        logger.info(`Sub-department updated: ID ${id} by user ${userId}`);
        res.json({ success: true, message: 'Sub-department updated successfully' });
    } catch (error) {
        logger.error('Error updating sub-department:', error);
        res.status(500).json({ success: false, message: 'Failed to update sub-department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Delete a sub-department (soft delete)
 */
export const deleteSubDepartment = async (req, res) => {
    const { id } = req.params;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role) && role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [existing] = await connection.query(
            'SELECT id FROM sub_departments WHERE id = ? AND company_id = ?',
            [id, company_id]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Sub-department not found' });
        }

        await connection.query('UPDATE sub_departments SET is_active = false WHERE id = ?', [id]);

        logger.info(`Sub-department deactivated: ID ${id} by user ${userId}`);
        res.json({ success: true, message: 'Sub-department deleted successfully' });
    } catch (error) {
        logger.error('Error deleting sub-department:', error);
        res.status(500).json({ success: false, message: 'Failed to delete sub-department' });
    } finally {
        if (connection) connection.release();
    }
};

// ============================================================================
// ADMIN-DEPARTMENT ASSIGNMENTS
// ============================================================================

/**
 * Assign an admin user to a department (or sub-department)
 */
export const assignAdminToDepartment = async (req, res) => {
    const { user_id, department_id, sub_department_id } = req.body;
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Only IT Admin can assign admins to departments' });
    }
    if (!user_id || !department_id) {
        return res.status(400).json({ success: false, message: 'user_id and department_id are required' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Verify user is admin role and belongs to same company
        const [targetUser] = await connection.query(
            `SELECT u.id FROM users u
             JOIN roles r ON u.role_id = r.id
             WHERE u.id = ? AND u.company_id = ? AND r.role_name = 'admin'`,
            [user_id, company_id]
        );
        if (targetUser.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found or is not an admin role' });
        }

        // Verify department belongs to company
        const [dept] = await connection.query(
            'SELECT id FROM departments WHERE id = ? AND company_id = ?',
            [department_id, company_id]
        );
        if (dept.length === 0) {
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        // Insert (ignore duplicate)
        await connection.query(
            `INSERT IGNORE INTO admin_departments (user_id, department_id, sub_department_id)
             VALUES (?, ?, ?)`,
            [user_id, department_id, sub_department_id || null]
        );

        logger.info(`Admin ${user_id} assigned to dept ${department_id} by user ${userId}`);
        res.json({ success: true, message: 'Admin assigned to department successfully' });
    } catch (error) {
        logger.error('Error assigning admin to department:', error);
        res.status(500).json({ success: false, message: 'Failed to assign admin to department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Remove an admin from a department assignment
 */
export const removeAdminFromDepartment = async (req, res) => {
    const { id } = req.params; // admin_departments.id
    const { role, company_id, userId } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Only IT Admin can remove admin assignments' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        await connection.query('DELETE FROM admin_departments WHERE id = ?', [id]);

        logger.info(`Admin-dept assignment ${id} removed by user ${userId}`);
        res.json({ success: true, message: 'Admin removed from department successfully' });
    } catch (error) {
        logger.error('Error removing admin from department:', error);
        res.status(500).json({ success: false, message: 'Failed to remove admin from department' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Get all admin-department assignments for the company
 */
export const getAdminDepartmentAssignments = async (req, res) => {
    const { role, company_id } = req.user;

    if (!isITAdminOrSuperAdmin(role)) {
        return res.status(403).json({ success: false, message: 'Access denied' });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [assignments] = await connection.query(
            `SELECT ad.id, ad.user_id, ad.department_id, ad.sub_department_id,
                    u.username, u.email,
                    d.department_name,
                    sd.sub_department_name
             FROM admin_departments ad
             JOIN users u ON u.id = ad.user_id
             JOIN departments d ON d.id = ad.department_id
             LEFT JOIN sub_departments sd ON sd.id = ad.sub_department_id
             WHERE d.company_id = ?
             ORDER BY d.department_name, u.username`,
            [company_id]
        );

        res.json({ success: true, data: assignments });
    } catch (error) {
        logger.error('Error fetching admin-dept assignments:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
    } finally {
        if (connection) connection.release();
    }
};
