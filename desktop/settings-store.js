const fs = require("fs");
const path = require("path");

const PROVIDER_DEFAULTS = Object.freeze({
    deepseek: Object.freeze({ model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com" }),
    openai: Object.freeze({ model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" })
});

class SettingsStore {
    constructor({ filePath, safeStorage, seedEnv = {} }) {
        this.filePath = filePath;
        this.backupPath = `${filePath}.bak`;
        this.safeStorage = safeStorage;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) this.write(this.fromSeed(seedEnv));
        else this.write(this.migrate(this.read()));
    }

    encrypt(value) {
        if (!value) return "";
        if (!this.safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API 密钥");
        return this.safeStorage.encryptString(value).toString("base64");
    }

    decrypt(value) {
        if (!value) return "";
        try { return this.safeStorage.decryptString(Buffer.from(value, "base64")); } catch { return ""; }
    }

    fromSeed(env) {
        const provider = env.AI_PROVIDER === "openai" ? "openai" : "deepseek";
        return {
            version: 2,
            provider,
            providers: {
                deepseek: {
                    ...PROVIDER_DEFAULTS.deepseek,
                    model: env.DEEPSEEK_MODEL || PROVIDER_DEFAULTS.deepseek.model,
                    baseUrl: env.DEEPSEEK_BASE_URL || PROVIDER_DEFAULTS.deepseek.baseUrl,
                    encryptedApiKey: this.encrypt(env.DEEPSEEK_API_KEY || "")
                },
                openai: {
                    ...PROVIDER_DEFAULTS.openai,
                    model: env.OPENAI_MODEL || PROVIDER_DEFAULTS.openai.model,
                    baseUrl: env.OPENAI_BASE_URL || PROVIDER_DEFAULTS.openai.baseUrl,
                    encryptedApiKey: this.encrypt(env.OPENAI_API_KEY || "")
                }
            }
        };
    }

    migrate(raw) {
        if (raw.version === 2 && raw.providers) return raw;
        const migrated = this.fromSeed({ AI_PROVIDER: raw.provider });
        const provider = raw.provider === "openai" ? "openai" : "deepseek";
        migrated.providers[provider] = {
            model: raw.model || PROVIDER_DEFAULTS[provider].model,
            baseUrl: raw.baseUrl || PROVIDER_DEFAULTS[provider].baseUrl,
            encryptedApiKey: raw.encryptedApiKey || ""
        };
        return migrated;
    }

    read() {
        try { return JSON.parse(fs.readFileSync(this.filePath, "utf8")); }
        catch (error) {
            if (!fs.existsSync(this.backupPath)) throw new Error(`AI 设置损坏且无可用备份：${error.message}`);
            const recovered = JSON.parse(fs.readFileSync(this.backupPath, "utf8"));
            fs.copyFileSync(this.backupPath, this.filePath);
            return recovered;
        }
    }

    write(settings) {
        const tempPath = `${this.filePath}.tmp`;
        if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, this.backupPath);
        fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        fs.renameSync(tempPath, this.filePath);
    }

    publicSettings() {
        const settings = this.migrate(this.read());
        const selected = settings.providers[settings.provider];
        return {
            provider: settings.provider,
            model: selected.model,
            baseUrl: selected.baseUrl,
            hasApiKey: Boolean(selected.encryptedApiKey),
            providerKeyStatus: Object.fromEntries(Object.entries(settings.providers).map(([name, value]) => [name, Boolean(value.encryptedApiKey)])),
            providerSettings: Object.fromEntries(Object.entries(settings.providers).map(([name, value]) => [name, { model: value.model, baseUrl: value.baseUrl }]))
        };
    }

    save(input) {
        const settings = this.migrate(this.read());
        const provider = input.provider === "openai" ? "openai" : "deepseek";
        const current = settings.providers[provider] || PROVIDER_DEFAULTS[provider];
        settings.provider = provider;
        settings.providers[provider] = {
            model: String(input.model || current.model).trim().slice(0, 100),
            baseUrl: String(input.baseUrl || current.baseUrl).trim().replace(/\/$/, ""),
            encryptedApiKey: input.apiKey ? this.encrypt(String(input.apiKey).trim()) : current.encryptedApiKey || ""
        };
        this.write(settings);
        return this.publicSettings();
    }

    toEnv() {
        const settings = this.migrate(this.read());
        const selected = settings.providers[settings.provider];
        const prefix = settings.provider === "openai" ? "OPENAI" : "DEEPSEEK";
        return {
            AI_PROVIDER: settings.provider,
            [`${prefix}_API_KEY`]: this.decrypt(selected.encryptedApiKey),
            [`${prefix}_MODEL`]: selected.model,
            [`${prefix}_BASE_URL`]: selected.baseUrl
        };
    }
}

module.exports = { PROVIDER_DEFAULTS, SettingsStore };
