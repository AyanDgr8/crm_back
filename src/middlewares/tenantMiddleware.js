// src/middlewares/tenantMiddleware.js
// Resolve company from X-Account-ID header for external API access

import connectDB from '../db/index.js';

/**
 * Middleware: Reads X-Account-ID header, resolves the company,
 * and attaches req.tenant = { id, company_name, account_key }
 * 
 * If the header is missing or invalid, returns 400/401.
 */
export const resolveTenant = async (req, res, next) => {
    const accountKey = req.headers['x-account-id'];

    if (!accountKey) {
        return res.status(400).json({
            success: false,
            error: 'Missing X-Account-ID header'
        });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [companies] = await connection.query(
            'SELECT id, company_name, account_key, is_active FROM companies WHERE account_key = ?',
            [accountKey]
        );

        if (companies.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid X-Account-ID'
            });
        }

        const company = companies[0];

        if (!company.is_active) {
            return res.status(403).json({
                success: false,
                error: 'Company account is inactive'
            });
        }

        // Attach tenant context to request
        req.tenant = {
            id: company.id,
            company_name: company.company_name,
            account_key: company.account_key
        };

        next();
    } catch (error) {
        console.error('Tenant resolution error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve tenant'
        });
    } finally {
        if (connection) connection.release();
    }
};
