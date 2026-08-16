const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AccountStore } = require("../desktop/account-store");
const { parseEnv } = require("../desktop/env");
const { SettingsStore } = require("../desktop/settings-store");

test("parses desktop environment configuration", () => {
    assert.deepEqual(parseEnv("# comment\nAI_PROVIDER=deepseek\nEMPTY=\nQUOTED=\"hello world\"\n"), {
        AI_PROVIDER: "deepseek",
        EMPTY: "",
        QUOTED: "hello world"
    });
});

test("adds, updates and removes dynamic accounts", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-account-store-"));
    try {
        const store = new AccountStore({
            filePath: path.join(dataDir, "accounts.json"),
            dataDir
        });
        const added = store.add({ name: "客服小李", region: "上海静安", enabled: true, wechatCardType: "personal" });
        assert.match(added.id, /^acc_[a-f0-9]{12}$/);
        assert.equal(added.region, "上海静安");
        assert.equal(store.list().length, 1);
        assert.equal(store.update(added.id, { name: "客服小王", region: "杭州西湖", enabled: false }).name, "客服小王");
        assert.equal(store.list()[0].region, "杭州西湖");
        assert.equal(store.list()[0].enabled, false);
        assert.throws(() => store.add({ name: "", region: "上海" }), /名称不能为空/);
        assert.throws(() => store.add({ name: "客服", region: "" }), /地区不能为空/);
        assert.equal(store.remove(added.id).id, added.id);
        assert.equal(store.list().length, 0);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("starts a fresh desktop installation without fixed accounts", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-empty-seed-"));
    try {
        const store = new AccountStore({
            filePath: path.join(dataDir, "accounts.json"),
            dataDir,
            seedFile: path.resolve(__dirname, "../accounts.json")
        });
        assert.deepEqual(store.list(), []);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("migrates legacy accounts with a visible region placeholder", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-account-migrate-"));
    try {
        const filePath = path.join(dataDir, "accounts.json");
        fs.writeFileSync(filePath, JSON.stringify({ accounts: [{
            id: "legacy",
            name: "旧账号",
            enabled: true,
            profileDir: path.join(dataDir, "profile"),
            logFile: path.join(dataDir, "legacy.log")
        }] }));
        const store = new AccountStore({ filePath, dataDir });
        assert.equal(store.list()[0].region, "地区待补充");
        assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).version, 2);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});

test("encrypts desktop API settings and only exposes key presence", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-settings-"));
    const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(`encrypted:${value}`),
        decryptString: value => value.toString().replace(/^encrypted:/, "")
    };
    try {
        const store = new SettingsStore({
            filePath: path.join(dataDir, "settings.json"),
            safeStorage,
            seedEnv: { AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "secret", DEEPSEEK_MODEL: "model" }
        });
        assert.deepEqual(store.publicSettings(), {
            provider: "deepseek",
            model: "model",
            baseUrl: "https://api.deepseek.com",
            hasApiKey: true
        });
        assert.equal(store.toEnv().DEEPSEEK_API_KEY, "secret");
        assert.doesNotMatch(fs.readFileSync(store.filePath, "utf8"), /secret/);
    } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
});
