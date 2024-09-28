import express from "express";
import pg from "pg";
import OpenAI from "openai";
import dotenv from "dotenv";
import mustache from "mustache";
import { readFile, readFileSync } from "node:fs";

import * as queries from "./queries";

dotenv.config();

const openai = new OpenAI();

// Setup PostgreSQL
const { Client } = pg;
const postgresClient = new Client({
  connectionString: process.env.DATABASE_URL,
  /* ssl: {
   *   rejectUnauthorized: false,
   * }, */
});
await postgresClient.connect();

// Provision database
await queries.createSites();
await queries.createPrompts();
await queries.createRespones();
await queries.createImages();

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

    const slug = await queries.saveSite(baseSlug);
    const promptId = await queries.savePrompt(slug, initialPrompt);
    await queries.saveResponse(promptId, site);

    res.status(200).send(JSON.stringify({ slug }));
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.get("/site/:slug", async (req, res) => {
  try {
    const renderedOverlay = mustache.render(overlay, {
      uuid: crypto.randomUUID(),
      ballAnimation,
    });
    const savedSite = await queries.fetchSite(req.params.slug);

    if (savedSite) {
      // Inject overlay into generated site
      const website = result.rows[0].website;
      const injectionSite = website.indexOf("</html>");
      const mutatedWebsite =
        website.slice(0, injectionSite) + renderedOverlay + "</html>";

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

    const previous = await queries.previousRefinements(slug);
    if (previous.length > 0) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: siteMessage },
          { role: "user", content: previous[0].prompt },
          { role: "assistant", content: previous[0].website },
          { role: "system", content: refinementIntroduction },
          ...previous.slice(1).flatMap((row) => [
            { role: "user", content: row.prompt },
            { role: "assistant", content: row.website },
          ]),
          { role: "user", content: prompt },
        ],
      });

      const reply = completion.choices[0].message.content;

      const promptId = await queries.savePrompt(slug, prompt);
      await queries.saveResponse(promptId, reply);

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
    const prompt = req.params.prompt;
    let image = queries.fetchImage(prompt);

    if (!image) {
      const imageUrl = await ai.generateImage(prompt);
      image = await fetch(imageUrl).then((resp) => resp.arrayBuffer());
      await saveImage(prompt, image);
    }

    res.set("Content-Type", "image/png").send(image);
  } catch (e) {
    console.debug(e);
    res.status(500).send();
  }
});

app.listen(port, () => {
  console.log("App running on port " + String(port));
});
