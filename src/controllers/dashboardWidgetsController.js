// src/controllers/dashboardWidgetsController.js
// Dynamic Dashboard Widgets — Production Level
//
// ─── SQL Migration (run once) ────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS dashboard_widgets (
//     id              INT PRIMARY KEY AUTO_INCREMENT,
//     user_id         INT NOT NULL,
//     company_id      INT NOT NULL,
//     widget_type     ENUM('bar','pie','kpi') NOT NULL DEFAULT 'bar',
//     field_name      VARCHAR(100) NOT NULL,
//     field_label     VARCHAR(150) NOT NULL,
//     accent_color    VARCHAR(20) DEFAULT '#6366f1',
//     widget_size     ENUM('sm','md','lg','xl') DEFAULT 'md',
//     date_range_days INT DEFAULT 30,
//     order_index     INT DEFAULT 0,
//     is_active       BOOLEAN DEFAULT TRUE,
//     created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//     FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
//     FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
//     INDEX idx_user_widgets    (user_id, is_active),
//     INDEX idx_company_widgets (company_id)
// ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
// ─────────────────────────────────────────────────────────────────────────────

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

// Columns that can NEVER be used as GROUP BY dimensions
const BLOCKED_COLUMNS = new Set([
    'id', 'company_id', 'C_unique_id', 'date_created', 'last_updated',
    'team_id', 'department_id', 'sub_department_id', 'assigned_to', 'password',
]);

