# SQL Files — Run Order Guide

This folder contains the canonical database scripts for the **Multycomm CRM**.  
Run them in the order listed below on a **fresh** MySQL instance.

---

## Fresh Install (New Database)

| # | File | Purpose |
|---|------|---------|
| 1 | `schema_multitenant.sql` | **Master schema** — creates all tables, roles, permissions, triggers, and views. Run this first. |
| 2 | `lead_distribution_migration.sql` | Adds the `lead_distribution_rules` table and `lead_weight` / `last_assigned_at` columns to `users`. |
| 3 | `role_separation_migration.sql` | Adds `dept_admin` and `sub_dept_admin` roles. |
| 4 | `v17b_lead_delete_migration.sql` | Creates `delete_approval_requests` and `notifications` tables. Adds `requires_delete_approval` to `users`. |
| 5 | `add_user_fields.sql` | Adds `phone_no` and `address` columns to `users`. |
| 6 | `../CREATE_SUPER_ADMIN_FINAL.sql` | Creates the Super Admin user with all permissions. |

---

## Legacy Data Migration (Existing DB Only)

If you have data in the old `knowledgeBase` (single-tenant) database, run this **between step 1 and step 2** above:

| File | Purpose |
|------|---------|
| `migration_to_multitenant.sql` | Migrates all data from `knowledgeBase` → `knowledgeBase_multitenant`. |

> **Note**: `schema.sql` is the original single-tenant schema — kept for historical reference only. Do **not** run it on the new database.

---

## Super Admin Credentials (after step 6)

| Field | Value |
|-------|-------|
| URL | `http://localhost:4455/login` |
| Email | `superadmin@crm.com` |
| Password | `12345678` |
