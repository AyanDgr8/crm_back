-- Add phone_no and address to users table
USE knowledgeBase_multitenant;

ALTER TABLE users
ADD COLUMN phone_no VARCHAR(20) NULL AFTER email,
ADD COLUMN address TEXT NULL AFTER phone_no;
