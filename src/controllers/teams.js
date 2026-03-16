// src/controllers/teams.js

import connectDB from '../db/index.js';

// Create a new team
export const createTeam = async (req, res) => {
    const { team_name, department_id, sub_department_id } = req.body;
    const created_by = req.user.userId; // Get userId from auth middleware
    const company_id = req.user.company_id; // Get company_id from auth middleware

    try {
        const pool = connectDB();
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Check if team already exists in this company
            const [existingTeam] = await conn.query(
                'SELECT id FROM teams WHERE team_name = ? AND company_id = ?',
                [team_name, company_id]
            );

            if (existingTeam.length > 0) {
                await conn.rollback();
                return res.status(400).json({ error: 'Team name already exists' });
            }

            // Create new team with company_id, department_id, and sub_department_id
            const [result] = await conn.query(
                'INSERT INTO teams (team_name, company_id, department_id, sub_department_id, created_by) VALUES (?, ?, ?, ?, ?)',
                [team_name, company_id, department_id || null, sub_department_id || null, created_by]
            );

            await conn.commit();
            res.status(201).json({
                message: 'Team created successfully',
                team_id: result.insertId
            });

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all teams - single source of truth, used by both /teams and /players/teams
export const getAllTeams = async (req, res) => {
    const pool = connectDB();
    let connection;
    try {
        connection = await pool.getConnection();

        const { role, company_id: userCompanyId, userId } = req.user;

        let query, params;

        if (role === 'super_admin') {
            // Super admin can filter by company or see all
            if (req.query.company_id) {
                query = `SELECT DISTINCT t.*, u.username as created_by_name, 
                         d.department_name, sd.sub_department_name
                         FROM teams t 
                         JOIN users u ON t.created_by = u.id 
                         LEFT JOIN departments d ON t.department_id = d.id
                         LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                         WHERE t.company_id = ? ORDER BY t.team_name`;
                params = [req.query.company_id];
            } else {
                query = `SELECT DISTINCT t.*, u.username as created_by_name,
                         d.department_name, sd.sub_department_name
                         FROM teams t 
                         JOIN users u ON t.created_by = u.id 
                         LEFT JOIN departments d ON t.department_id = d.id
                         LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                         ORDER BY t.team_name`;
                params = [];
            }
        } else if (role === 'business_head') {
            // IT Admin sees all teams in their company
            query = `SELECT DISTINCT t.*, u.username as created_by_name,
                     d.department_name, sd.sub_department_name
                     FROM teams t 
                     JOIN users u ON t.created_by = u.id 
                     LEFT JOIN departments d ON t.department_id = d.id
                     LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                     WHERE t.company_id = ? ORDER BY t.team_name`;
            params = [userCompanyId];
        } else if (['dept_admin', 'admin'].includes(role)) {
            // Dept Admin: see teams in their assigned departments only
            query = `SELECT DISTINCT t.*, u.username as created_by_name,
                     d.department_name, sd.sub_department_name 
                     FROM teams t 
                     JOIN users u ON t.created_by = u.id 
                     JOIN admin_departments ad ON ad.department_id = t.department_id
                     LEFT JOIN departments d ON t.department_id = d.id
                     LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                     WHERE t.company_id = ? AND ad.user_id = ?
                     ORDER BY t.team_name`;
            params = [userCompanyId, userId];
        } else if (role === 'sub_dept_admin') {
            // Sub-Dept Admin: see teams in their assigned sub-departments only
            query = `SELECT DISTINCT t.*, u.username as created_by_name,
                     d.department_name, sd.sub_department_name 
                     FROM teams t 
                     JOIN users u ON t.created_by = u.id 
                     JOIN admin_departments ad ON ad.sub_department_id = t.sub_department_id
                     LEFT JOIN departments d ON t.department_id = d.id
                     LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                     WHERE t.company_id = ? AND ad.user_id = ?
                     ORDER BY t.team_name`;
            params = [userCompanyId, userId];
        } else if (role === 'mis') {
            // MIS uploads and distributes leads across the company — needs all company teams
            query = `SELECT DISTINCT t.*, u.username as created_by_name,
                     d.department_name, sd.sub_department_name 
                     FROM teams t 
                     JOIN users u ON t.created_by = u.id 
                     LEFT JOIN departments d ON t.department_id = d.id
                     LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                     WHERE t.company_id = ? ORDER BY t.team_name`;
            params = [userCompanyId];
        } else {
            // Team Leader, regular User: see only their own team
            query = `SELECT DISTINCT t.*, u.username as created_by_name,
                     d.department_name, sd.sub_department_name 
                     FROM teams t 
                     JOIN users u ON t.created_by = u.id 
                     LEFT JOIN departments d ON t.department_id = d.id
                     LEFT JOIN sub_departments sd ON t.sub_department_id = sd.id
                     WHERE t.company_id = ? AND t.id = ? ORDER BY t.team_name`;
            params = [userCompanyId, req.user.team_id || 0];
        }

        const [teams] = await connection.query(query, params);

        // Return consistent format for all callers
        res.json({ success: true, teams });

    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        if (connection) connection.release();
    }
};


// Delete a team
export const deleteTeam = async (req, res) => {
    const { id } = req.params;
    const { role, company_id: userCompanyId } = req.user;

    // Only Business Head/IT Admin and Super Admin can delete teams
    if (!['super_admin', 'business_head'].includes(role)) {
        return res.status(403).json({ error: 'Only Business Head or Super Admin can delete teams' });
    }

    try {
        const pool = connectDB();
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Verify team exists and belongs to the company
            const [team] = await conn.query(
                'SELECT * FROM teams WHERE id = ?',
                [id]
            );

            if (team.length === 0) {
                await conn.rollback();
                return res.status(404).json({ error: 'Team not found' });
            }

            if (role !== 'super_admin' && team[0].company_id !== userCompanyId) {
                await conn.rollback();
                return res.status(403).json({ error: 'You can only delete teams in your own company' });
            }

            // Check for users assigned to this team
            const [users] = await conn.query(
                'SELECT id FROM users WHERE team_id = ?',
                [id]
            );

            if (users.length > 0) {
                await conn.rollback();
                return res.status(400).json({ error: 'Cannot delete team with active members. Please reassign or delete users first.' });
            }

            // Check for leads assigned to this team
            const [leads] = await conn.query(
                'SELECT id FROM customers WHERE team_id = ?',
                [id]
            );

            if (leads.length > 0) {
                await conn.rollback();
                return res.status(400).json({ error: 'Cannot delete team with assigned leads. Please reassign leads first.' });
            }

            // Delete the team
            await conn.query('DELETE FROM teams WHERE id = ?', [id]);

            await conn.commit();
            res.json({ message: 'Team deleted successfully' });

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('Error deleting team:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
