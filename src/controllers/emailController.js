// src/controllers/emailController.js

import fs from 'fs';
import path from 'path';
import connectDB from '../db/index.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// ─── Shared transporter (same pattern as sign.js) ────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// ─── Helper: resolve template variables ──────────────────────────────────────
const resolveVars = (text, vars) => {
    if (!text) return '';
    return text
        .replace(/\{\{customer_name\}\}/g,  vars.customer_name  || '')
        .replace(/\{\{customer_phone\}\}/g, vars.customer_phone || '')
        .replace(/\{\{customer_email\}\}/g, vars.customer_email || '')
        .replace(/\{\{agent_name\}\}/g,     vars.agent_name     || '')
        .replace(/\{\{company_name\}\}/g,   vars.company_name   || '')
        .replace(/\{\{date\}\}/g,           vars.date           || '');
};

// ─── Helper: scope-check → returns true if the sender can access this customer
const senderCanAccessCustomer = async (connection, user, customerId) => {
    const { userId, role, company_id, team_id, username } = user;

    if (role === 'super_admin') return true;

    // Fetch the customer's basic scope fields
    const [rows] = await connection.query(
        `SELECT id, company_id, department_id, sub_department_id, agent_name, assigned_to, team_id
         FROM customers WHERE id = ?`,
        [customerId]
    );
    if (rows.length === 0) return false;
    const c = rows[0];

    if (String(c.company_id) !== String(company_id)) return false;

    if (role === 'business_head') return true;

    if (role === 'dept_admin' || role === 'admin') {
        const [adminDepts] = await connection.query(
            `SELECT DISTINCT department_id FROM admin_departments WHERE user_id = ?`,
            [userId]
        );
        const deptIds = adminDepts.map(d => d.department_id);
        return deptIds.includes(c.department_id);
    }

    if (role === 'sub_dept_admin') {
        const [adminDepts] = await connection.query(
            `SELECT DISTINCT sub_department_id FROM admin_departments WHERE user_id = ?`,
            [userId]
        );
        const subDeptIds = adminDepts.map(d => d.sub_department_id).filter(Boolean);
        return subDeptIds.includes(c.sub_department_id);
    }

    if (role === 'team_leader') {
        return String(c.team_id) === String(team_id);
    }

    // Regular agent/user — must be assigned
    return (
        c.agent_name === username ||
        String(c.assigned_to) === String(userId)
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /email/send
// ─────────────────────────────────────────────────────────────────────────────
export const sendEmailToCustomer = async (req, res) => {
    let connection;
    try {
        const { customer_id, subject, body, template_id, attachmentPaths: bodyPaths } = req.body;
        const user = req.user;

        // Merge paths: those already uploaded + those being uploaded now
        const uploadedFiles = req.files ? req.files.map(f => `/uploads/email_attachments/${f.filename}`) : [];
        const attachmentPaths = [...(bodyPaths || []), ...uploadedFiles];

        if (!customer_id || !subject || !body) {
            return res.status(400).json({ success: false, message: 'customer_id, subject and body are required' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        // 1. Scope check
        const allowed = await senderCanAccessCustomer(connection, user, customer_id);
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'You do not have access to this customer' });
        }

        // 2. Fetch customer
        const [customers] = await connection.query(
            `SELECT id, first_name, phone_no, email_id, agent_name, company_id, company_id as company_id_fixed FROM customers WHERE id = ?`,
            [customer_id]
        );
        if (customers.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        const customer = customers[0];

        if (!customer.email_id) {
            return res.status(422).json({ success: false, message: 'Customer has no email address on record' });
        }

        // 3. Fetch company name
        const [companies] = await connection.query(
            `SELECT company_name FROM companies WHERE id = ?`,
            [customer.company_id]
        );
        const companyName = companies[0]?.company_name || '';

        // 4. Resolve variables
        const vars = {
            customer_name:  (customer.first_name || '').trim(),
            customer_phone: customer.phone_no || '',
            customer_email: customer.email_id || '',
            agent_name:     user.username || '',
            company_name:   companyName,
            date:           new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        };
        const resolvedSubject = resolveVars(subject, vars);
        const resolvedBody    = resolveVars(body, vars);

        // 5. Send email
        const mailOptions = {
            from: `"${companyName} CRM" <${process.env.EMAIL_USER}>`,
            to: customer.email_id,
            subject: resolvedSubject,
            html: resolvedBody.replace(/\n/g, '<br>'),
            attachments: attachmentPaths?.map(filePath => {
                const absolutePath = path.join(process.cwd(), filePath.replace(/^\//, ''));
                if (fs.existsSync(absolutePath)) {
                    return {
                        filename: path.basename(filePath),
                        path: absolutePath
                    };
                }
                return null;
            }).filter(Boolean) || []
        };

        let status = 'sent';
        let errorMsg = null;
        try {
            await transporter.sendMail(mailOptions);
        } catch (mailErr) {
            console.error('Mail send error:', mailErr);
            status = 'failed';
            errorMsg = mailErr.message;
        }

        // 6. Log to email_logs
        await connection.query(
            `INSERT INTO email_logs (company_id, customer_id, sent_by, template_id, subject, body, recipient, attachments, status, error_msg)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user.company_id || customer.company_id,
                customer_id,
                user.userId,
                template_id || null,
                resolvedSubject,
                resolvedBody,
                customer.email_id,
                attachmentPaths ? JSON.stringify(attachmentPaths) : null,
                status,
                errorMsg
            ]
        );

        if (status === 'failed') {
            return res.status(500).json({ success: false, message: 'Email failed to send', error: errorMsg });
        }

        return res.json({ success: true, message: `Email sent to ${customer.email_id}` });

    } catch (err) {
        console.error('sendEmailToCustomer error:', err);
        return res.status(500).json({ success: false, message: 'Server error', error: err.message });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /email/upload-attachment
// ─────────────────────────────────────────────────────────────────────────────
export const uploadEmailAttachment = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const filePaths = req.files.map(file => {
            return `/uploads/email_attachments/${file.filename}`;
        });

        res.json({
            success: true,
            filePaths: filePaths
        });
    } catch (error) {
        console.error('Error in uploadEmailAttachment:', error);
        res.status(500).json({ success: false, message: 'Failed to upload attachment' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /email/templates
// ─────────────────────────────────────────────────────────────────────────────
export const getEmailTemplates = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const companyId = req.user.role === 'super_admin' ? null : req.user.company_id;

        let sql = `
            SELECT et.*, u.username AS created_by_name
            FROM email_templates et
            LEFT JOIN users u ON et.created_by = u.id
        `;
        const params = [];
        if (companyId) {
            sql += ' WHERE et.company_id = ?';
            params.push(companyId);
        }
        sql += ' ORDER BY et.created_at DESC';

        const [templates] = await connection.query(sql, params);
        return res.json({ success: true, data: templates });

    } catch (err) {
        console.error('getEmailTemplates error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /email/templates
// ─────────────────────────────────────────────────────────────────────────────
export const createEmailTemplate = async (req, res) => {
    let connection;
    try {
        const { name, subject, body } = req.body;
        const user = req.user;

        // Only admins can create templates
        const allowedRoles = ['super_admin', 'business_head', 'dept_admin', 'sub_dept_admin'];
        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Only admins can create email templates' });
        }

        if (!name?.trim() || !subject?.trim() || !body?.trim()) {
            return res.status(400).json({ success: false, message: 'name, subject and body are required' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        const [result] = await connection.query(
            `INSERT INTO email_templates (company_id, name, subject, body, created_by) VALUES (?, ?, ?, ?, ?)`,
            [user.company_id, name.trim(), subject.trim(), body.trim(), user.userId]
        );

        return res.status(201).json({
            success: true,
            message: 'Template created',
            id: result.insertId
        });

    } catch (err) {
        console.error('createEmailTemplate error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /email/templates/:id
// ─────────────────────────────────────────────────────────────────────────────
export const updateEmailTemplate = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const { name, subject, body } = req.body;
        const user = req.user;

        const allowedRoles = ['super_admin', 'business_head', 'dept_admin', 'sub_dept_admin'];
        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        // Verify ownership (same company)
        const [rows] = await connection.query(
            `SELECT company_id FROM email_templates WHERE id = ?`, [id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Template not found' });
        if (user.role !== 'super_admin' && String(rows[0].company_id) !== String(user.company_id)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await connection.query(
            `UPDATE email_templates SET name = ?, subject = ?, body = ? WHERE id = ?`,
            [name?.trim(), subject?.trim(), body?.trim(), id]
        );

        return res.json({ success: true, message: 'Template updated' });

    } catch (err) {
        console.error('updateEmailTemplate error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /email/templates/:id
// ─────────────────────────────────────────────────────────────────────────────
export const deleteEmailTemplate = async (req, res) => {
    let connection;
    try {
        const { id } = req.params;
        const user = req.user;

        const allowedRoles = ['super_admin', 'business_head', 'dept_admin', 'sub_dept_admin'];
        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({ success: false, message: 'Permission denied' });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        const [rows] = await connection.query(
            `SELECT company_id FROM email_templates WHERE id = ?`, [id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Template not found' });
        if (user.role !== 'super_admin' && String(rows[0].company_id) !== String(user.company_id)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await connection.query(`DELETE FROM email_templates WHERE id = ?`, [id]);
        return res.json({ success: true, message: 'Template deleted' });

    } catch (err) {
        console.error('deleteEmailTemplate error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /email/logs/:customerId
// ─────────────────────────────────────────────────────────────────────────────
export const getEmailLogs = async (req, res) => {
    let connection;
    try {
        const { customerId } = req.params;
        const user = req.user;

        const pool = await connectDB();
        connection = await pool.getConnection();

        // Scope check — can this user see this customer's logs?
        const allowed = await senderCanAccessCustomer(connection, user, customerId);
        if (!allowed) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const [logs] = await connection.query(
            `SELECT el.*, u.username AS sent_by_name, et.name AS template_name
             FROM email_logs el
             LEFT JOIN users u          ON el.sent_by     = u.id
             LEFT JOIN email_templates et ON el.template_id  = et.id
             WHERE el.customer_id = ?
             ORDER BY el.sent_at DESC
             LIMIT 50`,
            [customerId]
        );

        return res.json({ success: true, data: logs });

    } catch (err) {
        console.error('getEmailLogs error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};
