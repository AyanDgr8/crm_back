// src/controllers/sign.js

import bcrypt from 'bcrypt';
import connectDB from '../db/index.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { logger } from '../logger.js';

dotenv.config();  // Load environment variables

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const SALT_ROUNDS = 10;

export const registerCustomer = async (req, res) => {
    const { username, email, role_type, team_id } = req.body;

    try {
        const pool = await connectDB();
        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // Check if username or email already exists
            const [existingUser] = await connection.query(
                'SELECT * FROM users WHERE email = ? OR username = ?',
                [email, username]
            );

            if (existingUser.length > 0) {
                await connection.rollback();
                const message = existingUser[0].email === email ? 'Email already exists' : 'Username already exists';
                return res.status(400).json({ message });
            }

            // Get role ID based on role_type
            const [roles] = await connection.query(
                'SELECT id FROM roles WHERE role_name = ?',
                [role_type || 'user']
            );

            if (roles.length === 0) {
                await connection.rollback();
                throw new Error('Role not found');
            }

            // Use default password '12345678'
            const defaultPassword = '12345678';
            const hashedPassword = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

            // Insert new user
            const [result] = await connection.query(
                'INSERT INTO users (username, email, password, team_id, role_id) VALUES (?, ?, ?, ?, ?)',
                [username, email, hashedPassword, team_id, roles[0].id]
            );

            // Send welcome email
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Welcome to Multycomm CRM',
                html: `
                    <h2>Welcome ${username}!</h2>
                    <p>Your account has been created successfully.</p>
                    <p>You can now login to your account using your email and the default password: <strong>12345678</strong></p>
                    <p>Please change your password after your first login.</p>
                    <a href="${process.env.FRONTEND_URL}/login" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Login Now</a>
                    <p>Best regards,<br>Multycomm Team</p>
                `
            };

            await transporter.sendMail(mailOptions);

            // Get all permissions
            const [permissions] = await connection.query('SELECT id, permission_name FROM permissions');

            // Set permissions based on role
            for (const permission of permissions) {
                let hasPermission = false; // Default to false

                // Specific role-based permission logic
                if (role_type === 'user') {
                    // Users only get view_assigned_customers by default
                    hasPermission = permission.permission_name === 'view_assigned_customers';
                } else if (role_type === 'team_leader') {
                    // Team leaders get view_team_customers by default
                    hasPermission = permission.permission_name === 'view_team_customers' || permission.permission_name === 'view_assigned_customers';
                } else if (role_type === 'business_head' || role_type === 'dept_admin' || role_type === 'sub_dept_admin') {
                    // Business heads and specific admins get all permissions
                    hasPermission = true;
                }

                // If permissions were explicitly provided in the request, use those values
                if (permissions && permissions[permission.permission_name] !== undefined) {
                    hasPermission = permissions[permission.permission_name];
                }

                await connection.query(
                    'INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, ?)',
                    [result.insertId, permission.id, hasPermission]
                );
            }

            await connection.commit();
            connection.release();

            res.status(201).json({
                success: true,
                message: 'Registration successful',
                userId: result.insertId
            });

        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        } finally {
            if (connection) {
                connection.release();
            }
        }

    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed. Please try again later.'
        });
    }
};

