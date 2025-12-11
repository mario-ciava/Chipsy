module.exports = {
    apps: [
        {
            name: "chipsy",
            script: "api/index.js",
            instances: 1,
            exec_mode: "fork",
            watch: false,
            autorestart: true,
            max_memory_restart: "750M",
            env: {
                PORT: 8082
            },
            env_local: {
                CHIPSY_ENV: "local",
                NODE_ENV: "development"
            },
            env_production: {
                CHIPSY_ENV: "production",
                NODE_ENV: "production",
                SESSION_STORE: "mysql"
            }
        }
    ]
}
