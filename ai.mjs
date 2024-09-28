const generateImage = (prompt) => {
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

  return openai.images
    .generate({ model: "dall-e-2", prompt, size })
    .then((resp) => resp.data[0].url);
};
