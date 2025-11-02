jest.mock("express-mysql-session", () => {
    const instances = []
    const factory = jest.fn(() => {
        return function MockStore(options, pool) {
            this.options = options
            this.pool = pool
            this.records = new Map()
            this.failures = {}
            this.throwers = {}
            this.on = jest.fn()
            instances.push(this)

            this.get = jest.fn((sid, cb) => {
                if (this.throwers.get) {
                    throw new Error("mock-get-throw")
                }
                if (this.failures.get) {
                    cb(new Error("mock-get-failure"))
                    return
                }
                cb(null, this.records.get(sid))
            })

            this.set = jest.fn((sid, sess, cb) => {
                if (this.throwers.set) {
                    throw new Error("mock-set-throw")
                }
                if (this.failures.set) {
                    cb(new Error("mock-set-failure"))
                    return
                }
                this.records.set(sid, sess)
                cb(null)
            })

            this.destroy = jest.fn((sid, cb) => {
                this.records.delete(sid)
                if (cb) cb(null)
            })

            this.touch = jest.fn((sid, sess, cb) => {
                if (cb) cb(null)
            })

            this.length = jest.fn((cb) => cb(null, this.records.size))
            this.clear = jest.fn((cb) => {
                this.records.clear()
                cb(null)
            })
            this.ids = jest.fn((cb) => cb(null, Array.from(this.records.keys())))
            this.all = jest.fn((cb) => cb(null, Array.from(this.records.values())))
        }
    })
    factory.__instances = instances
    return factory
})

const session = require("express-session")
const createSessionStore = require("../api/services/sessionStoreFactory")
const mysqlStoreFactory = require("express-mysql-session")

describe("sessionStoreFactory", () => {
    beforeEach(() => {
        mysqlStoreFactory.__instances.length = 0
    })

    test("falls back to memory store when MySQL pool is missing", () => {
        const store = createSessionStore({ session, pool: null })
        expect(store).toBeInstanceOf(session.MemoryStore)
    })

    test("uses memory fallback when the MySQL store fails", (done) => {
        const store = createSessionStore({ session, pool: {} })
        const mysqlInstance = mysqlStoreFactory.__instances[0]
        mysqlInstance.failures.set = true

        store.set("test-session", { cookie: { maxAge: 123 } }, (setError) => {
            expect(setError == null).toBe(true)
            store.get("test-session", (getError, sessionData) => {
                expect(getError).toBeNull()
                expect(sessionData).toBeTruthy()
                expect(sessionData.cookie.maxAge).toBe(123)
                done()
            })
        })
    })
})
