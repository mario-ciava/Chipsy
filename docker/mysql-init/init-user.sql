-- Rimuove utenti esistenti per evitare conflitti
DROP USER IF EXISTS 'chipsy_user'@'localhost';
DROP USER IF EXISTS 'chipsy_user'@'%';

-- Crea database
CREATE DATABASE IF NOT EXISTS app_data CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Crea utente per connessioni locali (socket Unix e localhost)
CREATE USER 'chipsy_user'@'localhost' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'localhost';

-- Crea utente con accesso da qualsiasi host (TCP/IP)
CREATE USER 'chipsy_user'@'%' IDENTIFIED BY 'chipsypass';
GRANT ALL PRIVILEGES ON app_data.* TO 'chipsy_user'@'%';

FLUSH PRIVILEGES;