// Validate a field_name exists in customers and is not blocked
const validateField = async (conn, fieldName) => {
    if (!fieldName || BLOCKED_COLUMNS.has(fieldName)) return false;
    // Only allow safe identifiers (letters, digits, underscores)
    if (!/^[a-zA-Z0-9_]+$/.test(fieldName)) return false;
    const [cols] = await conn.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = 'customers' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ?`,
        [fieldName]
    );
    return cols.length > 0;
};

// ── GET /dashboard/available-fields ───────────────────────────────────────────
export const getAvailableFields = async (req, res) => {
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [cols] = await conn.query(
            `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_NAME = 'customers' AND TABLE_SCHEMA = DATABASE()
               AND COLUMN_NAME NOT IN (
                   'id','company_id','C_unique_id','date_created','last_updated',
                   'team_id','department_id','sub_department_id','assigned_to'
               )
             ORDER BY ORDINAL_POSITION`
        );
        // Only allow groupable types
        const groupable = cols
            .filter(c => {
                const dt = c.DATA_TYPE.toLowerCase();
                const safe = ['enum', 'varchar', 'char', 'int', 'tinyint', 'smallint'].includes(dt);
                const notBig = !c.CHARACTER_MAXIMUM_LENGTH || c.CHARACTER_MAXIMUM_LENGTH <= 255;
                return safe && notBig;
            })
            .map(c => ({
                field_name:  c.COLUMN_NAME,
                field_label: c.COLUMN_NAME
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, ch => ch.toUpperCase()),
                data_type:   c.DATA_TYPE.toLowerCase(),
                is_enum:     c.DATA_TYPE.toLowerCase() === 'enum',
            }));
        res.json({ success: true, fields: groupable });
    } catch (err) {
        logger.error('getAvailableFields error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── GET /dashboard/field-data ─────────────────────────────────────────────────
// Params:
//   field         - GROUP BY column (required)
//   range         - days window, 0 = all time (default 30)
//   filter_field  - optional WHERE column for drill-down
//   filter_value  - optional WHERE value for drill-down
export const getFieldData = async (req, res) => {
    const { field, range = 30, filter_field, filter_value } = req.query;
    const user = req.user;
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();

        // Validate primary GROUP BY field
        const isValid = await validateField(conn, field);
        if (!isValid) {
            return res.status(400).json({ success: false, message: 'Invalid or blocked field name' });
        }

        // Validate optional drill-down filter field
        let filterClause = '';
        let filterParams = [];
        if (filter_field && filter_value !== undefined && filter_value !== null) {
            const isFilterValid = await validateField(conn, filter_field);
            if (!isFilterValid) {
                return res.status(400).json({ success: false, message: 'Invalid filter_field' });
            }
            // filter_value is a user-supplied string — use parameterised binding (safe)
            filterClause = `AND c.\`${filter_field}\` = ?`;
            filterParams = [String(filter_value)];
        }

        const companyId     = user.role === 'super_admin' ? null : user.company_id;
        const rangeClause   = Number(range) > 0
            ? `AND c.date_created >= DATE_SUB(CURDATE(), INTERVAL ${Number(range)} DAY)`
            : '';
        const companyClause = companyId ? 'AND c.company_id = ?' : '';
        const companyParams = companyId ? [companyId] : [];

        const [rows] = await conn.query(
            `SELECT
                COALESCE(NULLIF(TRIM(c.\`${field}\`), ''), 'Not Set') AS label,
                COUNT(*) AS value
             FROM customers c
             WHERE 1=1
               ${rangeClause}
               ${companyClause}
               ${filterClause}
             GROUP BY c.\`${field}\`
             ORDER BY value DESC
             LIMIT 25`,
            [...companyParams, ...filterParams]
        );

        res.json({
            success: true,
            data: rows,
            field,
            range: Number(range),
            // Echo back drill context so frontend can use it
            drill_context: filter_field ? { field: filter_field, value: filter_value } : null,
        });
    } catch (err) {
        logger.error('getFieldData error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── GET /dashboard/widgets ────────────────────────────────────────────────────
export const getWidgets = async (req, res) => {
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT * FROM dashboard_widgets
             WHERE user_id = ? AND is_active = TRUE
             ORDER BY order_index ASC, id ASC`,
            [req.user.userId]
        );
        res.json({ success: true, widgets: rows });
    } catch (err) {
        logger.error('getWidgets error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── POST /dashboard/widgets ───────────────────────────────────────────────────
export const createWidget = async (req, res) => {
    const { widget_type, field_name, field_label, accent_color, widget_size, date_range_days, drill_field } = req.body;
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();

        const isValid = await validateField(conn, field_name);
        if (!isValid) return res.status(400).json({ success: false, message: 'Invalid field name' });

        // Validate optional drill_field
        if (drill_field) {
            const isDrillValid = await validateField(conn, drill_field);
            if (!isDrillValid) return res.status(400).json({ success: false, message: 'Invalid drill_field' });
        }

        const [[{ maxOrd }]] = await conn.query(
            'SELECT COALESCE(MAX(order_index), -1) AS maxOrd FROM dashboard_widgets WHERE user_id = ? AND is_active = TRUE',
            [req.user.userId]
        );

        const [result] = await conn.query(
            `INSERT INTO dashboard_widgets
             (user_id, company_id, widget_type, field_name, field_label, accent_color, widget_size, date_range_days, order_index, drill_field)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.userId, req.user.company_id,
                widget_type || 'bar',
                field_name,
                field_label || field_name.replace(/_/g, ' '),
                accent_color || '#6366f1',
                widget_size || 'md',
                Number(date_range_days) || 30,
                Number(maxOrd) + 1,
                drill_field || null,
            ]
        );

        const [[widget]] = await conn.query('SELECT * FROM dashboard_widgets WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, widget });
    } catch (err) {
        logger.error('createWidget error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── PUT /dashboard/widgets/reorder  (must be before /:id) ────────────────────
export const reorderWidgets = async (req, res) => {
    const { order } = req.body; // [{ id, order_index }, ...]
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'order must be array' });
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        for (const { id, order_index } of order) {
            await conn.query(
                'UPDATE dashboard_widgets SET order_index = ? WHERE id = ? AND user_id = ?',
                [order_index, id, req.user.userId]
            );
        }
        await conn.commit();
        res.json({ success: true });
    } catch (err) {
        if (conn) await conn.rollback();
        logger.error('reorderWidgets error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── PUT /dashboard/widgets/:id ────────────────────────────────────────────────
export const updateWidget = async (req, res) => {
    const { id } = req.params;
    const { widget_type, accent_color, widget_size, date_range_days, field_label, drill_field } = req.body;
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [[w]] = await conn.query(
            'SELECT id FROM dashboard_widgets WHERE id = ? AND user_id = ? AND is_active = TRUE',
            [id, req.user.userId]
        );
        if (!w) return res.status(404).json({ success: false, message: 'Widget not found' });

        // Validate optional drill_field
        if (drill_field) {
            const isDrillValid = await validateField(conn, drill_field);
            if (!isDrillValid) return res.status(400).json({ success: false, message: 'Invalid drill_field' });
        }

        // drill_field can be set to empty string to clear it — handle explicitly
        const drillFieldValue = drill_field === '' ? null : (drill_field || undefined);

        await conn.query(
            `UPDATE dashboard_widgets SET
                widget_type     = COALESCE(?, widget_type),
                accent_color    = COALESCE(?, accent_color),
                widget_size     = COALESCE(?, widget_size),
                date_range_days = COALESCE(?, date_range_days),
                field_label     = COALESCE(?, field_label),
                drill_field     = ${drillFieldValue !== undefined ? '?' : 'drill_field'}
             WHERE id = ?`,
            [
                widget_type, accent_color, widget_size,
                date_range_days ? Number(date_range_days) : null,
                field_label,
                ...(drillFieldValue !== undefined ? [drillFieldValue] : []),
                id,
            ]
        );

        const [[updated]] = await conn.query('SELECT * FROM dashboard_widgets WHERE id = ?', [id]);
        res.json({ success: true, widget: updated });
    } catch (err) {
        logger.error('updateWidget error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── DELETE /dashboard/widgets/:id ─────────────────────────────────────────────
export const deleteWidget = async (req, res) => {
    const { id } = req.params;
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [result] = await conn.query(
            'UPDATE dashboard_widgets SET is_active = FALSE WHERE id = ? AND user_id = ?',
            [id, req.user.userId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Widget not found' });
        res.json({ success: true });
    } catch (err) {
        logger.error('deleteWidget error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) conn.release();
    }
};
