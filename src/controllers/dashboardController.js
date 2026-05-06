// src/controllers/dashboardController.js
// Business Head / Super Admin Dashboard Stats

import connectDB from '../db/index.js';
import { logger } from '../logger.js';

export const getDashboardStats = async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Authentication required' });

    const allowedRoles = ['super_admin', 'business_head'];
    if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ message: 'Access denied. Business Head or Super Admin only.' });
    }

    const pool = connectDB();
    let connection;
    try {
        connection = await pool.getConnection();

        // ── Check available columns in customers and updates_customer ───────
        const [customerCols] = await connection.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'customers' AND TABLE_SCHEMA = DATABASE()"
        );
        const [updateCols] = await connection.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'updates_customer' AND TABLE_SCHEMA = DATABASE()"
        );
        
        const hasCol = (list, col) => list.some(c => c.COLUMN_NAME.toLowerCase() === col.toLowerCase());
        const customersHasLeadType = hasCol(customerCols, 'lead_type');
        const customersHasRequirement = hasCol(customerCols, 'requirement');
        const updatesHasPhonePrimary = hasCol(updateCols, 'phone_no_primary');

        // Company scope — super_admin can optionally pass ?company_id=
        const companyId = user.role === 'super_admin'
            ? (req.query.company_id || null)
            : user.company_id;

        const companyFilter = companyId ? 'AND c.company_id = ?' : '';
        const companyParam = companyId ? [companyId] : [];

        // ── 1. KPI Totals ────────────────────────────────────────────────────
        const [[totals]] = await connection.query(
            `SELECT
                COUNT(*)                                                        AS total_leads,
                SUM(DATE(c.date_created) = CURDATE())                           AS new_today,
                SUM(DATE(c.last_updated) = CURDATE()
                    AND DATE(c.date_created) != CURDATE())                      AS updated_today,
                SUM(DATE(c.date_created) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)) AS this_week,
                SUM(DATE(c.date_created) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) AS this_month
            FROM customers c
            WHERE 1=1 ${companyFilter}`,
            companyParam
        );

        // ── 2. Lead Type Breakdown (Hot / Medium / Cold) ─────────────────────
        let leadTypes = [];
        if (customersHasLeadType) {
            [leadTypes] = await connection.query(
                `SELECT
                    COALESCE(lead_type, 'Untagged') AS lead_type,
                    COUNT(*) AS count
                FROM customers c
                WHERE 1=1 ${companyFilter}
                GROUP BY lead_type
                ORDER BY count DESC`,
                companyParam
            );
        }

        // ── 3. Leads Over Last 30 Days ────────────────────────────────────────
        const [leadsPerDay] = await connection.query(
            `SELECT
                DATE(c.date_created) AS date,
                COUNT(*)             AS count
            FROM customers c
            WHERE c.date_created >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ${companyFilter}
            GROUP BY DATE(c.date_created)
            ORDER BY date ASC`,
            companyParam
        );

        // ── 4. Leads by Department ────────────────────────────────────────────
        const [byDepartment] = await connection.query(
            `SELECT
                COALESCE(d.department_name, 'Unassigned') AS department,
                COUNT(c.id) AS count
            FROM customers c
            LEFT JOIN departments d ON c.department_id = d.id
            WHERE 1=1 ${companyFilter}
            GROUP BY c.department_id, d.department_name
            ORDER BY count DESC
            LIMIT 10`,
            companyParam
        );

        // ── 5. Leads by Sub-Department ────────────────────────────────────────
        const [bySubDepartment] = await connection.query(
            `SELECT
                COALESCE(sd.sub_department_name, 'Unassigned') AS sub_department,
                COUNT(c.id) AS count
            FROM customers c
            LEFT JOIN sub_departments sd ON c.sub_department_id = sd.id
            WHERE 1=1 ${companyFilter}
            GROUP BY c.sub_department_id, sd.sub_department_name
            ORDER BY count DESC
            LIMIT 10`,
            companyParam
        );

        // ── 6. Agent Performance ──────────────────────────────────────────────
        const [agentStats] = await connection.query(
            `SELECT
                c.agent_name,
                COUNT(c.id)                          AS total_leads,
                SUM(DATE(c.date_created) = CURDATE()) AS new_today,
                MAX(c.last_updated)                   AS last_activity
            FROM customers c
            WHERE c.agent_name IS NOT NULL AND c.agent_name != ''
            ${companyFilter}
            GROUP BY c.agent_name
            ORDER BY total_leads DESC
            LIMIT 20`,
            companyParam
        );

        // ── 7. Scheduled Follow-ups Today ─────────────────────────────────────
        const [scheduledToday] = await connection.query(
            `SELECT
                s.id,
                s.scheduled_at,
                s.assigned_to,
                s.description,
                s.status,
                c.first_name,
                c.phone_no,
                c.C_unique_id
            FROM scheduler s
            JOIN customers c ON s.customer_id = c.id
            WHERE DATE(s.scheduled_at) = CURDATE()
              AND s.status = 'pending'
              ${companyId ? 'AND s.company_id = ?' : ''}
            ORDER BY s.scheduled_at ASC
            LIMIT 15`,
            companyId ? [companyId] : []
        );

        // ── 8. Recent Activity Feed (last 15 changes) ─────────────────────────
        const [recentActivity] = await connection.query(
            `SELECT
                uc.id,
                uc.field,
                uc.old_value,
                uc.new_value,
                uc.changed_by,
                uc.changed_at,
                uc.C_unique_id,
                ${updatesHasPhonePrimary ? 'uc.phone_no_primary' : "'' AS phone_no_primary"}
            FROM updates_customer uc
            WHERE 1=1 ${companyId ? 'AND uc.company_id = ?' : ''}
            ORDER BY uc.changed_at DESC
            LIMIT 15`,
            companyId ? [companyId] : []
        );

        // ── 9. Leads by Requirement/Product ──────────────────────────────────
        let byRequirement = [];
        if (customersHasRequirement) {
            [byRequirement] = await connection.query(
                `SELECT
                    COALESCE(c.requirement, 'Not Specified') AS requirement,
                    COUNT(*) AS count
                FROM customers c
                WHERE c.requirement IS NOT NULL ${companyFilter}
                GROUP BY c.requirement
                ORDER BY count DESC
                LIMIT 10`,
                companyParam
            );
        }

        // ── 10. Upcoming Scheduled (next 7 days, not just today) ─────────────
        const [upcomingScheduled] = await connection.query(
            `SELECT COUNT(*) AS upcoming_7days
            FROM scheduler s
            WHERE s.scheduled_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
              AND s.status = 'pending'
              ${companyId ? 'AND s.company_id = ?' : ''}`,
            companyId ? [companyId] : []
        );

        res.json({
            success: true,
            data: {
                totals: {
                    total_leads: totals.total_leads || 0,
                    new_today: totals.new_today || 0,
                    updated_today: totals.updated_today || 0,
                    this_week: totals.this_week || 0,
                    this_month: totals.this_month || 0,
                    scheduled_today: scheduledToday.length,
                    upcoming_7days: upcomingScheduled[0]?.upcoming_7days || 0,
                },
                lead_types: leadTypes,
                leads_per_day: leadsPerDay,
                by_department: byDepartment,
                by_sub_department: bySubDepartment,
                agent_stats: agentStats,
                scheduled_today: scheduledToday,
                recent_activity: recentActivity,
                by_requirement: byRequirement,
            }
        });

    } catch (error) {
        logger.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats', error: error.message });
    } finally {
        if (connection) connection.release();
    }
};
