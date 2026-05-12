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

const sheets = google.sheets({
  version: "v4",
  auth
});

// =========================
// ■ ナレッジ取得
// =========================

async function getKnowledge(query = "") {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "knowledgeDB!A:E"
  });

  const rows = res.data.values || [];

  const results = [];

  for (let i = 1; i < rows.length; i++) {

    const id = rows[i][0] || "";
    const title = rows[i][1] || "";
    const question = rows[i][2] || "";
    const answer = rows[i][3] || "";
    const createdAt = rows[i][4] || "";

    if (
      !query ||
      title.includes(query) ||
      question.includes(query) ||
      answer.includes(query)
    ) {

      results.push({
        id,
        title,
        question,
        answer,
        createdAt
      });

    }

  }

  return results.slice(0, 50);

}

// =========================
// ■ ナレッジ保存
// =========================

async function saveKnowledge({

  title,
  question,
  answer

}) {

  // =========================
  // 現在行取得
  // =========================

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "knowledgeDB!A:A"
  });

  const rows = current.data.values || [];

  // ヘッダ除外
  const nextId = rows.length;

  // =========================
  // append
  // =========================

  await sheets.spreadsheets.values.append({

    spreadsheetId: SPREADSHEET_ID,

    range: "knowledgeDB!A:E",

    valueInputOption: "RAW",

    requestBody: {

      values: [[
        nextId,
        title,
        question,
        answer,
        new Date().toISOString()
      ]]

    }

  });

}

// =========================
// ■ ナレッジ取得API
// =========================

app.get("/knowledge", async (req, res) => {

  try {

    const query = req.query.query || "";

    const data = await getKnowledge(query);

    return res.json(data);

  } catch (error) {

    console.error("knowledge取得エラー:", error);

    return res.status(500).json({
      error: "knowledge取得失敗"
    });

  }

});

// =========================
// ■ ナレッジ保存API
// =========================

app.post("/save", async (req, res) => {

  try {

    const {
      title,
      question,
      answer
    } = req.body;

    if (!title || !question || !answer) {

      return res.status(400).json({
        error: "必要項目不足"
      });

    }

    await saveKnowledge({
      title,
      question,
      answer
    });

    return res.json({
      status: "saved"
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "server error"
    });

  }

});

// =========================
// ■ Chat API
// =========================

app.post("/chat", async (req, res) => {

  try {

    const {
      userId,
      message
    } = req.body;

    if (!userId || !message) {

      return res.status(400).json({
        error: "userIdとmessageは必須です"
      });

    }

    console.log("==== REQUEST START ====");
    console.log("message:", message);

    // =========================
    // ナレッジ取得
    // =========================

    const knowledgeList = await getKnowledge(message);

    console.log("knowledgeList:", knowledgeList);

    // =========================
    // Difyへ渡す
    // =========================

    const safeKnowledge =
      knowledgeList.length > 0
        ? JSON.stringify(knowledgeList, null, 2)
        : "ナレッジは見つかりませんでした";

    const payload = {

      inputs: {
        knowledge_db: safeKnowledge
      },

      query: message,

      user: userId,

      response_mode: "blocking"

    };

    console.log(
      "payload:",
      JSON.stringify(payload, null, 2)
    );

    // =========================
    // Dify
    // =========================

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

    console.error(
      "エラー詳細:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "server error"
    });

  }

});

// =========================
// ■ 起動
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`サーバー起動: ${PORT}`);

});
