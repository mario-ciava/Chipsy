/**
 * Database Migration: Add Compound Indexes to Logs Table
 * Run this script to optimize existing database
 */

const initializeMySql = require("../bot/mysql")
const { client } = require("../bot")
const logger = require("../bot/utils/logger")

const migrate = async() => {
    logger.info("Starting logs table index migration", { scope: "migration" })

    try {
        const { pool } = await initializeMySql(client, client.config)
        const connection = await pool.getConnection()

        try {
            // Check if logs table exists
            const [tables] = await connection.query("SHOW TABLES LIKE 'logs'")

            if (!tables || tables.length === 0) {
                logger.warn("Logs table does not exist. Run the application first to create it.", { scope: "migration" })
                return
            }

            logger.info("Logs table found. Checking indexes...", { scope: "migration" })

            // Get existing indexes
            const [indexes] = await connection.query("SHOW INDEX FROM logs")
            const indexNames = new Set(indexes.map((idx) => idx.Key_name))

            logger.info(`Found ${indexes.length} existing indexes`, {
                scope: "migration",
                indexes: Array.from(indexNames)
            })

            // Add compound indexes if they don't exist
            const indexesToCreate = [
                {
                    name: "idx_type_date",
                    sql: "CREATE INDEX idx_type_date ON logs(log_type, created_at DESC)"
                },
                {
                    name: "idx_level_date",
                    sql: "CREATE INDEX idx_level_date ON logs(level, created_at DESC)"
                },
                {
                    name: "idx_user_date",
                    sql: "CREATE INDEX idx_user_date ON logs(user_id, created_at DESC)"
                }
            ]

            let created = 0
            let skipped = 0

            for (const index of indexesToCreate) {
                if (indexNames.has(index.name)) {
                    logger.info(`Index ${index.name} already exists, skipping`, { scope: "migration" })
                    skipped++
                    continue
                }

                try {
                    await connection.query(index.sql)
                    logger.info(`Created compound index: ${index.name}`, { scope: "migration" })
                    created++
                } catch (error) {
                    if (error.message.includes("Duplicate key name")) {
                        logger.warn(`Index ${index.name} already exists (duplicate)`, { scope: "migration" })
                        skipped++
                    } else {
                        logger.error(`Failed to create index ${index.name}`, {
                            scope: "migration",
                            error: error.message
                        })
                        throw error
                    }
                }
            }

            // Drop old single-column indexes if they exist
            const indexesToDrop = ["idx_created_at", "idx_log_type"]
            let dropped = 0

            for (const indexName of indexesToDrop) {
                if (!indexNames.has(indexName)) {
                    continue
                }

                try {
                    await connection.query(`DROP INDEX ${indexName} ON logs`)
                    logger.info(`Dropped old single-column index: ${indexName}`, { scope: "migration" })
                    dropped++
                } catch (error) {
                    logger.warn(`Failed to drop index ${indexName}`, {
                        scope: "migration",
                        error: error.message
                    })
                }
            }

            logger.info("Migration completed successfully", {
                scope: "migration",
                summary: {
                    created,
                    skipped,
                    dropped
                }
            })

            // Analyze table for optimization
            logger.info("Running ANALYZE TABLE for query optimization...", { scope: "migration" })
            await connection.query("ANALYZE TABLE logs")
            logger.info("Table analysis complete", { scope: "migration" })
        } finally {
            connection.release()
        }

        await pool.end()
        logger.info("Database connection closed", { scope: "migration" })
        process.exit(0)
    } catch (error) {
        logger.error("Migration failed", {
            scope: "migration",
            error: error.message,
            stack: error.stack
        })
        process.exit(1)
    }
}

migrate()
