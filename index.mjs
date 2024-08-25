import express from "express";
import pg from "pg";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI();

// Setup PostgreSQL
const { Client } = pg;
const postgresClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
await postgresClient.connect();

// Provision database
await postgresClient.query(
  "CREATE TABLE IF NOT EXISTS sites (slug varchar(50) PRIMARY KEY, content text NOT NULL)",
);

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const siteMessage = `You are generating whimsical websites for peoples' fictitious new companies. Reply to prompts with the first line being a slug for the website, such as "paw-pay", followed by an empty line, and then the code for the website, including embedded CSS for styling and JavaScript for interactivity (if necessary). Do not wrap the page in markdown backticks and do not include any commentary.`;

app.post("/generate", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: siteMessage },
        { role: "user", content: req.body.idea },
      ],
    });

    const reply = completion.choices[0].message.content;
    const breakpoint = reply.indexOf("\n");
    const baseSlug = reply.slice(0, breakpoint);
    const site = reply.slice(breakpoint + 1);

    let uniqueCounter = 0;
    let slug = baseSlug;

    while (
      (
        await postgresClient.query(
          "INSERT INTO sites (slug, content) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING RETURNING slug",
          [slug, site],
        )
      ).rowCount === 0
    ) {
      slug = `${baseSlug}-${++uniqueCounter}`;
    }

    res.status(200).send(JSON.stringify({ slug }));
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.get("/site/:slug", async (req, res) => {
  try {
    const result = await postgresClient.query(
      "SELECT (content) FROM sites WHERE slug = $1",
      [req.params.slug],
    );

    if (result.rows.length == 1) {
      res.send(result.rows[0].content);
    } else {
      res.status(404).send();
    }
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.listen(port, () => {
  console.log("App running on port " + String(port));
});
