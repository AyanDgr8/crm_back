-- schema.sql

create database knowledgeBase; 

use knowledgeBase;

-- 1. Create permissions
CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    permission_name VARCHAR(50) NOT NULL UNIQUE
);

-- 2. Create roles
CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_name ENUM('super_admin', 'it_admin', 'business_head', 'team_leader', 'user', 'mis') NOT NULL
);

-- 3. Create teams (temporarily without the foreign key to users)
CREATE TABLE IF NOT EXISTS teams (
    id INT PRIMARY KEY AUTO_INCREMENT,
    team_name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NOT NULL
    -- FOREIGN KEY (created_by) REFERENCES users(id)  -- Add this later
);

-- 4. Create users
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    team_id INT,
    role_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

ALTER TABLE users ADD UNIQUE (username);

-- Alter teams table to add foreign key now that users table exists
ALTER TABLE teams
ADD CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES users(id);

-- 5. Create user_permissions
CREATE TABLE IF NOT EXISTS user_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    permission_id INT NOT NULL,
    value BOOLEAN DEFAULT false,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id),
    UNIQUE KEY unique_user_permission (user_id, permission_id)
);

-- Insert default roles
INSERT INTO roles (role_name) VALUES 
('super_admin'),
('it_admin'),
('business_head'),
('team_leader'),
('user'),
('mis');

-- Insert default permissions
INSERT INTO permissions (permission_name) VALUES 
('upload_document'),
('download_data'),
('create_customer'),
('edit_customer'),
('delete_customer'),
('view_customer'),
('view_team_customers'),
('view_assigned_customers');

-- 6. 
CREATE TABLE login_history (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `device_id` varchar(255) NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `login_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `logout_time` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `login_history_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ;
ALTER TABLE login_history ADD COLUMN last_activity timestamp NULL DEFAULT CURRENT_TIMESTAMP;

-- 7. 
CREATE TABLE customers (
  `id` int NOT NULL AUTO_INCREMENT,
  `first_name` varchar(100) DEFAULT NULL,
  `last_name` varchar(100)  DEFAULT NULL,
  `company_name` varchar(200)  DEFAULT NULL,
  `phone_no` varchar(50) DEFAULT NULL,
  `email_id` varchar(50)  DEFAULT NULL,
  `address` varchar(300)  DEFAULT NULL,
  `lead_source` enum('website','data','referral','ads')  DEFAULT NULL,

  `call_date_time` datetime DEFAULT NULL,
  `call_status` enum('connected','not connected','follow_up')  DEFAULT NULL,
  `call_outcome` enum('interested','not interested','call_later','wrong_number')  DEFAULT NULL,
  `call_recording` varchar(300) DEFAULT NULL,

  `product` varchar(200) DEFAULT NULL,
  `budget` varchar(100) DEFAULT NULL,
  `decision_making` enum('yes','no')  DEFAULT NULL,
  `decision_time`enum('immediate','1_week','1_month','future_investment')  DEFAULT NULL,
  `lead_stage`enum('new','in_progress','qualified','converted','lost')  DEFAULT NULL,


  `next_follow_up` datetime DEFAULT NULL,
  `assigned_agent` varchar(100)  DEFAULT NULL,
  `reminder_notes` text DEFAULT NULL,
  `priority_level` enum('low','medium','high') DEFAULT NULL,


  `customer_category` enum('hot','warm','cold') DEFAULT NULL,
  `tags_labels` enum('premium_customer','repeat_customer','demo_required') DEFAULT NULL,
  `communcation_channel` enum('call','whatsapp','email', 'sms') DEFAULT NULL,
  `deal_value` varchar(30) DEFAULT NULL,
  `conversion_status` enum('lead','opportunity','customer')  DEFAULT NULL,
  `customer_history` enum('previous calls','purchases','interactions78')  DEFAULT NULL,
  `comment` text DEFAULT NULL,

  `C_unique_id` varchar(10) DEFAULT NULL,
  `scheduled_at` datetime DEFAULT NULL,
  `date_created` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_updated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `agent_name` varchar(100)  DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `C_unique_id` (`C_unique_id`),
  KEY `fk_agent_name_username` (`agent_name`)
) ;


-- 8. Create updates_customer
CREATE TABLE `updates_customer` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `C_unique_id` varchar(10) NOT NULL,
  `field` varchar(255) NOT NULL,
  `old_value` text,
  `new_value` text,
  `changed_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `phone_no_primary` varchar(15) DEFAULT NULL,
  `changed_by` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `customer_id` (`customer_id`),
  CONSTRAINT `updates_customer_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) ;


-- 9. Create scheduler
CREATE TABLE scheduler (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `created_by` int NOT NULL,
  `assigned_to` varchar(100) NOT NULL,
  `description` text,
  `status` enum('pending','completed','cancelled') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `customer_id` (`customer_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `scheduler_customer_fk` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scheduler_user_fk` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
);



DELIMITER //

DROP TRIGGER IF EXISTS after_customers_scheduled_at_update//

CREATE TRIGGER after_customers_scheduled_at_update 
AFTER UPDATE ON customers 
FOR EACH ROW 
BEGIN
    DECLARE agent_id INT;
    DECLARE existing_id INT;
    
    -- Only create scheduler entry if scheduled_at is changed to a non-null value
    IF NEW.scheduled_at IS NOT NULL AND 
       (OLD.scheduled_at IS NULL OR NEW.scheduled_at <> OLD.scheduled_at) THEN 
        
        -- Try to find the user ID for the agent_name
        -- This ensures we have a valid user ID for the created_by field
        SELECT id INTO agent_id FROM users WHERE username = NEW.agent_name LIMIT 1;
        
        -- If we can't find the agent, use the first admin user as a fallback
        IF agent_id IS NULL THEN
            SELECT id INTO agent_id FROM users WHERE role_id = 1 LIMIT 1; -- Assuming role_id 1 is admin
        END IF;
        
        -- Check if there's an existing pending scheduler entry for this customer
        SELECT id INTO existing_id FROM scheduler 
        WHERE customer_id = NEW.id AND status = 'pending' LIMIT 1;
        
        IF existing_id IS NOT NULL THEN
            -- Update existing scheduler entry
            UPDATE scheduler SET
                scheduled_at = NEW.scheduled_at,
                updated_at = NOW()
            WHERE id = existing_id;
        ELSE
            -- Create new scheduler entry
            INSERT INTO scheduler (
                customer_id,
                scheduled_at,
                created_by,
                assigned_to,
                description,
                status
            ) VALUES (
                NEW.id,
                NEW.scheduled_at,
                agent_id,           -- Use the agent's ID or admin ID as fallback
                NEW.agent_name,     -- The agent to whom it is assigned
                CONCAT('Scheduled call with ', NEW.first_name, ' ', IFNULL(NEW.last_name, '')),
                'pending'
            );
        END IF;
    END IF;
END//

DELIMITER ;