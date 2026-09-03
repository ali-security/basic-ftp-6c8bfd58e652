const assert = require("assert");
const { Client } = require("../dist");
const MockFtpServer = require("./MockFtpServer");

const TIMEOUT = 1000
const LISTING_LINE = "-rw-------    1 1001     1001          487 Feb 25 19:03 package.json\r\n"

describe("Directory listing size limit", function() {

    this.beforeEach(() => {
        this.server = new MockFtpServer()
        // A server flooding the data connection will see it closed by the client. Don't let
        // the resulting socket error of the mock server crash the test process.
        this.server.didOpenDataConn = () => this.server.dataConn.on("error", () => {})
    })

    this.afterEach(() => {
        if (this.client) {
            this.client.close()
            this.client = undefined
        }
        this.server.close()
    })

    const connect = async (options) => {
        this.client = new Client(TIMEOUT, options)
        await this.client.access({
            port: this.server.ctrlAddress.port,
            user: "test",
            password: "test"
        })
        return this.client
    }

    const serverSendsListing = (payload) => {
        this.server.addHandlers({
            "pasv": () => `227 Entering Passive Mode (${this.server.dataAddressForPasvResponse})`,
            "list": () => {
                setTimeout(() => {
                    this.server.dataConn.write(payload)
                    this.server.dataConn.end()
                })
                return "150 Ready to send listing"
            }
        })
    }

    it("limits listings to a default maximum size", async () => {
        const client = await connect()
        assert.strictEqual(client.options.maxListingBytes, 40 * 1024 * 1024)
    })

    it("can configure the maximum listing size", async () => {
        const client = await connect({ maxListingBytes: 1024 })
        assert.strictEqual(client.options.maxListingBytes, 1024)
    })

    it("can list a directory within the limit", async () => {
        const client = await connect()
        serverSendsListing(LISTING_LINE)
        const list = await client.list()
        assert.strictEqual(list.length, 1)
        assert.strictEqual(list[0].name, "package.json")
    })

    it("stops a listing that exceeds the maximum size", async () => {
        const client = await connect({ maxListingBytes: 1024 })
        // A malicious server answers a directory listing with far more data than
        // the client asked for, trying to exhaust its memory.
        serverSendsListing(LISTING_LINE.repeat(5000))
        await assert.rejects(() => client.list(), err => {
            assert.ok(/out of bounds/i.test(err.message), err.message)
            assert.ok(err.message.indexOf("maxByteLength=1024") !== -1, err.message)
            return true
        })
    })
})
