import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });

async function checkCustomFieldsTable() {
    let connection;
    
    try {
        // Create connection
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'knowledgeBase_multitenant'
        });

        console.log('✅ Connected to database');

        // Check if custom_fields_metadata table exists
        const [tables] = await connection.query(`
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'custom_fields_metadata'
        `);

        if (tables.length === 0) {
            console.log('\n❌ custom_fields_metadata table does NOT exist');
            console.log('\n📋 You need to run the migration SQL:');
            console.log('   mysql -u root -p knowledgeBase_multitenant < backend/src/db/custom_fields_migration.sql');
            return;
        }

        console.log('✅ custom_fields_metadata table exists');

        // Check how many records exist
        const [countResult] = await connection.query(`
            SELECT COUNT(*) as total FROM custom_fields_metadata
        `);
        console.log(`\n📊 Total records in custom_fields_metadata: ${countResult[0].total}`);

        // Check system fields per company
        const [systemFields] = await connection.query(`
            SELECT 
                c.id as company_id,
                c.company_name,
                COUNT(cfm.id) as system_fields_count
            FROM companies c
            LEFT JOIN custom_fields_metadata cfm 
                ON c.id = cfm.company_id 
                AND cfm.is_system_field = true
            GROUP BY c.id, c.company_name
        `);

        console.log('\n📋 System Fields per Company:');
        systemFields.forEach(row => {
            const status = row.system_fields_count === 3 ? '✅' : '❌';
            console.log(`   ${status} Company: ${row.company_name} (ID: ${row.company_id}) - ${row.system_fields_count} system fields`);
        });

        // Show all fields for first company
        const [allFields] = await connection.query(`
            SELECT 
                cfm.company_id,
                c.company_name,
                cfm.field_name,
                cfm.field_label,
                cfm.is_system_field,
                cfm.is_active
            FROM custom_fields_metadata cfm
            JOIN companies c ON c.id = cfm.company_id
            ORDER BY cfm.company_id, cfm.display_order
            LIMIT 20
        `);

        if (allFields.length > 0) {
            console.log('\n📋 Sample Fields (first 20):');
            allFields.forEach(field => {
                const type = field.is_system_field ? '[SYSTEM]' : '[CUSTOM]';
                const status = field.is_active ? '✅' : '❌';
                console.log(`   ${status} ${type} ${field.company_name}: ${field.field_label} (${field.field_name})`);
            });
        }

        console.log('\n✅ Check complete!');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('\nFull error:', error);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

checkCustomFieldsTable();
