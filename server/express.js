const express = require("express"),
    path = require("path"),
    bodyparser = require("body-parser"),
    request = require("request"),
    session = require("express-session"),
    Discord = require("discord.js")

var app = express(),
    router = express.Router({ automatic405: true }),
    admin_token = null

module.exports = (client, webSocket) => {

    app.use(bodyparser.json());
    app.use(bodyparser.urlencoded({ extended : true }));
    app.use(session({
        secret: 'example',
        resave: false,
        saveUninitialized: true
      }));
      
    
    app.use((req, res, next) => {
        res.append('Access-Control-Allow-Origin', ['http://localhost:8080']);
        res.append("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
        res.append('Access-Control-Allow-Headers', 'token, code, content-type');
        //webSocket.emit("request", req);
        if (!admin_token && req.headers.token) {
            admin_token = 1
            request({
                url: "http://localhost:3000/api/getuser",
                method: "GET",
                headers: {
                    token: req.headers.token
                }
            }, (err, response) => {
                next();
            })
        } else {
            next();
        }
    });

    app.use((req, res, next) => {
        if (admin_token == req.headers.token) req.isAdmin = true
        next(); 
    })

    data = new Buffer.from(client.config.id).toString("base64") + new Buffer.from(`:${client.config.secret}`).toString("base64");

    router.get("/auth", (req, res) => {
        console.log("H E R E")
        let scopes = ["identify", "guilds"];
        if (!req.headers.code) {
            res.status(400).json({"message": "400: Bad Request"});
            return res.end();
        } else {
            console.log("H EEEE RE")
            request({
                url: `https://discordapp.com/api/oauth2/token?grant_type=authorization_code&code=${req.headers.code}&redirect_uri=http%3A%2F%2Flocalhost%3A8080&scope=${encodeURIComponent(scopes.join(" "))}`,
                method: "POST",
                headers: {
                    Authorization: `Basic ${data}`
                }
            }, (err, response) => {
                if (err) {
                    res.status(response.statusCode).json({"message": response.statusMessage})
                    global.errorLog(err);
                    return res.end();
                } else if (response.statusCode == 200) {
                    console.log("OOOK")
                    response.body = JSON.parse(response.body);
                    res.status(200).json(response.body);
                    webSocket.emit("auth", {
                        token: response.body.access_token,
                        scp: scopes 
                    });
                    return res.end();
                } else {
                    res.status(response.statusCode).json({"message": response.statusMessage});
                    return res.end();
                }
            });
        }
    });

    router.get("/user", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else {
            request({
                url: "http://discordapp.com/api/users/@me",
                method: "GET",
                headers: {
                    Authorization: `Bearer ${req.headers.token}`
                }
            }, (err, response) => {
                if (err) {
                    res.status(response.statusCode).json({"message": response.statusMessage})
                    global.errorLog(err);
                    return res.end();
                } else {
                    response.body = JSON.parse(response.body);
                    if (response.body.id == client.config.ownerid) {
                        admin_token = req.headers.token;
                        response.body.isAdmin = true
                    }
                    res.status(200).json(response.body);
                    res.end();
                }
            });
        }
    });

    router.get("/guilds", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else {
            request({
                url: "http://discordapp.com/api/users/@me/guilds",
                method: "GET",
                headers: {
                    Authorization: `Bearer ${req.headers.token}`
                }
            }, (err, response) => {
                if (err) {
                    console.error(err);
                    res.status(response.statusCode).json({"message": response.statusMessage})
                    global.errorLog(err);
                    return res.end();
                } else {
                    response.body = JSON.parse(response.body);
                    response.body = {
                        all: response.body,
                        added: response.body.filter((guild) => {
                            return client.guilds.get(guild.id)
                        }), 
                        available: response.body.filter((guild) => {
                            return new Discord.Permissions(guild.permissions).has("MANAGE_GUILD")
                        })
                    }
                    res.status(200).json(response.body);
                    res.end();
                }
            });
        }
    });

    router.post("/logout", (req, res) => {
        if (!req.body.user) {
            res.status(400).json({"message": "400: Bad request"})
            return res.end();
        } else {
            webSocket.emit("logout", req.body.user)
            res.status(200).json({"message": "200: OK"})
            return res.end()
        }
    })

    router.get("/turnoff", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else if (req.isAdmin) {
            client.config.enabled = false;
            webSocket.emit("disable")
            res.status(200).json({"message": "200: OK"})
            return res.end();
        } else {
            res.status(403).json({"message": "403: Forbidden"});
            return res.end();
        }
    });

    router.get("/turnon", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else if (req.isAdmin) {
            client.config.enabled = true;
            webSocket.emit("enable")
            res.status(200).json({"message": "200: OK"})
            return res.end();
        } else {
            res.status(403).json({"message": "403: Forbidden"});
            return res.end();
        }
    });

    router.get("/client", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else if (req.isAdmin) {
            res.status(200).json(client.config);
            return res.end();
        } else {
            res.status(403).json({"message": "403: Forbidden"});
            return res.end();
        }
    }),
    router.get("/guild", (req, res) => {
        if (!req.headers.token) {
            res.status(400).json({"message": "400: Bad request"});
            return res.end();
        } else if (req.isAdmin) {
            res.status(200).json(client.guilds.get(id));
            return res.end();
        } else {
            res.status(403).json({"message": "403: Forbidden"});
            return res.end();
        }
    })
    
    app.use("/api", router);

    app.use((req, res) => {
        res.status(404).json({"message": "404: Invalid endpoint"});
        return res.end();
    });

    app.listen(3000);
}