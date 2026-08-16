const fs = require("fs");
const path = require("path");

const DEFAULTS = Object.freeze({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com"
});

class SettingsStore {
    constructor({ filePath, safeStorage, seedEnv = {} }) {
        this.filePath = filePath;
        this.safeStorage = safeStorage;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (!fs.existsSync(filePath)) {
            const provider = seedEnv.AI_PROVIDER === "openai" ? "openai" : "deepseek";
            const apiKey = provider === "openai" ? seedEnv.OPENAI_API_KEY : seedEnv.DEEPSEEK_API_KEY;
            this.save({
                provider,
                model: provider === "openai" ? seedEnv.OPENAI_MODEL : seedEnv.DEEPSEEK_MODEL,
                baseUrl: provider === "openai" ? seedEnv.OPENAI_BASE_URL : seedEnv.DEEPSEEK_BASE_URL,
                apiKey: apiKey || ""
            });
        }
    }

    encrypt(value) {
        if (!value) return "";
        if (!this.safeStorage.isEncryptionAvailable()) {
            throw new Error("当前系统无法安全保存 API 密钥");
        }
        return this.safeStorage.encryptString(value).toString("base64");
    }

    decrypt(value) {
        if (!value) return "";
        try {
            return this.safeStorage.decryptString(Buffer.from(value, "base64"));
        } catch {
            return "";
        }
    }

    readRaw() {
        return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    }

    publicSettings() {
        const settings = this.readRaw();
        return {
            provider: settings.provider,
            model: settings.model,
            baseUrl: settings.baseUrl,
            hasApiKey: Boolean(settings.encryptedApiKey)
        };
    }

    save(input) {
        const current = fs.existsSync(this.filePath) ? this.readRaw() : {};
        const provider = input.provider === "openai" ? "openai" : "deepseek";
        const defaults = provider === "openai"
            ? { model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" }
            : DEFAULTS;
        const settings = {
            version: 1,
            provider,
            model: String(input.model || defaults.model).trim().slice(0, 100),
            baseUrl: String(input.baseUrl || defaults.baseUrl).trim().replace(/\/$/, ""),
            encryptedApiKey: input.apiKey ? this.encrypt(String(input.apiKey).trim()) : current.encryptedApiKey || ""
        };
        const tempPath = `${this.filePath}.tmp`;
        fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        fs.renameSync(tempPath, this.filePath);
        return this.publicSettings();
    }

    toEnv() {
        const settings = this.readRaw();
        const key = this.decrypt(settings.encryptedApiKey);
        return settings.provider === "openai" ? {
            AI_PROVIDER: "openai",
            OPENAI_API_KEY: key,
            OPENAI_MODEL: settings.model,
            OPENAI_BASE_URL: settings.baseUrl
        } : {
            AI_PROVIDER: "deepseek",
            DEEPSEEK_API_KEY: key,
            DEEPSEEK_MODEL: settings.model,
            DEEPSEEK_BASE_URL: settings.baseUrl
        };
    }
}

module.exports = { SettingsStore };
