// src/routes/router.js

import express from 'express';
import teamRoutes from './teamRoutes.js';

import {
    searchCustomers,
    getAllCustomers,
    assignCustomerToTeam,
    checkDuplicates,
    getTeamRecords,
    getCustomersByDateRange
} from '../controllers/customers.js';

import { deleteCustomer, deleteMultipleCustomers } from '../controllers/deleteCustomers.js';

import { makeNewRecord, createCustomer } from '../controllers/createCustomers.js';

import { updateCustomer, historyCustomer, gethistoryCustomer } from '../controllers/updateCustomers.js';

import {
    registerCustomer, loginCustomer, logoutCustomer, fetchCurrentUser,
    forgotPassword, resetPassword, checkSession, sendOTP, resetPasswordWithToken
} from '../controllers/sign.js';
import { getAllTeams } from '../controllers/teams.js';

import { getReminders, getAllReminders, getScheduleRecords } from '../controllers/schedule.js';

import { uploadCustomerData, confirmUpload } from '../controllers/uploadFile.js';
import { downloadCustomerData } from '../controllers/downloadFile.js';
import { authenticateToken } from '../middlewares/auth.js';
import { checkPermission } from '../middlewares/checkPermission.js';

import { checkCustomerByPhone } from '../controllers/newnum.js';

import restrictUsers from '../middlewares/restrictUsers.js';

import { validateSession } from '../middlewares/sessionMiddleware.js';

import { createUser, getAllUsers, getTeamMembers, updateUser, deleteUser } from '../controllers/users.js';

import {
    requestDeleteCustomer,
    resolveCustomerDeleteRequest,
    getPendingCustomerApprovals,
    getNotifications,
    markAllNotificationsRead
} from '../controllers/deleteNotificationsController.js';

// Multi-tenant imports
import {
    createCompany,
    getAllCompanies,
    getCompanyById,
    updateCompany,
    deactivateCompany,
    getCompanyHierarchy
} from '../controllers/companies.js';

import { addCustomField, getCustomFields, deleteCustomField } from '../controllers/dynamicFields.js';
import {
    createDepartment, getDepartments, updateDepartment, deleteDepartment,
    createSubDepartment, getSubDepartments, updateSubDepartment, deleteSubDepartment,
    assignAdminToDepartment, removeAdminFromDepartment, getAdminDepartmentAssignments
} from '../controllers/departments.js';

const router = express.Router();

// Mount team routes
router.use('/', teamRoutes);

// ============================================================================
// SUPER ADMIN ROUTES - Company Management
// ============================================================================
router.post('/super-admin/companies', authenticateToken, createCompany);
router.get('/super-admin/companies', authenticateToken, getAllCompanies);
router.get('/super-admin/companies/:id', authenticateToken, getCompanyById);
router.put('/super-admin/companies/:id', authenticateToken, updateCompany);
router.patch('/super-admin/companies/:id/deactivate', authenticateToken, deactivateCompany);
router.get('/super-admin/hierarchy', authenticateToken, getCompanyHierarchy);

// Route for user registration
router.post('/register', restrictUsers, async (req, res) => {
    try {
        await registerCustomer(req, res);
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Registration failed' });
    }
});
// Route for user login
router.post('/login', loginCustomer);

// Route for sending OTP (reset password link)
router.post('/send-otp', sendOTP);

// Route for resetting password with token
router.post('/reset-password/:id/:token', resetPasswordWithToken);

// Route for forgot password
router.post('/forgot-password', forgotPassword);

// Route for resetting password with token
router.post('/reset-password/:token', resetPassword);


// Route for user logout
router.post('/logout', authenticateToken, logoutCustomer);

// Route to check session
router.get('/check-session', validateSession, checkSession);

// Route to get latest customers based on role
router.get('/customers', authenticateToken, checkPermission('view_customer'), getAllCustomers);

// Route to search customers
router.get('/customers/search', authenticateToken, checkPermission('view_customer'), searchCustomers);

// Add these after your existing /customers route
router.get('/customers/team', authenticateToken, checkPermission('view_team_customers'), getAllCustomers);
router.get('/customers/assigned', authenticateToken, checkPermission('view_assigned_customers'), getAllCustomers);

// Add these after your customer/new route
router.patch('/customers/phone/:phone_no/updates', authenticateToken, checkPermission('edit_customer'), updateCustomer);
router.put('/customers/:id', authenticateToken, checkPermission('edit_customer'), updateCustomer);

