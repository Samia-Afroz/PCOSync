// configuration file for virtual try-on API
// values are loaded from environment variables; this file only provides
// fallback defaults or documentation.  **Do not commit real keys here.**

export default {
  // API key – set via env or supply directly here (not recommended)
  AIPHOTOVR_KEY: process.env.AIPHOTOVR_KEY || process.env.AIPHOTOCRAFT_API_KEY || '',

  // Base URL for the API. It should include "/api" if that's part of the
  // provider's base path. The code will append "/virtual_try_on" and
  // "/task-status/{id}" when making requests.
  AIPHOTOCRAFT_API_URL:
    process.env.AIPHOTOCRAFT_API_URL || process.env.AIPHOTOVR_URL || '',
};
