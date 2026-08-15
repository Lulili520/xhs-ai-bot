const fs = require("fs");
const path = require("path");

const knowledgePath = path.resolve(__dirname, process.env.KNOWLEDGE_BASE_PATH || "data/knowledge-base.json");
let cache = { rules: [], entries: [] };

function loadKnowledgeBase() {
    try {
        cache = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
    } catch (error) {
        if (error.code !== "ENOENT") console.error("KNOWLEDGE_BASE_LOAD_ERROR", error.message);
    }
    return cache;
}

function retrieveKnowledge(text, limit = 3) {
    const query = String(text || "").toLowerCase();
    if (!query) return "";
    const matches = (cache.entries || [])
        .map(entry => ({
            ...entry,
            score: entry.keywords.reduce((score, keyword) => score + (query.includes(keyword.toLowerCase()) ? keyword.length : 0), 0)
        }))
        .filter(entry => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    if (!matches.length) return "";
    return [
        "历史话术知识库中与本轮相关的参考（结合语境自然改写，不要逐字机械复制）：",
        ...matches.map(entry => `- ${entry.answer}`)
    ].join("\n");
}

loadKnowledgeBase();

module.exports = { loadKnowledgeBase, retrieveKnowledge };