router.delete('/customers/:id', authenticateToken, checkPermission('delete_customer'), deleteCustomer);
router.post('/customers/delete-multiple', authenticateToken, checkPermission('delete_customer'), deleteMultipleCustomers);

// Route to check if customer exists by phone number
router.get('/customers/phone/:phone_no', authenticateToken, checkPermission('view_customer'), checkCustomerByPhone);

// Route to create a new customer record
router.post('/customer/new', authenticateToken, checkPermission('create_customer'), makeNewRecord);

// Route to create a new customer record with a new number 
router.post('/customer/new/:phone_no', authenticateToken, checkPermission('create_customer'), makeNewRecord);

// Route to create a new customer
router.post('/customers/new', authenticateToken, checkPermission('create_customer'), createCustomer);

// Change history routes
router.get('/customers/log-change/:id', authenticateToken, checkPermission('view_customer'), gethistoryCustomer);
router.post('/customers/log-change', authenticateToken, checkPermission('edit_customer'), historyCustomer);

// File upload routes
router.post('/upload', authenticateToken, checkPermission('upload_document'), uploadCustomerData);
router.post('/upload/confirm', authenticateToken, checkPermission('upload_document'), confirmUpload);

// Route to fetch current user
router.get('/current-user', authenticateToken, fetchCurrentUser);

// Reminder routes
router.get('/customers/reminders', authenticateToken, getReminders);
router.get('/customers/getAllReminders', authenticateToken, getAllReminders);

// Route to assign customers to team/agent
router.post('/customers/assign-team', authenticateToken, assignCustomerToTeam);

// Route to download customer data with date filter
router.get('/customers/download', authenticateToken, checkPermission('download_data'), downloadCustomerData);

// Route to get customers by date range
router.get('/customers/date-range', authenticateToken, checkPermission('download_data'), getCustomersByDateRange);

// Route to check duplicates
router.post('/customers/check-duplicates', authenticateToken, checkDuplicates);

// Route to get team records with field mapping
router.post('/records_info', getTeamRecords);

// Route to get schedule records with field mapping
router.post('/records_schedule', getScheduleRecords);

// User management routes
router.post('/users/create', authenticateToken, createUser);
router.get('/users/all', authenticateToken, getAllUsers);
router.get('/teams', authenticateToken, getAllTeams); // Consolidated: uses same logic as /players/teams
router.get('/users/team/:teamId', authenticateToken, getTeamMembers);
router.put('/users/:userId', authenticateToken, updateUser);
router.delete('/users/:userId', authenticateToken, deleteUser);

// Lead/Customer Delete Approval Workflow routes
router.post('/customers/:customerId/request-delete', authenticateToken, requestDeleteCustomer);
router.patch('/customer-delete-requests/:requestId/resolve', authenticateToken, resolveCustomerDeleteRequest);
router.get('/customer-delete-requests/pending', authenticateToken, getPendingCustomerApprovals);
router.get('/notifications', authenticateToken, getNotifications);
router.patch('/notifications/read-all', authenticateToken, markAllNotificationsRead);

// Dynamic fields routes (IT Admin only)
router.post('/custom-fields', authenticateToken, addCustomField);
router.get('/custom-fields', authenticateToken, getCustomFields);
router.delete('/custom-fields/:fieldName', authenticateToken, deleteCustomField);

// ============================================================================
// DEPARTMENT ROUTES (IT Admin / Dept Admin)
// ============================================================================
router.post('/departments', authenticateToken, createDepartment);
router.get('/departments', authenticateToken, getDepartments);
router.put('/departments/:id', authenticateToken, updateDepartment);
router.delete('/departments/:id', authenticateToken, deleteDepartment);

// Sub-department routes
router.post('/sub-departments', authenticateToken, createSubDepartment);
router.get('/departments/:department_id/sub-departments', authenticateToken, getSubDepartments);
router.put('/sub-departments/:id', authenticateToken, updateSubDepartment);
router.delete('/sub-departments/:id', authenticateToken, deleteSubDepartment);

// Admin-department assignment routes
router.post('/admin-departments', authenticateToken, assignAdminToDepartment);
router.delete('/admin-departments/:id', authenticateToken, removeAdminFromDepartment);
router.get('/admin-departments', authenticateToken, getAdminDepartmentAssignments);

// Distribution Rules Routes
import { getDistributionRules, saveDistributionRules } from '../controllers/distributionController.js';
router.get('/distribution-rules/:departmentId', authenticateToken, getDistributionRules);
router.post('/distribution-rules', authenticateToken, saveDistributionRules);

export default router;
