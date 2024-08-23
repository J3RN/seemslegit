import express from "express";
import OpenAI from "openai";

const openai = new OpenAI();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));

app.post("/generate", (req, res) => {
  openai.chat.completions
    .create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
          "You are generating whimsical websites for peoples' fictitious new companies. Please reply to prompts with the website, including embedded CSS for styling and JavaScript for interactivity (if necessary). Do not wrap the page in markdown backticks and do not include any commentary.",
        },
        { role: "user", content: req.body.idea },
      ],
    })
    .then((completion) => {
      console.debug(completion.choices[0].message.content);
      res.send(completion.choices[0].message.content);
    })
    .catch((e) => {
      console.debug(e);
      res.send("Thanks for the idea.  I'm keeping that one.");
    });
});

app.listen(port, () => {
  console.log("App running on port " + String(port));
});
