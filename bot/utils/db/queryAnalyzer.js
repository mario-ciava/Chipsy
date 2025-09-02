const { debug, warn } = require("../logger")

const shouldAnalyze = () => process.env.ENABLE_QUERY_ANALYSIS === "true"

const analyzeQuery = async(connection, query, params = [], { label } = {}) => {
    if (!shouldAnalyze()) return null
    if (!connection?.query) return null

    try {
        const [rows] = await connection.query(`EXPLAIN ANALYZE ${query}`, params)
        debug("Query analysis", {
            scope: "mysql",
            label,
            plan: rows
        })
        return rows
    } catch (err) {
        warn("Failed to run EXPLAIN ANALYZE", {
            scope: "mysql",
            label,
            message: err.message
        })
        return null
    }
}

module.exports = { analyzeQuery }
