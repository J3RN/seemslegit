import express from "express";
import pg from "pg";
import OpenAI from "openai";
import dotenv from "dotenv";
import mustache from "mustache";
import { readFile } from "node:fs";

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

// Configure and start Express
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const mustacheWrapper = (path, options, callback) => {
  readFile(path, "utf8", (err, data) => {
    if (err) callback(err);
    else callback(null, mustache.render(data, options));
  });
};

app.engine("mustache", mustacheWrapper);
app.set("views", "./views");
app.set("view engine", "mustache");

const siteMessage =
  'You are generating detailed websites for fictitious new companies.\
 The content for the websites should be funny and whimsical while the styling is sleek and professional.\
 Reply to prompts with the first line being a slug for the website, such as "paw-pay", followed by an empty line,\
 and then the code for the website, including embedded CSS for styling and JavaScript for interactivity (if necessary).\
 Do not wrap the page in markdown backticks and do not include any commentary.\n\
Items to consider including in the generated sites:\n\
- Products and services offered by the company, including stand-out features and key differentiations that distinguish the company\'s products from the competition.\n\
- The issue that the products or services are attempting to solve. Tell potential customers how their lives will be improved.\n\
- Testimonials, good things people have said about our products or services.\n\
- "About Us", the story of the company, why it was created, what the mission is.\n\
- "The Team", the people who work here. Names, jobs, and a snippet of background.\n\
- "Careers", the jobs that are available at the company, and the benefits that come with working there.';

const letters = "0123456789ABCDEF";
const generateColor = () =>
  new Array(6)
    .fill()
    .map(() => letters[Math.floor(Math.random() * 16)])
    .join("");

app.get("/", (req, res) => {
  res.render("index.html.mustache", {
    firstColor: generateColor(),
    secondColor: generateColor(),
  });
});

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
