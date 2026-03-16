// src/controllers/downloadFile.js

import connectDB from '../db/index.js';

export const downloadCustomerData = async (req, res) => {
    console.log('Download request received:', req.query);
    const pool = await connectDB();
    const connection = await pool.getConnection();

    try {
        const { startDate, endDate } = req.query;
        console.log('Dates received:', { startDate, endDate });

        if (!startDate || !endDate) {
            console.log('Missing dates');
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        // Get user information
        const userId = req.user?.userId;
        console.log('User ID:', userId);

        const [userResult] = await connection.query(
            'SELECT u.*, r.role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?',
            [userId]
        );
        console.log('User result:', userResult[0]);

        if (userResult.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        const user = userResult[0];
        console.log('User role and team:', { role: user.role_name, team_id: user.team_id, username: user.username });

        let query = `
            SELECT DISTINCT
                c.first_name, c.last_name,
                c.course, c.age_group,
                c.profession, c.investment_trading, c.why_choose, 
                c.language, c.education,c.region, c.designation, 
                c.phone_no, c.whatsapp_num, c.email_id, c.yt_email_id,
                c.mentor, c.gender,c.followup_count, c.disposition, 
                c.agent_name, c.comment, c.C_unique_id,
                c.date_created, c.last_updated,
                c.scheduled_at
            FROM customers c
            INNER JOIN users agent_user ON c.agent_name = agent_user.username
            WHERE DATE(c.date_created) BETWEEN DATE(?) AND DATE(?)
        `;

        const params = [startDate, endDate];

        // Apply role-based filters
        if (!['super_admin', 'it_admin', 'business_head'].includes(user.role_name)) {
            if (user.role_name === 'team_leader') {
                // Team leaders can see all data from their team
                query += ' AND agent_user.team_id = ?';
                params.push(user.team_id);
                console.log('Applying team filter for team leader:', user.team_id);
            } else {
                // Regular users can only see their own assigned records
                query += ' AND c.agent_name = ?';
                params.push(user.username);
                console.log('Filtering by agent name:', user.username);
            }
        }

        query += ' ORDER BY c.date_created DESC';
        
        console.log('Final query:', query);
        console.log('Query params:', params);

        const [results] = await connection.query(query, params);
        console.log('Query results count:', results.length);

        res.json({
            success: true,
            data: results,
            query: { startDate, endDate },
            userRole: user.role_name
        });

    } catch (error) {
        console.error('Error downloading data:', error);
        res.status(500).json({ 
            message: 'Error downloading data',
            error: error.message 
        });
    } finally {
        connection.release();
    }
};