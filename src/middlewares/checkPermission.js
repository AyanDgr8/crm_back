// src/middlewares/checkPermission.js
import connectDB from '../db/index.js';

// Helper function to get user permissions
const getUserPermissions = async (userId) => {
    const pool = await connectDB();
    let connection;
    console.log('Getting permissions for user:', userId);

    try {
        connection = await pool.getConnection();
        const [permissions] = await connection.query(
            `SELECT p.permission_name 
             FROM permissions p 
             JOIN user_permissions up ON p.id = up.permission_id 
             WHERE up.user_id = ? AND up.value = true`,
            [userId]
        );

        const permissionNames = permissions.map(p => p.permission_name);
        console.log('User permissions:', permissionNames);
        return permissionNames;
    } catch (error) {
        console.error('Error getting user permissions:', error);
        throw error;
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
};

// Middleware factory to check specific permissions
export const checkPermission = (requiredPermission) => {
    return async (req, res, next) => {
        try {
            console.log('Checking permission:', requiredPermission);
            console.log('Request user:', req.user);

            if (!req.user || !req.user.userId) {
                return res.status(401).json({ 
                    success: false,
                    message: 'Authentication required' 
                });
            }

            // Admin roles have all permissions
            if (['super_admin', 'it_admin', 'business_head'].includes(req.user.role)) {
                console.log('User is admin role, granting access');
                return next();
            }

            const userPermissions = await getUserPermissions(req.user.userId);
            
            // Special handling for view permissions
            if (requiredPermission === 'view_customer') {
                // If user has any view permission, allow access
                const hasViewPermission = userPermissions.some(perm => 
                  ['view_customer', 'view_team_customers', 'view_assigned_customers'].includes(perm)
                );
                
                if (hasViewPermission) {
                    // Attach view type to request for controller use
                    req.viewType = userPermissions.includes('view_customer') 
                      ? 'all' 
                      : userPermissions.includes('view_team_customers')
                        ? 'team'
                        : 'assigned';
                    return next();
                }
            }

            // For other permissions, check exact match
            if (!userPermissions.includes(requiredPermission)) {
                console.log('Permission denied:', {
                    user: req.user.username,
                    role: req.user.role,
                    required: requiredPermission,
                    has: userPermissions
                });

                return res.status(403).json({ 
                    success: false,
                    message: 'Access denied. Insufficient permissions.',
                    requiredPermission,
                    userPermissions,
                    userRole: req.user.role
                });
            }

            console.log('Permission granted:', {
                user: req.user.username,
                role: req.user.role,
                permission: requiredPermission
            });

            next();
        } catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Error checking permissions',
                error: error.message,
                details: error.stack
            });
        }
    };
};
