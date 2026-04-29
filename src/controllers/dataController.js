// src/controllers/dataController.js
// CRUD for tenant-scoped data records (tenant_data table)

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

/**
 * POST /api/data
 * Create a new data record scoped to the tenant
 * Requires: resolveTenant middleware (req.tenant.id)
 * Body: { "name": "...", "description": "..." }
 */
export const createData = async (req, res) => {
    const { name, description } = req.body;
    const companyId = req.tenant.id;

    if (!name) {
        return res.status(400).json({
            success: false,
            message: 'name is required'
        });
    }

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [result] = await connection.query(
            'INSERT INTO tenant_data (company_id, name, description) VALUES (?, ?, ?)',
            [companyId, name, description || null]
        );

        const [rows] = await connection.query(
            'SELECT * FROM tenant_data WHERE id = ?',
            [result.insertId]
        );

        logger.info(`Data record created: ID ${result.insertId} for company ${companyId}`);

        res.status(201).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        logger.error('Error creating data record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create data record'
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * GET /api/data
 * Get all data records for the tenant
 */
export const getAllData = async (req, res) => {
    const companyId = req.tenant.id;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [rows] = await connection.query(
            'SELECT * FROM tenant_data WHERE company_id = ? ORDER BY created_at DESC',
            [companyId]
        );

        res.status(200).json({
            success: true,
            data: rows
        });

    } catch (error) {
        logger.error('Error fetching data records:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch data records'
        });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * GET /api/data/:id
 * Get a single data record by ID, scoped to tenant
 */
export const getDataById = async (req, res) => {
    const { id } = req.params;
    const companyId = req.tenant.id;

    let connection;
    try {
        const pool = connectDB();
        connection = await pool.getConnection();

        const [rows] = await connection.query(
            'SELECT * FROM tenant_data WHERE id = ? AND company_id = ?',
            [id, companyId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Record not found'
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        logger.error('Error fetching data record:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch data record'
        });
    } finally {
        if (connection) connection.release();
    }
};
