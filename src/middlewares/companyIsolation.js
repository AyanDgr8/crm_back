// src/middlewares/companyIsolation.js
// Middleware to enforce company-level data isolation

/**
 * Ensures that non-super-admin users can only access their company's data
 * This is CRITICAL for multi-tenant security
 */
export const enforceCompanyIsolation = (req, res, next) => {
    // Super admin can access all companies
    if (req.user.role === 'super_admin') {
        return next();
    }

    // All other users MUST have a company_id
    if (!req.user.company_id) {
        return res.status(403).json({
            success: false,
            message: 'Invalid company context. Please contact administrator.'
        });
    }

    next();
};

/**
 * Middleware to check if user has permission to manage users (license validation)
 */
export const checkUserManagementAccess = (req, res, next) => {
    const allowedRoles = ['super_admin', 'business_head'];

    if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Only Business Head or Super Admin can manage users'
        });
    }

    next();
};

/**
 * Middleware to validate company is active
 */
export const checkCompanyActive = async (req, res, next) => {
    // Skip for super admin
    if (req.user.role === 'super_admin') {
        return next();
    }

    try {
        const pool = await connectDB();
        const connection = await pool.getConnection();

        const [companies] = await connection.query(
            'SELECT is_active FROM companies WHERE id = ?',
            [req.user.company_id]
        );

        connection.release();

        if (companies.length === 0 || !companies[0].is_active) {
            return res.status(403).json({
                success: false,
                message: 'Company account is inactive. Please contact administrator.'
            });
        }

        next();
    } catch (error) {
        console.error('Error checking company status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify company status'
        });
    }
};

import connectDB from '../db/index.js';
