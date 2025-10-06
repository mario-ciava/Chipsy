module.exports = {
    apps: [
        {
            name: "chipsy",
            script: "server/index.js",
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
            env_vps: {
                CHIPSY_ENV: "vps",
                NODE_ENV: "production",
                SESSION_STORE: "mysql"
            }
        }
    ]
}
