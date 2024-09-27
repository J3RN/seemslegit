import express from "express";
import pg from "pg";
import OpenAI from "openai";
import dotenv from "dotenv";
import mustache from "mustache";
import { readFile, readFileSync } from "node:fs";

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
  "CREATE TABLE IF NOT EXISTS sites (slug varchar(50) PRIMARY KEY)",
);
await postgresClient.query(
  "CREATE TABLE IF NOT EXISTS prompts (id UUID PRIMARY KEY, inserted_at timestamp NOT NULL, site_slug varchar(50) REFERENCES sites(slug) NOT NULL, prompt text NOT NULL)",
);
await postgresClient.query(
  "CREATE TABLE IF NOT EXISTS responses (id UUID PRIMARY KEY, prompt_id UUID REFERENCES prompts(id) NOT NULL, website text NOT NULL)",
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
  'You are generating detailed websites for users.\
 The websites should appear sleek and professional unless otherwise stated by the user.\
 Reply to prompts with the first line being a slug for the website, such as "paw-pay", followed by an empty line.\
 The slug should not end in a TLD like "com", "org", or "net",\
 and then the code for the website, including embedded CSS for styling and JavaScript for interactivity (if necessary).\
 Do not wrap the page in markdown backticks and do not include any commentary.\
 Where images are needed, use a url like `/images/descriptive-name-here-256x256`.  No file extension is required or permitted.\
 Be as descriptive as you want in the description portion of the image URL.  After the last hyphen is a size parameter.\
 Supported sizes are 256x256, 512x512, and 1024x1024.';

const refinementIntroduction =
  "The user will now provide additional refinements to the generated website.\
 In response to these messages, reply with only the markup for the site including CSS and JavaScript as before,\
 but do not include a slug on the first line";

const ballAnimation = readFileSync("./views/ball-animation.html.mustache");
const overlay = readFileSync("./views/overlay.html.mustache").toString();

const letters = "0123456789ABCDEF";
const generateColor = () =>
  new Array(6)
    .fill()
    .map(() => letters[Math.floor(Math.random() * 16)])
    .join("");

app.get("/", (req, res) => {
  res.render("index.html.mustache", {
    ballAnimation,
    firstColor: generateColor(),
    secondColor: generateColor(),
  });
});

app.post("/generate", async (req, res) => {
  try {
    const initialPrompt = req.body.idea;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: siteMessage },
        { role: "user", content: initialPrompt },
      ],
    });

    const reply = completion.choices[0].message.content;
    const breakpoint = reply.indexOf("\n");
    const baseSlug = reply.slice(0, breakpoint).trim();
    const site = reply.slice(breakpoint + 1).trim();

    const slug = await saveSite(baseSlug);
    const promptId = await savePrompt(slug, initialPrompt);
    await saveResponse(promptId, site);

    res.status(200).send(JSON.stringify({ slug }));
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

const saveSite = async (baseSlug) => {
  let uniqueCounter = 0;
  let slug = baseSlug;

  while (
    (
      await postgresClient.query(
        "INSERT INTO sites (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING RETURNING slug",
        [slug],
      )
    ).rowCount === 0
  ) {
    slug = `${baseSlug}-${++uniqueCounter}`;
  }

  return slug;
};

const savePrompt = async (slug, prompt) => {
  const promptId = crypto.randomUUID();
  await postgresClient.query(
    "INSERT INTO prompts (id, inserted_at, site_slug, prompt) VALUES ($1, now(), $2, $3)",
    [promptId, slug, prompt],
  );
  return promptId;
};

const saveResponse = async (promptId, website) => {
  const responseId = crypto.randomUUID();
  await postgresClient.query(
    "INSERT INTO responses (id, prompt_id, website) VALUES ($1, $2, $3)",
    [responseId, promptId, website],
  );
  return responseId;
};

app.get("/site/:slug", async (req, res) => {
  try {
    const result = await postgresClient.query(
      "SELECT (website) FROM responses INNER JOIN prompts ON responses.prompt_id = prompts.id WHERE prompts.site_slug = $1 AND prompts.inserted_at = (SELECT MAX(inserted_at) FROM prompts WHERE site_slug = $1)",
      [req.params.slug],
    );

    const uuid = crypto.randomUUID();
    const renderedOverlay = mustache.render(overlay, {uuid, ballAnimation});

    if (result.rows.length == 1) {
      // Inject overlay into generated site
      const website = result.rows[0].website;
      const site = website.indexOf("</html>");
      const mutatedWebsite = website.slice(0,site) + renderedOverlay + "</html>";

      res.send(mutatedWebsite);
    } else {
      res.status(404).render("not_found.html.mustache");
    }
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.post("/site/:slug/refine", async (req, res) => {
  try {
    const slug = req.params.slug;
    const prompt = req.body.refinement;

    const previousPrompts = await postgresClient.query(
      "SELECT prompts.prompt AS prompt, responses.website AS website \
       FROM prompts INNER JOIN responses ON responses.prompt_id = prompts.id \
       WHERE prompts.site_slug = $1 \
       ORDER BY inserted_at ASC",
      [slug],
    );

    if (previousPrompts.rows.length >= 1) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: siteMessage },
          { role: "user", content: previousPrompts.rows[0].prompt },
          { role: "assistant", content: previousPrompts.rows[0].website },
          { role: "system", content: refinementIntroduction },
          ...previousPrompts.rows.slice(1).flatMap((row) => [
            { role: "user", content: row.prompt },
            { role: "assistant", content: row.website },
          ]),
          { role: "user", content: prompt },
        ],
      });

      const reply = completion.choices[0].message.content;

      const promptId = await savePrompt(slug, prompt);
      await saveResponse(promptId, reply);

      res.send();
    } else {
      res.status(404).render("not_found.html.mustache");
    }
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.get("/images/:prompt", async (req, res) => {
  try {
    let prompt = req.params.prompt;
    let size = "256x256";

    if (prompt.endsWith("-1024x1024")) {
      prompt = prompt.slice(0, prompt.length - 10);
      size = "1024x1024";
    } else if (prompt.endsWith("-512x512")) {
      prompt = prompt.slice(0, prompt.length - 8);
      size = "512x512";
    } else if (prompt.endsWith("-256x256")) {
      prompt = prompt.slice(0, prompt.length - 8);
      size = "256x256";
    }

    prompt = prompt.split("-").join(" ");

    openai.images.generate({model: "dall-e-2", prompt, size}).then((resp) => {
      const url = resp.data[0].url;
      res.redirect(url);
    })
  } catch {
    res.status(500).send();
  }
});

app.listen(port, () => {
  console.log("App running on port " + String(port));
});
