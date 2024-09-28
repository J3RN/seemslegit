/* DDL Queries */

export const createSites = postgresClient.query(
  "CREATE TABLE IF NOT EXISTS sites (slug varchar(50) PRIMARY KEY)",
);

export const createPrompts = postgresClient.query(
  "CREATE TABLE IF NOT EXISTS prompts (id UUID PRIMARY KEY, inserted_at timestamp NOT NULL, site_slug varchar(50) REFERENCES sites(slug) NOT NULL, prompt text NOT NULL)",
);

export const createResponses = postgresClient.query(
  "CREATE TABLE IF NOT EXISTS responses (id UUID PRIMARY KEY, prompt_id UUID REFERENCES prompts(id) NOT NULL, website text NOT NULL)",
);

export const createImages = postgresClient.query(
  "CREATE TABLE IF NOT EXISTS images (prompt text PRIMARY KEY, image_data bytea NOT NULL)",
);

/* Data Queries */

export const saveSite = async (baseSlug) => {
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

export const fetchSite = async (slug) => {
  const result = await postgresClient.query(
    "SELECT (website) FROM responses INNER JOIN prompts ON responses.prompt_id = prompts.id WHERE prompts.site_slug = $1 AND prompts.inserted_at = (SELECT MAX(inserted_at) FROM prompts WHERE site_slug = $1)",
    [slug],
  );

  return result.rows[0];
};

export const savePrompt = async (slug, prompt) => {
  const promptId = crypto.randomUUID();
  await postgresClient.query(
    "INSERT INTO prompts (id, inserted_at, site_slug, prompt) VALUES ($1, now(), $2, $3)",
    [promptId, slug, prompt],
  );
  return promptId;
};

export const saveResponse = async (promptId, website) => {
  const responseId = crypto.randomUUID();
  await postgresClient.query(
    "INSERT INTO responses (id, prompt_id, website) VALUES ($1, $2, $3)",
    [responseId, promptId, website],
  );
  return responseId;
};

export const previousRefinements = async (slug) => {
  const results = await postgresClient.query(
    "SELECT prompts.prompt AS prompt, responses.website AS website \
       FROM prompts INNER JOIN responses ON responses.prompt_id = prompts.id \
       WHERE prompts.site_slug = $1 \
       ORDER BY inserted_at ASC",
    [slug.trim()],
  );

  return results.rows;
};

export const fetchImage = async (prompt) => {
  const result = await postgresClient.query(
    "SELECT (image_data) FROM images WHERE prompt = $1",
    [prompt.trim()],
  );

  return result.rows[0]?.image_data;
};

export const saveImage = (prompt, image) =>
  postgresClient.query(
    "INSERT INTO images (prompt, image_data) VALUES ($1, $2)",
    [prompt, image],
  );
