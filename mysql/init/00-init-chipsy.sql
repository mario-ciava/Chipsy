-- Ensure the Chipsy schema and users exist for local development
DROP USER IF EXISTS 'chipsy_user'@'localhost';
DROP USER IF EXISTS 'chipsy_user'@'%';

CREATE DATABASE IF NOT EXISTS app_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'chipsy_user'@'localhost' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'localhost';

CREATE USER 'chipsy_user'@'%' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'%';

FLUSH PRIVILEGES;
