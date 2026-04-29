// src/controllers/accountController.js
// Generate and fetch X-Account-ID (account_key) for companies

import crypto from 'crypto';
import connectDB from '../db/index.js';
import { logger } from '../logger.js';

/**
 * POST /api/account/generate
 * Generate a unique account_key for a company
 * Body: { "company_id": 1 }
 */
export const generateAccountKey = async (req, res) => {
    const { company_id } = req.body;

    if (!company_id) {
        return res.status(400).json({
            success: false,
            message: 'company_id is required'
        });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Check if company exists
        const [companies] = await connection.query(
            'SELECT id, company_name, account_key FROM companies WHERE id = ?',
            [company_id]
        );

        if (companies.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const company = companies[0];

        // Idempotent: if key already exists, return it (200) — never regenerate
        if (company.account_key) {
            return res.status(200).json({
                success: true,
                company_id: company.id,
                account_key: company.account_key
            });
        }

        // Generate fully opaque key — no slug prefix, no company info leaked
        const accountKey = crypto.randomBytes(32).toString('hex');

        // Save to DB
        await connection.query(
            'UPDATE companies SET account_key = ? WHERE id = ?',
            [accountKey, company_id]
        );

        logger.info(`Account key generated for company ${company_id}`);

        res.status(201).json({
            success: true,
            company_id: company.id,
            account_key: accountKey
        });

    } catch (error) {
        logger.error('Error generating account key:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate account key'
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * GET /api/account/:company_id
 * Fetch the account_key for a company
 */
export const getAccountKey = async (req, res) => {
    const { company_id } = req.params;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [companies] = await connection.query(
            'SELECT id, company_name, account_key FROM companies WHERE id = ?',
            [company_id]
        );

        if (companies.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        const company = companies[0];

        if (!company.account_key) {
            return res.status(404).json({
                success: false,
                message: 'No account key generated yet. Use POST /api/account/generate first.'
            });
        }

        res.status(200).json({
            success: true,
            company_id: company.id,
            account_key: company.account_key
        });

    } catch (error) {
        logger.error('Error fetching account key:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch account key'
        });
    } finally {
        if (connection) connection.release();
    }
};
