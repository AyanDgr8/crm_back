// src/controllers/deleteCustomers.js

import connectDB from '../db/index.js';
import { insertChangeLog } from './updateCustomers.js';

// ── DB helpers ────────────────────────────────────────────────────────────────
const deleteCustomerUpdates = async (connection, customerId) => {
  await connection.execute(
    'DELETE FROM updates_customer WHERE customer_id = ?',
    [customerId]
  );
};

const deleteCustomerRecord = async (connection, customerId) => {
  await connection.execute(
    'DELETE FROM customers WHERE id = ?',
    [customerId]
  );
};

// ── helper: does this requester need approval? ────────────────────────────────
const needsApproval = (user) => {
  const approvalRoles = ['team_leader', 'sub_dept_admin'];
  return approvalRoles.includes(user.role) && user.requires_delete_approval === true;
};

// ── helper: find approver for the requester ───────────────────────────────────
// Mirrors findApprover in deleteNotificationsController (kept in sync)
const findApproverIdForUser = async (conn, requester) => {
  if (requester.role === 'team_leader') {
    // Find sub_dept_admin assigned to the SAME sub_department as the TL's team
    const [teamRows] = await conn.query(
      'SELECT sub_department_id FROM teams WHERE id = ?',
      [requester.team_id]
    );
    const subDeptId = teamRows[0]?.sub_department_id;

    if (subDeptId) {
      const [rows] = await conn.query(
        `SELECT u.id FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN admin_departments ad ON ad.user_id = u.id
         WHERE r.role_name = 'sub_dept_admin' 
           AND ad.sub_department_id = ?
           AND u.company_id = ?
         LIMIT 1`,
        [subDeptId, requester.company_id]
      );
      if (rows[0]) return rows[0].id;
    }

    // Fallback: any sub_dept_admin in same company
    const [fallback] = await conn.query(
      `SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = 'sub_dept_admin' AND u.company_id = ?
       LIMIT 1`,
      [requester.company_id]
    );
    return fallback[0]?.id || null;
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
        `SELECT u.id FROM users u
         JOIN roles r ON r.id = u.role_id
         JOIN admin_departments ad ON ad.user_id = u.id
         WHERE r.role_name = 'dept_admin'
           AND ad.department_id = ?
           AND u.company_id = ?
         LIMIT 1`,
        [deptId, requester.company_id]
      );
      if (rows[0]) return rows[0].id;
    }

    // Fallback: any dept_admin then business_head in same company
    const [deptRows] = await conn.query(
      `SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = 'dept_admin' AND u.company_id = ?
       LIMIT 1`,
      [requester.company_id]
    );
    if (deptRows[0]) return deptRows[0].id;

    const [bh] = await conn.query(
      `SELECT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.role_name = 'business_head' AND u.company_id = ?
       LIMIT 1`,
      [requester.company_id]
    );
    return bh[0]?.id || null;
  }
  return null;
};

// ── Single delete ─────────────────────────────────────────────────────────────
export const deleteCustomer = async (req, res) => {
  const customerId = req.params.id;
  console.log(`[DEBUG] deleteCustomer (single) called for customer: ${customerId} by user: ${req.user.username}`);
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!req.user.permissions || !req.user.permissions.includes('delete_customer')) {
      return res.status(403).json({ message: 'You do not have permission to delete customers' });
    }

    // ── Approval intercept (backend safety-net) ───────────────────────────────
    if (needsApproval(req.user)) {
      const pool = connectDB();
      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Fetch customer details
      const [rows] = await connection.query(
        'SELECT first_name, C_unique_id FROM customers WHERE id = ?',
        [customerId]
      );
      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: 'Customer not found' });
      }

      const name = `${rows[0].first_name}`.trim();

      // Check for existing pending request
      const [existing] = await connection.query(
        `SELECT id FROM delete_approval_requests 
         WHERE requester_id = ? AND customer_id = ? AND status = 'pending'`,
        [req.user.userId, customerId]
      );

      if (existing.length > 0) {
        await connection.rollback();
        return res.status(202).json({
          requires_approval: true,
          message: `A delete request for "${name}" is already pending approval.`
        });
      }

      // Find appropriate approver
      console.log(`[DEBUG] findApproverIdForUser for requester: ${req.user.username} (Role: ${req.user.role}, Team: ${req.user.team_id})`);
      const approverId = await findApproverIdForUser(connection, req.user);
      if (!approverId) {
        console.warn(`[DEBUG] No approver found for requester ${req.user.username}`);
      } else {
        console.log(`[DEBUG] Approver found: ID ${approverId}`);
      }

      // Insert the request
      const [result] = await connection.query(
        `INSERT INTO delete_approval_requests (requester_id, customer_id, customer_name, approver_id, company_id)
         VALUES (?, ?, ?, ?, ?)`,
        [req.user.userId, customerId, name, approverId || null, req.user.company_id]
      );

      // Log to history
      await insertChangeLog(connection, customerId, rows[0].C_unique_id, [
        {
          field: 'delete_request',
          oldValue: 'Active',
          newValue: 'Pending Approval'
        }
      ], req.user.username, req.user.company_id);
      console.log(`[DEBUG] Delete approval request created: ID ${result.insertId}`);

      // Notify approver
      if (approverId) {
        await connection.query(
          `INSERT INTO notifications (user_id, type, title, message, ref_id, company_id)
           VALUES (?, 'delete_request', '🗑️ Lead Delete Approval Required', ?, ?, ?)`,
          [
            approverId,
            `${req.user.username} wants to delete the record for "${name}". Please approve or reject.`,
            result.insertId,
            req.user.company_id
          ]
        );
        console.log(`[DEBUG] Notification sent to approver ${approverId}`);
      }

      await connection.commit();
      console.log(`[DEBUG] Single delete request committed successfully.`);
      return res.status(202).json({
        requires_approval: true,
        customerId,
        customerName: name,
        message: `Approval required to delete "${name}". A request has been sent to your supervisor.`
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (!customerId || isNaN(customerId)) {
      return res.status(400).json({ message: 'Valid Customer ID is required' });
    }

    const pool = connectDB();
    connection = await pool.getConnection();
    await connection.beginTransaction();

    await deleteCustomerUpdates(connection, customerId);
    await deleteCustomerRecord(connection, customerId);

    await connection.commit();
    res.status(200).json({ success: true, message: 'Customer deleted successfully!' });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error deleting customer and updates:', error);
    res.status(500).json({ message: 'Failed to delete customer and updates' });
  } finally {
    if (connection) connection.release();
  }
};


