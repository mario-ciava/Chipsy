import axios from 'axios'

export default {
    async getAccessData(_code) {
        return new Promise((resolve, reject) => {
            if (_code) {
                axios.get('http://localhost:3000/api/auth', {
                    headers: {
                        code: _code
                    }
                })
                .then((response) => {
                    resolve(response.data);
                })
                .catch((error) => {
                    reject(error);
                })
            }
        });
    },
    async getUser(_token) {
        var output = await new Promise((resolve, reject) => {
            if (_token) {
                axios.get('http://localhost:3000/api/user', {
                    headers: {
                        token: _token
                    }
                })
                .then((response) => {
                    resolve(response.data)
                })
                .catch((error) => {
                    reject(error)
                })
            } else {
                reject();
            }
        })
        return output
    },
    async getClient(_token) {
        var output = await new Promise((resolve, reject) => {
            if (_token) {
                axios.get('http://localhost:3000/api/client', {
                    headers: {
                        token: _token
                    }
                })
                .then((response) => {
                    resolve(response.data)
                })
                .catch((error) => {
                    reject(error)
                })
            } else {
                reject();
            }
        })
        return output
    },
    async getGuilds(_token) {
        var output = await new Promise((resolve, reject) => {
            if (_token) {
                axios.get('http://localhost:3000/api/guilds', {
                    headers: {
                        token: _token
                    }
                })
                .then((response) => {
                    resolve(response.data)
                })
                .catch((error) => {
                    reject(error)
                })
            } else {
                reject();
            }
        })
        return output
    },
    async getGuildObj(_token, id) {
        var output = await new Promise((resolve, reject) => {
            if (_token) {
                axios.get('http://localhost:3000/api/guild', {
                    headers: {
                        token: _token
                    }
                })
                .then((response) => {
                    resolve(response.data)
                })
                .catch((error) => {
                    reject(error)
                })
            } else {
                reject();
            }
        })
        return output
    }
}