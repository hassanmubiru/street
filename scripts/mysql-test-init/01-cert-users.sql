-- Init script for the local MySQL test container (docker-compose.test-db.yml).
-- Creates the two users the MySQL E2E certification suite expects, one per
-- authentication plugin, plus grants on the street_test database.

-- mysql_native_password user (legacy SHA1 challenge-response)
CREATE USER IF NOT EXISTS 'streetnat'@'%' IDENTIFIED WITH mysql_native_password BY 'natpass';
GRANT ALL PRIVILEGES ON street_test.* TO 'streetnat'@'%';

-- caching_sha2_password user (MySQL 8 default)
CREATE USER IF NOT EXISTS 'streetsha2'@'%' IDENTIFIED WITH caching_sha2_password BY 'sha2pass';
GRANT ALL PRIVILEGES ON street_test.* TO 'streetsha2'@'%';

FLUSH PRIVILEGES;