// ── Bulk delete ───────────────────────────────────────────────────────────────
export const deleteMultipleCustomers = async (req, res) => {
  const { customerIds } = req.body;
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (req.user.role === 'user') {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }

    if (!Array.isArray(customerIds) || customerIds.length === 0) {
      return res.status(400).json({ message: 'Invalid customer IDs provided' });
    }

    // ── Backend safety-net: create REAL approval requests in DB ──────────────
    // The frontend proactively handles this, but the backend enforces it too.
    if (needsApproval(req.user)) {
      const pool = connectDB();
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const approverId = await findApproverIdForUser(connection, req.user);

      let created = 0;
      for (const customerId of customerIds) {
        // Fetch customer name and C_unique_id
        const [custRows] = await connection.query(
          'SELECT first_name, C_unique_id FROM customers WHERE id = ?',
          [customerId]
        );
        if (custRows.length === 0) continue;
        const customerName = `${custRows[0].first_name}`.trim();

        // Skip if a pending request already exists for this customer by this user
        const [existing] = await connection.query(
          `SELECT id FROM delete_approval_requests
           WHERE requester_id = ? AND customer_id = ? AND status = 'pending'`,
          [req.user.userId, customerId]
        );
        if (existing.length > 0) continue;

        // Insert approval request row
        // Create the request
        const [ins] = await connection.query(
          `INSERT INTO delete_approval_requests
           (requester_id, customer_id, customer_name, approver_id, company_id)
           VALUES (?, ?, ?, ?, ?)`,
          [req.user.userId, customerId, customerName, approverId || null, req.user.company_id]
        );

        // Log to history
        await insertChangeLog(connection, customerId, custRows[0].C_unique_id, [
          {
            field: 'delete_request',
            oldValue: 'Active',
            newValue: 'Pending Approval'
          }
        ], req.user.username, req.user.company_id);

        // Notify approver if we have one
        if (approverId) {
          await connection.query(
            `INSERT INTO notifications (user_id, type, title, message, ref_id, company_id)
             VALUES (?, 'delete_request', '🗑️ Lead Delete Approval Required', ?, ?, ?)`,
            [
              approverId,
              `${req.user.username} wants to delete the record for "${customerName}". Please approve or reject.`,
              ins.insertId,
              req.user.company_id
            ]
          );
        }

        created++;
      }

      await connection.commit();
      return res.status(202).json({
        requires_approval: true,
        created,
        message: `${created} approval request(s) created. Records will be deleted once approved.`
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // No approval needed — delete directly
    const pool = connectDB();
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const customerId of customerIds) {
      await deleteCustomerUpdates(connection, customerId);
      await deleteCustomerRecord(connection, customerId);
    }

    await connection.commit();
    res.json({ success: true, message: `Successfully deleted ${customerIds.length} customers` });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error in deleteMultipleCustomers:', error);
    res.status(500).json({ message: 'Failed to delete customers' });
  } finally {
    if (connection) connection.release();
  }
};