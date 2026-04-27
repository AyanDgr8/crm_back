# Custom Fields Migration - Step by Step Guide

## Issue Fixed
The foreign key constraint error has been resolved. The `created_by` field is now nullable for system-generated fields.

---

## Step 1: Run the Migration SQL

Open your terminal and run:

```bash
cd /Users/mac/Desktop/MULTYCOMM_CRM

mysql -u root -p knowledgeBase_multitenant < backend/src/db/custom_fields_migration.sql
```

Enter your MySQL password when prompted.

---

## Step 2: Verify the Migration

Run the check script:

```bash
cd backend
node src/db/check_custom_fields_table.js
```

**Expected Output:**
```
✅ Connected to database
✅ custom_fields_metadata table exists

📊 Total records in custom_fields_metadata: 9 (or 3 per company)

📋 System Fields per Company:
   ✅ Company: YourCompany (ID: 1) - 3 system fields
   ✅ Company: AnotherCompany (ID: 2) - 3 system fields
```

---

## Step 3: Restart Backend Server

```bash
cd backend
npm restart
```

Or if using PM2:
```bash
pm2 restart backend
```

---

## Step 4: Test in Browser

1. Login as a Business Head user
2. Navigate to: `https://crm.voicemeetme.net/form-creation`
3. You should see **ONLY 3 fields**:
   - ✅ First Name * (System Field)
   - ✅ Phone * (System Field)
   - ✅ Assigned Agent * (System Field)

4. All other custom fields should be gone (they were global before)

---

## Step 5: Create a Test Custom Field

1. Click "Add Custom Field" button
2. Create a field like:
   - Field Name: "Department"
   - Field Type: VARCHAR
   - Click Save

3. This field should now appear **only for your company**

4. Login as a different company's Business Head
5. They should **NOT** see the "Department" field

---

## Troubleshooting

### If you see error: "Table 'custom_fields_metadata' already exists"

Drop the table first:
```sql
USE knowledgeBase_multitenant;
DROP TABLE IF EXISTS custom_fields_metadata;
```

Then run the migration again.

### If you see error: "Trigger already exists"

Drop the trigger first:
```sql
USE knowledgeBase_multitenant;
DROP TRIGGER IF EXISTS after_company_insert_add_system_fields;
```

Then run the migration again.

### If check script shows 0 system fields

Run these INSERT statements manually:
```sql
USE knowledgeBase_multitenant;

INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id, 'first_name', 'First Name', 'VARCHAR', true, true, 1, NULL
FROM companies c;

INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id, 'phone_no', 'Phone', 'VARCHAR', true, true, 2, NULL
FROM companies c;

INSERT INTO custom_fields_metadata 
    (company_id, field_name, field_label, field_type, is_required, is_system_field, display_order, created_by)
SELECT 
    c.id, 'agent_name', 'Assigned Agent', 'VARCHAR', true, true, 3, NULL
FROM companies c;
```

---

## What Changed

**Before:**
- ❌ All companies saw all custom fields
- ❌ Fields were global in customers table
- ❌ No company-specific field tracking

**After:**
- ✅ Each company has its own custom fields
- ✅ Only 3 system fields are shared (first_name, phone_no, agent_name)
- ✅ Fields tracked per company in custom_fields_metadata table
- ✅ Soft delete (hiding) instead of dropping columns

---

## Need Help?

Run the check script to see detailed status:
```bash
node backend/src/db/check_custom_fields_table.js
```
