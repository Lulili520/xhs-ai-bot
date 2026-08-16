const fs = require("fs");

function parseEnv(text) {
    const result = {};
    for (const rawLine of String(text || "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return parseEnv(fs.readFileSync(filePath, "utf8"));
}

module.exports = { loadEnv, parseEnv };
