import { v4 as uuid } from 'uuid';

/**
 * Prepares a distributor function based on the provided options.
 * @param {Object} connection - Database connection
 * @param {Object} options - Distribution options { method: 'team' | 'random', teamId, departmentId, subDepartmentId, ... }
 * @returns {Function} - Async function (record) => { assigned_to, team_id }
 */
export const getDistributor = async (connection, options) => {
    const { method, teamId, departmentId, subDepartmentId, companyId } = options;

    // 1. Specific Team Distribution
    if (method === 'team') {
        if (!teamId) throw new Error('Team ID is required for team distribution');

        // Fetch Team Leaders
        const [leaders] = await connection.query(
            `SELECT u.id, u.username 
             FROM users u
             JOIN roles r ON u.role_id = r.id
             WHERE u.team_id = ? AND r.role_name = 'team_leader' AND u.is_active = true AND u.company_id = ?`,
            [teamId, companyId]
        );

        if (leaders.length === 0) {
            // No leaders: Assign to Team Pool (unassigned user, but set team_id)
            return () => ({ assigned_to: null, team_id: teamId });
        }

        // Round Robin among leaders
        let currentIndex = 0;
        return () => {
            const leader = leaders[currentIndex];
            currentIndex = (currentIndex + 1) % leaders.length;
            return { assigned_to: leader.id, team_id: teamId, update_timestamp: true };
        };
    }

    // 2. Random/Scope Distribution
    if (method === 'random') {
        // Determine scope query - Include both agents and team leaders in the pool
        let query = `
            SELECT u.id, u.username, u.team_id, u.lead_weight, u.last_assigned_at 
            FROM users u
            JOIN roles r ON u.role_id = r.id
            LEFT JOIN teams t ON u.team_id = t.id
            WHERE r.role_name IN ('user', 'team_leader') AND u.is_active = true AND u.company_id = ?
        `;
        const params = [companyId];

        if (subDepartmentId) {
            query += ` AND (u.sub_department_id = ? OR t.sub_department_id = ?)`;
            params.push(subDepartmentId, subDepartmentId);
        } else if (departmentId) {
            query += ` AND (u.department_id = ? OR t.department_id = ?)`;
            params.push(departmentId, departmentId);
        }

        const [agents] = await connection.query(query, params);

        if (agents.length === 0) {
            // No eligible agents found? Return null assignment
            return () => ({ assigned_to: null, team_id: null });
        }

        // Fetch Distribution Rule
        let ruleMethod = 'equal'; // Default
        const [rules] = await connection.query(
            `SELECT distribution_method FROM lead_distribution_rules 
             WHERE department_id = ? AND scope_type = ? AND scope_id = ?`,
            [departmentId, subDepartmentId ? 'sub_department' : 'department', subDepartmentId || departmentId]
        );
        if (rules.length > 0) ruleMethod = rules[0].distribution_method;

        // --- Round Robin / Equal Logic ---
        if (ruleMethod === 'round_robin' || ruleMethod === 'equal') {
            // Sort by last_assigned_at ASC (oldest first)
            agents.sort((a, b) => {
                const dateA = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
                const dateB = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;

                if (dateA !== dateB) {
                    return dateA - dateB;
                }
                // Secondary sort by ID for deterministic behavior
                return a.id - b.id;
            });

            let currentIndex = 0;
            return async (saveToDb = false) => {
                const agent = agents[currentIndex];
                currentIndex = (currentIndex + 1) % agents.length;

                // We update last_assigned_at in memory for the next iteration to be correct?
                // Actually, standard Round Robin just cycles through the list.
                // But "Persistent" Round Robin needs to know where we left off.
                // Since we sorted by last_assigned_at, we are starting from the "next" person.

                // Ideally, we should update the DB `last_assigned_at` for this agent so next batch knows.
                // We will return a function that can optionally execute the update or we handle it in bulk later.
                // For simplicity here, we assume caller handles bulk update or we just return the ID.
                return { assigned_to: agent.id, team_id: agent.team_id, update_timestamp: true };
            };
        }

        // --- Weighted Logic ---
        if (ruleMethod === 'weighted') {
            // Create a weighted pool
            const pool = [];
            for (const agent of agents) {
                const weight = agent.lead_weight || 1;
                for (let i = 0; i < weight; i++) {
                    pool.push(agent);
                }
            }

            return () => {
                if (pool.length === 0) return { assigned_to: null, team_id: null };
                const randomIndex = Math.floor(Math.random() * pool.length);
                const agent = pool[randomIndex];
                return { assigned_to: agent.id, team_id: agent.team_id };
            };
        }
    }

    // Default fallback
    return () => ({ assigned_to: null, team_id: null });
};
