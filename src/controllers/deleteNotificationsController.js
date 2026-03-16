// src/controllers/deleteNotificationsController.js
// V17b: Handles lead/customer delete approval workflow

import connectDB from '../db/index.js';
import { insertChangeLog } from './updateCustomers.js';

// ── helper: insert a notification row ────────────────────────────────────────
const insertNotification = async (conn, { userId, type, title, message, refId, companyId }) => {
    await conn.query(
        `INSERT INTO notifications (user_id, type, title, message, ref_id, company_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, type, title, message, refId || null, companyId]
    );
};

// ── helper: find approver for requester ──────────────────────────────────────
// TL → sub_dept_admin in same sub-dept; sub_dept_admin → dept_admin in same dept
const findApprover = async (conn, requester) => {
    if (requester.role === 'team_leader') {
        // Find sub_dept_admin assigned to the SAME sub_department as the TL's team
        // First get the team's sub_dept
        const [teamRows] = await conn.query(
            'SELECT sub_department_id, department_id FROM teams WHERE id = ?',
            [requester.team_id]
        );
        const subDeptId = teamRows[0]?.sub_department_id;

        if (subDeptId) {
            const [rows] = await conn.query(
                `SELECT u.id, u.username, u.company_id
                 FROM users u
                 JOIN roles r ON r.id = u.role_id
                 JOIN admin_departments ad ON ad.user_id = u.id
                 WHERE r.role_name = 'sub_dept_admin'
                   AND ad.sub_department_id = ?
                   AND u.company_id = ?
                 LIMIT 1`,
                [subDeptId, requester.company_id]
            );
            if (rows[0]) return rows[0];
        }

        // Fallback: search for any sub_dept_admin in the same company
        const [fallback] = await conn.query(
            `SELECT u.id, u.username, u.company_id
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE r.role_name = 'sub_dept_admin' AND u.company_id = ?
             LIMIT 1`,
            [requester.company_id]
        );
        return fallback[0] || null;
    }

    if (requester.role === 'sub_dept_admin') {
        // Find dept_admin assigned to the SAME department
        const [adminDepts] = await conn.query(
            'SELECT department_id FROM admin_departments WHERE user_id = ? LIMIT 1',
            [requester.userId]
        );
        const deptId = adminDepts[0]?.department_id;

        if (deptId) {
            const [rows] = await conn.query(
                `SELECT u.id, u.username, u.company_id
                 FROM users u
                 JOIN roles r ON r.id = u.role_id
                 JOIN admin_departments ad ON ad.user_id = u.id
                 WHERE r.role_name = 'dept_admin'
                   AND ad.department_id = ?
                   AND u.company_id = ?
                 LIMIT 1`,
                [deptId, requester.company_id]
            );
            if (rows[0]) return rows[0];
        }

        // Fallback: any dept_admin then business_head in same company
        const [deptAdmins] = await conn.query(
            `SELECT u.id, u.username, u.company_id
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE r.role_name = 'dept_admin' AND u.company_id = ?
             LIMIT 1`,
            [requester.company_id]
        );
        if (deptAdmins[0]) return deptAdmins[0];

        const [bheads] = await conn.query(
            `SELECT u.id, u.username, u.company_id
             FROM users u
             JOIN roles r ON r.id = u.role_id
             WHERE r.role_name = 'business_head' AND u.company_id = ?
             LIMIT 1`,
            [requester.company_id]
        );
        return bheads[0] || null;
    }

    return null;
};

// ── POST /customers/:customerId/request-delete ────────────────────────────────
export const requestDeleteCustomer = async (req, res) => {
    const { customerId } = req.params;
    const requester = req.user;

    if (!['team_leader', 'sub_dept_admin'].includes(requester.role)) {
        return res.status(403).json({ error: 'Only team leaders and sub-dept admins use this endpoint' });
    }

    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Fetch customer details
        const [customers] = await conn.query(
            'SELECT id, first_name, C_unique_id FROM customers WHERE id = ?',
            [customerId]
        );
        if (customers.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Customer not found' });
        }
        const customer = customers[0];
        const customerName = `${customer.first_name}`.trim();

        // Check that requester has requires_delete_approval set
        const [requesterRows] = await conn.query(
            'SELECT requires_delete_approval FROM users WHERE id = ?',
            [requester.userId]
        );
        if (requesterRows.length === 0 || !requesterRows[0].requires_delete_approval) {
            await conn.rollback();
            return res.status(400).json({ error: 'This user does not require approval to delete records' });
        }

        // Check for already-pending request for this customer by this requester
        const [existingReq] = await conn.query(
            `SELECT id FROM delete_approval_requests
             WHERE requester_id = ? AND customer_id = ? AND status = 'pending'`,
            [requester.userId, customerId]
        );
        if (existingReq.length > 0) {
            await conn.rollback();
            return res.status(409).json({ error: 'A pending delete request already exists for this record.' });
        }

        // Find the right approver
        console.log(`[DEBUG] findApprover for requester: ${requester.username} (Role: ${requester.role}, Team: ${requester.team_id})`);
        const approver = await findApprover(conn, requester);
        if (!approver) {
            console.warn(`[DEBUG] No approver found for requester ${requester.username}`);
            await conn.rollback();
            return res.status(400).json({ error: 'No approver found. Contact your administrator.' });
        }
        console.log(`[DEBUG] Approver found: ${approver.username} (ID: ${approver.id})`);

        // Create approval request
        const [insertResult] = await conn.query(
            `INSERT INTO delete_approval_requests
             (requester_id, customer_id, customer_name, approver_id, status, company_id)
             VALUES (?, ?, ?, ?, 'pending', ?)`,
            [requester.userId, customerId, customerName, approver.id, requester.company_id]
        );
        const requestId = insertResult.insertId;
        console.log(`[DEBUG] Delete approval request created: ID ${requestId}`);

        // Notify the approver
        await insertNotification(conn, {
            userId: approver.id,
            type: 'delete_request',
            title: '🗑️ Lead Delete Approval Required',
            message: `${requester.username} wants to delete the record for "${customerName}". Please approve or reject.`,
            refId: requestId,
            companyId: requester.company_id
        });
        console.log(`[DEBUG] Notification sent to approver ${approver.id}`);

        // Log delete request to history
        await insertChangeLog(conn, customerId, customer.C_unique_id, [
            {
                field: 'delete_request',
                oldValue: 'Active',
                newValue: 'Pending Approval'
            }
        ], requester.username, requester.company_id);

        await conn.commit();
        res.status(202).json({
            message: `Delete request for "${customerName}" sent for approval. You will be notified once reviewed.`,
            requestId
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('Error in requestDeleteCustomer:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── PATCH /customer-delete-requests/:requestId/resolve ────────────────────────
export const resolveCustomerDeleteRequest = async (req, res) => {
    const { requestId } = req.params;
    const { action } = req.body; // 'approved' | 'rejected'
    const approver = req.user;

    if (!['approved', 'rejected'].includes(action)) {
        return res.status(400).json({ error: 'action must be "approved" or "rejected"' });
    }

    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Fetch the request
        const [rows] = await conn.query(
            'SELECT * FROM delete_approval_requests WHERE id = ? AND status = ?',
            [requestId, 'pending']
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: 'Request not found or already resolved' });
        }
        const request = rows[0];

        // Fetch customer C_unique_id for logging
        const [customerRows] = await conn.query(
            'SELECT C_unique_id FROM customers WHERE id = ?',
            [request.customer_id]
        );
        const C_unique_id = customerRows[0]?.C_unique_id;

        // Verify this user is the assigned approver
        if (request.approver_id !== approver.userId) {
            await conn.rollback();
            return res.status(403).json({ error: 'You are not the assigned approver for this request' });
        }

        // Update request status
        await conn.query(
            'UPDATE delete_approval_requests SET status = ?, resolved_at = NOW() WHERE id = ?',
            [action, requestId]
        );

        const customerName = request.customer_name || `Record #${request.customer_id}`;

        if (action === 'approved') {
            // Log final approval before deletion
            if (C_unique_id) {
                await insertChangeLog(conn, request.customer_id, C_unique_id, [
                    {
                        field: 'delete_request',
                        oldValue: 'Pending Approval',
                        newValue: 'Approved'
                    }
                ], approver.username, approver.company_id);
            }

            // Delete associated updates first (FK constraint)
            await conn.query('DELETE FROM updates_customer WHERE customer_id = ?', [request.customer_id]);
            // Delete the customer record
            await conn.query('DELETE FROM customers WHERE id = ?', [request.customer_id]);
        } else {
            // Log rejection
            if (C_unique_id) {
                await insertChangeLog(conn, request.customer_id, C_unique_id, [
                    {
                        field: 'delete_request',
                        oldValue: 'Pending Approval',
                        newValue: 'Rejected'
                    }
                ], approver.username, approver.company_id);
            }
        }

        // Notify the requester of the outcome
        await insertNotification(conn, {
            userId: request.requester_id,
            type: action === 'approved' ? 'delete_approved' : 'delete_rejected',
            title: action === 'approved'
                ? '✅ Delete Request Approved'
                : '❌ Delete Request Rejected',
            message: action === 'approved'
                ? `Your request to delete "${customerName}" was approved by ${approver.username}. The record has been removed.`
                : `Your request to delete "${customerName}" was rejected by ${approver.username}. The record remains active.`,
            refId: requestId,
            companyId: approver.company_id
        });

        await conn.commit();
        res.json({
            success: true,
            action,
            customerName,
            message: action === 'approved'
                ? `Record "${customerName}" has been deleted.`
                : `Delete request for "${customerName}" was rejected.`
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error('Error in resolveCustomerDeleteRequest:', err);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    } finally {
        if (conn) conn.release();
    }
};

// ── GET /customer-delete-requests/pending ─────────────────────────────────────
export const getPendingCustomerApprovals = async (req, res) => {
    console.log(`[DEBUG] getPendingCustomerApprovals called for user: ${req.user.username} (ID: ${req.user.userId})`);
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT dar.id, dar.customer_id, dar.customer_name, dar.created_at,
                    u.username AS requester_name, u.id AS requester_id
             FROM delete_approval_requests dar
             JOIN users u ON u.id = dar.requester_id
             WHERE dar.approver_id = ? AND dar.status = 'pending'
             ORDER BY dar.created_at DESC`,
            [req.user.userId]
        );
        console.log(`[DEBUG] getPendingCustomerApprovals found ${rows.length} pending requests for user ${req.user.userId}`);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Error in getPendingCustomerApprovals:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (conn) conn.release();
    }
};

// ── GET /notifications ────────────────────────────────────────────────────────
export const getNotifications = async (req, res) => {
    console.log(`[DEBUG] getNotifications called for user: ${req.user.username} (ID: ${req.user.userId})`);
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query(
            `SELECT * FROM notifications
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 50`,
            [req.user.userId]
        );
        const unread = rows.filter(n => !n.is_read).length;
        console.log(`[DEBUG] getNotifications found ${rows.length} notifications (${unread} unread) for user ${req.user.userId}`);
        res.json({ success: true, data: rows, unreadCount: unread });
    } catch (err) {
        console.error('Error in getNotifications:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (conn) conn.release();
    }
};

// ── PATCH /notifications/read-all ────────────────────────────────────────────
export const markAllNotificationsRead = async (req, res) => {
    const pool = connectDB();
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ?',
            [req.user.userId]
        );
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        console.error('Error in markAllNotificationsRead:', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (conn) conn.release();
    }
};
