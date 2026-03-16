// src/middlewares/restrictUsers.js

import connectDB from '../db/index.js';

const restrictUsers = async (req, res, next) => {
    try {
        const pool = connectDB();
        const [rows] = await pool.query('SELECT COUNT(*) as count FROM users');
        const userCount = rows[0].count;
        const maxUsers = parseInt(process.env.MAX_REGISTERED_USERS);

        if (userCount >= maxUsers) {
            return res.status(403).json({
                success: false,
                message: 'Maximum user limit reached. Registration is currently closed.'
            });
        }
        next();
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error checking user limit',
            error: error.message
        });
    }
};

export default restrictUsers;