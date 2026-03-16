// src/controllers/companies.js
// Super Admin controller for managing companies (tenants)

import connectDB from '../db/index.js';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';
import { logger } from '../logger.js';

const SALT_ROUNDS = 10;

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

/**
 * Create a new company with Business Head
 * Only accessible by super_admin
 */
export const createCompany = async (req, res) => {
    const {
        company_name,
        company_email,
        company_username,
        license_limit,    // kept for backward compat (total)
        admin_limit,      // new: max admin slots
        user_limit,       // new: max user slots
        bh_username,
        bh_email
    } = req.body;

    // Validation
    if (!company_name || !company_email || !company_username || !bh_username || !bh_email) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: company_name, company_email, company_username, bh_username, bh_email'
        });
    }

    // Require either license_limit OR both admin_limit + user_limit
    const hasLegacyLimit = license_limit && license_limit > 0;
    const hasSplitLimit = admin_limit >= 0 && user_limit >= 0;
    if (!hasLegacyLimit && !hasSplitLimit) {
        return res.status(400).json({
            success: false,
            message: 'Provide either license_limit or both admin_limit and user_limit'
        });
    }

    // Compute split values
    const effectiveAdminLimit = admin_limit !== undefined ? parseInt(admin_limit) : Math.max(1, Math.floor(license_limit * 0.3));
    const effectiveUserLimit = user_limit !== undefined ? parseInt(user_limit) : Math.max(1, Math.floor(license_limit * 0.7));
    const effectiveTotal = license_limit || (effectiveAdminLimit + effectiveUserLimit);

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if company already exists
        const [existingCompany] = await connection.query(
            'SELECT id FROM companies WHERE company_name = ? OR company_email = ?',
            [company_name, company_email]
        );

        if (existingCompany.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Company name or email already exists'
            });
        }

        // Check if BH email already exists
        const [existingUser] = await connection.query(
            'SELECT id FROM users WHERE email = ?',
            [bh_email]
        );

        if (existingUser.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Business Head email already exists'
            });
        }

        // Create company
        const [companyResult] = await connection.query(
            `INSERT INTO companies (company_name, company_email, license_limit, admin_limit, user_limit, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [company_name, company_email, effectiveTotal, effectiveAdminLimit, effectiveUserLimit, req.user.userId]
        );

        const companyId = companyResult.insertId;

        // Initialize company license with split tracking
        await connection.query(
            `INSERT INTO company_licenses
             (company_id, total_licenses, used_licenses, total_admin_licenses, used_admin_licenses, total_user_licenses, used_user_licenses)
             VALUES (?, ?, 0, ?, 0, ?, 0)`,
            [companyId, effectiveTotal, effectiveAdminLimit, effectiveUserLimit]
        );

        // Also update companies table with split limits
        await connection.query(
            'UPDATE companies SET admin_limit = ?, user_limit = ? WHERE id = ?',
            [effectiveAdminLimit, effectiveUserLimit, companyId]
        );

        // Get business_head role ID
        const [bhRole] = await connection.query(
            'SELECT id FROM roles WHERE role_name = ?',
            ['business_head']
        );

        // Create Business Head user with default password
        const defaultPassword = '12345678';
        const hashedPassword = await bcrypt.hash(defaultPassword, SALT_ROUNDS);

        const [bhResult] = await connection.query(
            `INSERT INTO users (company_id, username, email, password, role_id, is_company_admin)
             VALUES (?, ?, ?, ?, ?, true)`,
            [companyId, bh_username, bh_email, hashedPassword, bhRole[0].id]
        );

        // Assign all permissions to Business Head
        const [permissions] = await connection.query('SELECT id FROM permissions');

        for (const permission of permissions) {
            await connection.query(
                'INSERT INTO user_permissions (user_id, permission_id, value) VALUES (?, ?, true)',
                [bhResult.insertId, permission.id]
            );
        }

        // Send welcome email to Business Head
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: bh_email,
            subject: `Welcome to ${company_name} - CRM Access`,
            html: `
                <h2>Welcome to ${company_name}!</h2>
                <p>Your company has been registered in our CRM system.</p>
                <p><strong>Company Details:</strong></p>
                <ul>
                    <li>Company Name: ${company_name}</li>
                    <li>Total License Limit: ${effectiveTotal} users</li>
                    <li>Admin Licenses: ${effectiveAdminLimit}</li>
                    <li>User Licenses: ${effectiveUserLimit}</li>
                </ul>
                <p><strong>Your Login Credentials:</strong></p>
                <ul>
                    <li>Username: ${bh_username}</li>
                    <li>Email: ${bh_email}</li>
                    <li>Password: <strong>${defaultPassword}</strong></li>
                </ul>
                <p>Please change your password after your first login.</p>
                <a href="${process.env.FRONTEND_URL}/login" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px;">Login Now</a>
                <p>Best regards,<br>CRM Admin Team</p>
            `
        };

        await transporter.sendMail(mailOptions);

        await connection.commit();

        logger.info(`Company created: ${company_name} (ID: ${companyId}) by user ${req.user.userId}`);

        res.status(201).json({
            success: true,
            message: 'Company and IT Admin created successfully',
            data: {
                company_id: companyId,
                company_name,
                bh_username,
                admin_limit: effectiveAdminLimit,
                user_limit: effectiveUserLimit,
                total_licenses: effectiveTotal
            }
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        logger.error('Error creating company:', error);
        res.status(500).json({
            success: false,
            message: ''
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Get all companies
 * Only accessible by super_admin
 */
export const getAllCompanies = async (req, res) => {
    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [companies] = await connection.query(`
            SELECT
                c.id,
                c.company_name,
                c.company_email,
                c.is_active,
                c.subscription_start,
                c.subscription_end,
                c.admin_limit,
                c.user_limit,
                cl.total_licenses,
                cl.used_licenses,
                cl.available_licenses,
                cl.total_admin_licenses,
                cl.used_admin_licenses,
                cl.total_user_licenses,
                cl.used_user_licenses,
                (SELECT COUNT(*) FROM users WHERE company_id = c.id) as total_users,
                (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as total_customers,
                (SELECT username FROM users WHERE company_id = c.id AND is_company_admin = true LIMIT 1) as bh_username,
                c.created_at
            FROM companies c
            LEFT JOIN company_licenses cl ON c.id = cl.company_id
            ORDER BY c.created_at DESC
        `);

        res.json({
            success: true,
            data: companies
        });

    } catch (error) {
        logger.error('Error fetching companies:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch companies'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Get single company details
 * Accessible by super_admin or company's business_head
 */
export const getCompanyById = async (req, res) => {
    const { id } = req.params;

    // Authorization check
    if (req.user.role !== 'super_admin' && req.user.company_id !== parseInt(id)) {
        return res.status(403).json({
            success: false,
            message: 'Access denied'
        });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [companies] = await connection.query(`
            SELECT 
                c.*,
                cl.total_licenses,
                cl.used_licenses,
                cl.available_licenses,
                (SELECT COUNT(*) FROM users WHERE company_id = c.id) as total_users,
                (SELECT COUNT(*) FROM customers WHERE company_id = c.id) as total_customers,
                (SELECT COUNT(*) FROM teams WHERE company_id = c.id) as total_teams
            FROM companies c
            LEFT JOIN company_licenses cl ON c.id = cl.company_id
            WHERE c.id = ?
        `, [id]);

        if (companies.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        res.json({
            success: true,
            data: companies[0]
        });

    } catch (error) {
        logger.error('Error fetching company:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch company'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Update company details
 * Only accessible by super_admin
 */
export const updateCompany = async (req, res) => {
    const { id } = req.params;
    const { company_name, company_email, license_limit, admin_limit, user_limit, is_active, subscription_start, subscription_end } = req.body;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Check if company exists
        const [existing] = await connection.query('SELECT id FROM companies WHERE id = ?', [id]);
        if (existing.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Update company
        const updates = [];
        const values = [];

        if (company_name !== undefined) {
            updates.push('company_name = ?');
            values.push(company_name);
        }
        if (company_email !== undefined) {
            updates.push('company_email = ?');
            values.push(company_email);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            values.push(is_active);
        }
        if (subscription_start !== undefined) {
            updates.push('subscription_start = ?');
            values.push(subscription_start);
        }
        if (subscription_end !== undefined) {
            updates.push('subscription_end = ?');
            values.push(subscription_end);
        }

        if (updates.length > 0) {
            values.push(id);
            await connection.query(
                `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        }

        if (license_limit !== undefined || admin_limit !== undefined || user_limit !== undefined) {
            const licUpdates = [];
            const licValues = [];

            if (license_limit !== undefined) {
                licUpdates.push('total_licenses = ?');
                licValues.push(license_limit);
            }
            if (admin_limit !== undefined) {
                licUpdates.push('total_admin_licenses = ?');
                licValues.push(admin_limit);
                updates.push('admin_limit = ?');
                values.push(admin_limit);
            }
            if (user_limit !== undefined) {
                licUpdates.push('total_user_licenses = ?');
                licValues.push(user_limit);
                updates.push('user_limit = ?');
                values.push(user_limit);
            }

            if (licUpdates.length > 0) {
                licValues.push(id);
                await connection.query(
                    `UPDATE company_licenses SET ${licUpdates.join(', ')} WHERE company_id = ?`,
                    licValues
                );
            }
        }

        await connection.commit();

        logger.info(`Company updated: ID ${id} by user ${req.user.userId}`);

        res.json({
            success: true,
            message: 'Company updated successfully'
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        logger.error('Error updating company:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update company'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Deactivate company
 * Only accessible by super_admin
 */
export const deactivateCompany = async (req, res) => {
    const { id } = req.params;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        await connection.query(
            'UPDATE companies SET is_active = false WHERE id = ?',
            [id]
        );

        logger.info(`Company deactivated: ID ${id} by user ${req.user.userId}`);

        res.json({
            success: true,
            message: 'Company deactivated successfully'
        });

    } catch (error) {
        logger.error('Error deactivating company:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to deactivate company'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

/**
 * Get full company hierarchy (Depts -> Sub-Depts -> Teams)
 * Only accessible by super_admin
 */
export const getCompanyHierarchy = async (req, res) => {
    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        // Fetch all companies
        const [companies] = await connection.query('SELECT id, company_name FROM companies WHERE is_active = true');

        const hierarchy = [];

        for (const company of companies) {
            // Fetch depts
            const [depts] = await connection.query(
                'SELECT id, department_name FROM departments WHERE company_id = ? AND is_active = true',
                [company.id]
            );

            const companyNode = {
                ...company,
                departments: []
            };

            for (const dept of depts) {
                // Fetch sub-depts
                const [subDepts] = await connection.query(
                    'SELECT id, sub_department_name FROM sub_departments WHERE department_id = ? AND is_active = true',
                    [dept.id]
                );

                const deptNode = {
                    ...dept,
                    sub_departments: []
                };

                for (const sd of subDepts) {
                    // Fetch teams for sub-dept
                    const [teams] = await connection.query(
                        'SELECT id, team_name FROM teams WHERE sub_department_id = ?',
                        [sd.id]
                    );
                    deptNode.sub_departments.push({
                        ...sd,
                        teams
                    });
                }

                // Fetch teams directly under dept (no sub-dept)
                const [deptTeams] = await connection.query(
                    'SELECT id, team_name FROM teams WHERE department_id = ? AND (sub_department_id IS NULL OR sub_department_id = 0)',
                    [dept.id]
                );
                deptNode.teams = deptTeams;

                companyNode.departments.push(deptNode);
            }

            hierarchy.push(companyNode);
        }

        res.json({
            success: true,
            data: hierarchy
        });

    } catch (error) {
        logger.error('Error fetching company hierarchy:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch company hierarchy'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
