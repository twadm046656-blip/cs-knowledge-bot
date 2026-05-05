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
// ■ ナレッジ取得
// =========================
async function getKnowledge(query) {
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

    if (
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

  return results.slice(0, 5);
}

// =========================
// ■ ナレッジ保存（OK時）
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

    // ナレッジ取得
    const knowledgeList = await getKnowledge(message);

    // Dify送信
    const payload = {
      inputs: {
        knowledge: JSON.stringify(knowledgeList)
      },
      query: message,
      user: userId,
      response_mode: "blocking"
    };

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

    const answer = difyRes.data.answer || "";

    return res.json({
      answer,
      knowledge: knowledgeList
    });

  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).json({ error: "server error" });
  }
});

// =========================
// ■ ナレッジ保存API（OK押した時）
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
