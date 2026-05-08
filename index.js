import express from "express";
import axios from "axios";
import { google } from "googleapis";

const app = express();
app.use(express.json());

// =========================
// ■ 環境変数
// =========================
const DIFY_API = process.env.DIFY_API;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// =========================
// ■ Google認証
// =========================
const raw = JSON.parse(process.env.GOOGLE_CREDENTIALS);
raw.private_key = raw.private_key.replace(/\\n/g, "\n");

const auth = new google.auth.GoogleAuth({
  credentials: raw,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// =========================
// ■ ナレッジ取得（内部用）
// =========================
async function getKnowledge(query = "") {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "knowledgeDB!A:E"
  });

  const rows = res.data.values || [];
  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const title = rows[i][1] || "";
    const question = rows[i][2] || "";
    const answer = rows[i][3] || "";

    // queryが空なら全件取得
    if (
      !query ||
      title.includes(query) ||
      question.includes(query) ||
      answer.includes(query)
    ) {
      results.push({
        title,
        question,
        answer
      });
    }
  }

  return results.slice(0, 50); // Dify用に少し多めでもOK（調整可）
}

// =========================
// ■ ナレッジ取得API（←追加これが重要）
// =========================
app.get("/knowledge", async (req, res) => {
  try {
    const data = await getKnowledge("");
    return res.json(data);
  } catch (error) {
    console.error("knowledge取得エラー:", error);
    return res.status(500).json({ error: "knowledge取得失敗" });
  }
});

// =========================
// ■ ナレッジ保存
// =========================
async function saveKnowledge({ title, question, answer }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "knowledgeDB!A:E",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        Date.now(),
        title,
        question,
        answer,
        new Date().toISOString()
      ]]
    }
  });
}

// =========================
// ■ Chat API
// =========================
app.post("/chat", async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: "userIdとmessageは必須です" });
    }

    console.log("==== REQUEST START ====");
    console.log("message:", message);

    // ナレッジ取得
    const knowledgeList = await getKnowledge(message);

    console.log("knowledgeList:", knowledgeList);

    // ★ Difyは「文字列必須」なのでJSON文字列化
    const safeKnowledge =
      knowledgeList.length > 0
        ? JSON.stringify(knowledgeList)
        : "ナレッジは見つかりませんでした";

    const payload = {
      inputs: {
        knowledge_db: safeKnowledge
      },
      query: message,
      user: userId,
      response_mode: "blocking"
    };

    console.log("payload:", JSON.stringify(payload, null, 2));

    const difyRes = await axios.post(
      "https://api.dify.ai/v1/chat-messages",
      payload,
      {
        headers: {
          Authorization: `Bearer ${DIFY_API}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Dify response:", difyRes.data);

    const answer = difyRes.data.answer || "";

    return res.json({
      answer,
      knowledge: knowledgeList
    });

  } catch (error) {
    console.error("エラー詳細:", error.response?.data || error.message);
    return res.status(500).json({ error: "server error" });
  }
});

// =========================
// ■ ナレッジ保存API
// =========================
app.post("/save", async (req, res) => {
  try {
    const { title, question, answer } = req.body;

    if (!title || !question || !answer) {
      return res.status(400).json({ error: "必要項目不足" });
    }

    await saveKnowledge({ title, question, answer });

    return res.json({ status: "saved" });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "server error" });
  }
});

// =========================
// ■ 起動
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバー起動: ${PORT}`);
});
