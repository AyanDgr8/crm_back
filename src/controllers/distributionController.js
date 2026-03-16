import connectDB from '../db/index.js';

export const getDistributionRules = async (req, res) => {
    try {
        const { departmentId } = req.params;
        if (!departmentId) return res.status(400).json({ message: 'Department ID is required' });

        const pool = await connectDB();
        const { role, userId } = req.user;

        // Authorization Check
        if (!['super_admin', 'business_head'].includes(role)) {
            if (role === 'dept_admin' || role === 'sub_dept_admin') {
                const [adminDept] = await pool.query(
                    'SELECT id FROM admin_departments WHERE user_id = ? AND department_id = ?',
                    [userId, departmentId]
                );
                if (adminDept.length === 0) {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
            } else {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }
        }

        const [rules] = await pool.query(
            `SELECT * FROM lead_distribution_rules WHERE department_id = ?`,
            [departmentId]
        );

        res.json({ success: true, rules });
    } catch (error) {
        console.error('Error fetching distribution rules:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch rules' });
    }
};

export const saveDistributionRules = async (req, res) => {
    try {
        const { departmentId, scopeType, scopeId, distributionMethod, activeOnly } = req.body;
        const { role, userId } = req.user;

        if (!departmentId || !scopeType || !scopeId || !distributionMethod) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const pool = await connectDB();
        const connection = await pool.getConnection();

        try {
            // Authorization Check
            if (!['super_admin', 'business_head'].includes(role)) {
                if (role === 'dept_admin' || role === 'sub_dept_admin') {
                    // Check if they manage this department
                    const [adminDept] = await connection.query(
                        'SELECT id FROM admin_departments WHERE user_id = ? AND department_id = ?',
                        [userId, departmentId]
                    );
                    if (adminDept.length === 0) {
                        return res.status(403).json({ success: false, message: 'You do not have permission to manage rules for this department' });
                    }
                } else {
                    return res.status(403).json({ success: false, message: 'Access denied' });
                }
            }

            // Check if rule exists
            const [existing] = await connection.query(
                `SELECT id FROM lead_distribution_rules 
                 WHERE department_id = ? AND scope_type = ? AND scope_id = ?`,
                [departmentId, scopeType, scopeId]
            );

            if (existing.length > 0) {
                // Update
                await connection.query(
                    `UPDATE lead_distribution_rules 
                     SET distribution_method = ?, active_only = ? 
                     WHERE id = ?`,
                    [distributionMethod, activeOnly ?? true, existing[0].id]
                );
            } else {
                // Insert
                await connection.query(
                    `INSERT INTO lead_distribution_rules 
                     (department_id, scope_type, scope_id, distribution_method, active_only) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [departmentId, scopeType, scopeId, distributionMethod, activeOnly ?? true]
                );
            }

            res.json({ success: true, message: 'Rule saved successfully' });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error saving distribution rules:', error);
        res.status(500).json({ success: false, message: 'Failed to save rules' });
    }
};
