-- Drop existing users so MySQL stops whining about duplicates
DROP USER IF EXISTS 'chipsy_user'@'localhost';
DROP USER IF EXISTS 'chipsy_user'@'%';

-- Create the database; apparently migrations can't assume it exists
CREATE DATABASE IF NOT EXISTS app_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Local-only user for socket/localhost connections
CREATE USER 'chipsy_user'@'localhost' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'localhost';

-- Remote-friendly user for TCP/IP access
CREATE USER 'chipsy_user'@'%' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'%';

FLUSH PRIVILEGES;
