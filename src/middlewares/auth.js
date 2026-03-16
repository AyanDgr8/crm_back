// src/middlewares/auth.js

import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
import connectDB from '../db/index.js';

dotenv.config();  // Load environment variables

export const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(403).json({ message: "Access denied. No token provided." });
    }

    // Validate token format
    if (typeof token !== 'string' || !/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(token)) {
        return res.status(401).json({ message: "Invalid token format." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded);

        if (!decoded.userId || !decoded.role) {
            console.error('Invalid token payload:', decoded);
            return res.status(401).json({
                success: false,
                message: "Invalid token payload"
            });
        }

        // Get current permissions from database
        const pool = await connectDB();
        const connection = await pool.getConnection();
        try {
            const [users] = await connection.query(`
                SELECT u.requires_delete_approval, GROUP_CONCAT(p.permission_name) as permissions
                FROM users u
                LEFT JOIN user_permissions up ON u.id = up.user_id
                LEFT JOIN permissions p ON up.permission_id = p.id AND up.value = true
                WHERE u.id = ?
                GROUP BY u.id
            `, [decoded.userId]);

            const currentPermissions = users[0]?.permissions ? users[0].permissions.split(',') : [];

            // Log the difference between token and database permissions
            console.log('Token permissions:', decoded.permissions);
            console.log('Database permissions:', currentPermissions);
            const removedPermissions = decoded.permissions?.filter(p => !currentPermissions.includes(p)) || [];
            const addedPermissions = currentPermissions.filter(p => !decoded.permissions?.includes(p)) || [];
            if (removedPermissions.length > 0) {
                console.log('Permissions removed since token generation:', removedPermissions);
            }
            if (addedPermissions.length > 0) {
                console.log('Permissions added since token generation:', addedPermissions);
            }

            req.user = {
                userId: decoded.userId,
                username: decoded.username,
                email: decoded.email,
                role: decoded.role,
                company_id: decoded.company_id || null, // CRITICAL: For multi-tenant data isolation
                team_id: decoded.team_id ? parseInt(decoded.team_id) : null,
                permissions: currentPermissions, // Use current permissions from database
                requires_delete_approval: users[0]?.requires_delete_approval === 1 || users[0]?.requires_delete_approval === true
            };

            console.log('Set request user:', req.user);
            next();

        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ message: "Invalid token." });
    }
};

export const checkUploadAccess = (req, res, next) => {
    if (req.user.role !== 'super_admin' && req.user.role !== 'business_head' && req.user.role !== 'mis') {
        return res.status(403).json({ message: "Access denied. Insufficient permissions." });
    }
    next();
};

export const checkDownloadAccess = (req, res, next) => {
    if (req.user.role !== 'super_admin' && req.user.role !== 'business_head' && req.user.role !== 'mis') {
        return res.status(403).json({ message: "Access denied. Insufficient permissions." });
    }
    next();
};
