module.exports = {
    logger: require("./logger"),
    experience: require("./experience"),
    features: require("./features"),
    utils: {
        setSeparator: require("./utils/setSeparator")
    },
    db: {
        withTransaction: require("./db/withTransaction"),
        analyzeQuery: require("./db/queryAnalyzer")
    },
    database: {
        createDataHandler: require("./database/dataHandler")
    },
    gameRegistry: require("./gameRegistry"),
    services: {
        createAdminService: require("./services/adminService"),
        createRuntimeConfigService: require("./services/runtimeConfigService"),
        createDiagnosticsService: require("./services/diagnosticsService")
    }
}