// Get teams list
export const getTeams = async (req, res) => {
    let connection;
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        let query = 'SELECT id, team_name, department_id, company_id FROM teams';
        let params = [];
        let whereClauses = [];

        if (req.user.role === 'super_admin') {
            if (req.query.company_id) {
                whereClauses.push('company_id = ?');
                params.push(req.query.company_id);
            }
        } else if (req.user.role === 'business_head') {
            whereClauses.push('company_id = ?');
            params.push(req.user.company_id);
        } else if (['dept_admin', 'admin', 'sub_dept_admin'].includes(req.user.role)) {
            whereClauses.push('company_id = ?');
            params.push(req.user.company_id);

            if (req.user.role === 'sub_dept_admin') {
                whereClauses.push('sub_department_id IN (SELECT sub_department_id FROM admin_departments WHERE user_id = ?)');
            } else {
                whereClauses.push('department_id IN (SELECT department_id FROM admin_departments WHERE user_id = ?)');
            }
            params.push(req.user.userId);
        } else {
            whereClauses.push('company_id = ?');
            params.push(req.user.company_id);
            whereClauses.push('id = ?');
            params.push(req.user.team_id || 0);
        }

        if (req.query.department_id) {
            whereClauses.push('department_id = ?');
            params.push(req.query.department_id);
        }

        if (req.query.sub_department_id) {
            whereClauses.push('sub_department_id = ?');
            params.push(req.query.sub_department_id);
        }

        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        query += ' ORDER BY team_name';

        const [teams] = await connection.query(query, params);

        res.json({
            success: true,
            teams
        });
    } catch (error) {
        logger.error('Error fetching teams:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch teams'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Login User
export const loginCustomer = async (req, res) => {
    const { email, password } = req.body;
    const deviceId = req.headers['x-device-id'];

    if (!deviceId) {
        return res.status(400).json({ message: 'Device identifier is required' });
    }

    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        await connection.beginTransaction();

        // Get user with role
        const [users] = await connection.query(
            `SELECT u.*, r.role_name 
             FROM users u 
             JOIN roles r ON u.role_id = r.id 
             WHERE u.email = ?`,
            [email]
        );

        if (users.length === 0) {
            await connection.rollback();
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const user = users[0];

        // Check for recent failed attempts
        const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
        const [recentFailedAttempts] = await connection.query(
            'SELECT COUNT(*) as count FROM login_history WHERE user_id = ? AND login_time > ? AND is_active = false',
            [user.id, threeMinutesAgo]
        );

        if (recentFailedAttempts[0].count >= 3) {
            const [lastAttempt] = await connection.query(
                'SELECT login_time FROM login_history WHERE user_id = ? AND is_active = false ORDER BY login_time DESC LIMIT 1',
                [user.id]
            );

            const lastAttemptTime = new Date(lastAttempt[0].login_time);
            const timeElapsed = Date.now() - lastAttemptTime;
            const remainingTime = Math.ceil((180000 - timeElapsed) / 1000);

            if (remainingTime > 0) {
                await connection.rollback();
                return res.status(429).json({
                    success: false,
                    message: 'Too many failed attempts',
                    remainingTime,
                    isLockedOut: true
                });
            }
        }

        // Validate password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            // Record failed attempt
            await connection.query(
                'INSERT INTO login_history (user_id, device_id, is_active, login_time) VALUES (?, ?, false, CURRENT_TIMESTAMP)',
                [user.id, deviceId]
            );

            await connection.commit();
            connection.release();

            // Check if this attempt triggers lockout
            const [newFailedAttempts] = await connection.query(
                'SELECT COUNT(*) as count FROM login_history WHERE user_id = ? AND login_time > ? AND is_active = false',
                [user.id, threeMinutesAgo]
            );

            if (newFailedAttempts[0].count >= 3) {
                return res.status(429).json({
                    success: false,
                    message: 'Too many failed attempts',
                    remainingTime: 180,
                    isLockedOut: true
                });
            }

            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }



        // Deactivate existing sessions
        await connection.query(
            'UPDATE login_history SET is_active = false, logout_time = CURRENT_TIMESTAMP WHERE user_id = ? AND device_id != ? AND is_active = true',
            [user.id, deviceId]
        );

        // Create new session
        const [session] = await connection.query(
            'INSERT INTO login_history (user_id, device_id, login_time, is_active) VALUES (?, ?, CURRENT_TIMESTAMP, true)',
            [user.id, deviceId]
        );

        // Generate JWT
        // Get user permissions
        const [permissions] = await connection.query(
            `SELECT p.permission_name 
             FROM permissions p 
             JOIN user_permissions up ON p.id = up.permission_id 
             WHERE up.user_id = ? AND up.value = true`,
            [user.id]
        );

        // Keep role name in lowercase
        const roleName = user.role_name.toLowerCase();

        // Get permissions array
        const userPermissions = permissions.map(p => p.permission_name);

        const token = jwt.sign({
            userId: user.id,
            username: user.username,
            email: user.email,
            role: roleName,
            company_id: user.company_id || null, // CRITICAL: For multi-tenant isolation
            deviceId,
            sessionId: session.insertId,
            team_id: user.team_id,
            permissions: userPermissions
        }, process.env.JWT_SECRET, { expiresIn: '24h' });

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: roleName,
                team_id: user.team_id,
                permissions: permissions.map(p => p.permission_name)
            }
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred during login'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Logout User
export const logoutCustomer = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        await connection.beginTransaction();

        const deviceId = req.headers['x-device-id'];
        const userId = req.user?.userId;

        if (!userId || !deviceId) {
            await connection.rollback();
            return res.status(400).json({ message: 'User ID and Device ID are required' });
        }

        // Update only the specific session for this device
        const [result] = await connection.query(
            'UPDATE login_history SET is_active = false, logout_time = NOW() WHERE user_id = ? AND device_id = ? AND is_active = true',
            [userId, deviceId]
        );

        await connection.commit();
        connection.release();

        if (result.affectedRows === 0) {
            return res.status(200).json({ message: 'Already logged out' });
        }

        res.status(200).json({ message: 'Logged out successfully' });

    } catch (error) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Failed to logout' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Fetch Current User
export const fetchCurrentUser = async (req, res) => {
    const pool = await connectDB();
    let connection;
    try {
        connection = await pool.getConnection();

        // Retrieve the user's information based on their ID
        const [users] = await connection.query(`
            SELECT u.id, u.username, u.email, r.role_name as role, u.team_id, t.team_name,
                   u.role_id, u.requires_delete_approval, GROUP_CONCAT(p.permission_name) as permissions
            FROM users u
            LEFT JOIN teams t ON u.team_id = t.id
            LEFT JOIN roles r ON u.role_id = r.id
            LEFT JOIN user_permissions up ON u.id = up.user_id
            LEFT JOIN permissions p ON up.permission_id = p.id AND up.value = true
            WHERE u.id = ?
            GROUP BY u.id
        `, [req.user.userId]);

        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = users[0];
        const permissions = user.permissions ? user.permissions.split(',') : [];

        // Send success response with user information
        res.status(200).json({
            success: true,
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            team_id: user.team_id ? parseInt(user.team_id) : null,
            team_name: user.team_name,
            permissions: permissions,
            requires_delete_approval: user.requires_delete_approval === 1 || user.requires_delete_approval === true
        });
    } catch (error) {
        console.error('Error fetching current user:', error);
        return res.status(500).json({ message: 'Internal server error' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Forgot Password
export const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        const connection = await connectDB();

        // Check if user exists
        const [users] = await connection.query('SELECT id, email, username FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const user = users[0];

        // Generate a temporary token (this won't be stored in DB)
        const tempToken = crypto.createHash('sha256')
            .update(user.id + user.email + Date.now().toString())
            .digest('hex');


        // Create reset URL
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:2000'}/reset-password/${tempToken}`;

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset Request</h1>
                <p>Hello ${user.username},</p>
                <p>You requested a password reset. Click the link below to reset your password:</p>
                <a href="${resetUrl}" style="
                    background-color: #EF6F53;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    display: inline-block;
                    margin: 20px 0;
                ">Reset Password</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'Password reset link has been sent to your email' });

    } catch (error) {
        console.error('Error in forgot password:', error);
        res.status(500).json({ message: 'Failed to send reset email' });
    }
};



// Send OTP (Reset Password Link)
export const sendOTP = async (req, res) => {
    try {
        const { email } = req.body;

        const connection = await connectDB();

        // Check if the user exists
        const [users] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);

        if (users.length === 0) {
            return res.status(400).json({
                message: 'The email address you entered is not associated with an account.'
            });
        }

        const user = users[0];

        // Generate token with user ID
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });
        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${user.id}/${token}`;

        // Mail options
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request - Multycomm CRM',
            html: `
                <h2>Password Reset Request</h2>
                <p>Dear ${user.username},</p>
                <p>We received a request to reset your password. Here are your account details:</p>
                <ul>
                    <li>Username: ${user.username}</li>
                    <li>Email: ${email}</li>
                </ul>
                <p>Click the link below to reset your password:</p>
                <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #EF6F53; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
               
                <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
                <p>Best regards,<br>Multycomm Team</p>
            `
        };

        // Send mail using Promise
        await transporter.sendMail(mailOptions);
        return res.status(200).json({
            message: 'Password reset link has been sent to your email. Please check your inbox.'
        });

    } catch (error) {
        console.error('Error sending link:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reset Password with Token
export const resetPasswordWithToken = async (req, res) => {
    try {
        const { id, token } = req.params;
        const { newPassword } = req.body;

        // Password validation
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
        }

        // Check for at least one number
        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one number' });
        }

        // Verify token
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(400).json({ message: "Invalid or expired token" });
            }

            // Verify that the token was generated for this user
            if (decoded.userId !== parseInt(id)) {
                return res.status(400).json({ message: "Invalid token for this user" });
            }

            try {
                const connection = await connectDB();

                // Hash the new password
                const hashedPassword = await bcrypt.hash(newPassword, 10);

                // Update password only - updated_at will be automatically updated
                await connection.query(
                    'UPDATE users SET password = ? WHERE id = ?',
                    [hashedPassword, id]
                );

                res.status(200).json({ message: 'Password reset successful' });
            } catch (error) {
                console.error('Error updating password:', error);
                res.status(500).json({ message: 'Failed to update password' });
            }
        });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reset Password
export const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    try {
        // Password validation
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
        }

        // Check for at least one number
        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one number' });
        }

        // Verify JWT token
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }

            try {
                const connection = await connectDB();

                // Hash the new password
                const hashedPassword = await bcrypt.hash(newPassword, 10);

                // Update password using the email from the token
                await connection.query(
                    'UPDATE users SET password = ? WHERE email = ?',
                    [hashedPassword, decoded.email]
                );

                res.status(200).json({ message: 'Password reset successful' });
            } catch (error) {
                console.error('Error updating password:', error);
                res.status(500).json({ message: 'Failed to update password' });
            }
        });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Check session status
export const checkSession = async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const deviceId = req.headers['x-device-id'];

    if (!token || !deviceId) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            forceLogout: true
        });
    }

    let connection;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get the latest active session for this user
        const [sessions] = await connection.execute(
            'SELECT * FROM login_history WHERE user_id = ? AND is_active = true ORDER BY login_time DESC LIMIT 1',
            [decoded.userId]
        );

        if (sessions.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'No active session found',
                forceLogout: true
            });
        }

        const latestSession = sessions[0];

        // Check if this device is the latest active session
        if (latestSession.device_id !== deviceId || latestSession.id !== decoded.sessionId) {
            return res.status(401).json({
                success: false,
                message: 'Session invalidated due to login from another device',
                forceLogout: true
            });
        }

        // Session is valid
        res.status(200).json({
            success: true,
            message: 'Session is valid'
        });
    } catch (error) {
        logger.error(`Check session error: ${error.message}`);
        res.status(401).json({
            success: false,
            message: 'Your session has expired.',
            forceLogout: true
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
