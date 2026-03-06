⚙️ Backend – install these

cd backend

npm install express mongoose dotenv cors axios jsonwebtoken bcryptjs node-cron

npm install --save-dev nodemon

⚠️ When working with the virtual try-on feature there is an optional mock mode that simply returns the uploaded user photo instead of calling the external API. You can disable the mock by ensuring the environment variable `USE_MOCK_VTON` is either unset or set to `false` (set to `true` for development testing).

Make sure you supply the external API details via environment variables (or `backend/src/config/apikeys.js`):

- `AIPHOTOCRAFT_API_URL` – **full API endpoint** of the try-on service (e.g. `https://api.aiphotocraft.com/v1/try-on`). The base website (`https://aiphotocraft.com`) is not sufficient.
- `AIPHOTOVR_KEY` or `AIPHOTOCRAFT_API_KEY` – your **secret API key/token** obtained from the provider.

> ⚠️ The sample key shown in `config/apikeys.js` is only decorative and will not work. Replace it with the real key or set it via environment variables. If you leave the placeholder URL or key the server returns an explanatory error instead of crashing.

If the URL is missing or still the example value, the server will respond with a clear error message instead of crashing.

Also note the `backend/src/config/apikeys.js` file now uses an ES module `export default` so imports should use `import config from '../config/apikeys.js';`. 

⚙️ Frontend – install these

cd frontend

npm install react react-dom react-router-dom

npm install axios

npm install lucide-react

npm install sonner

npm install next-themes

npm install @radix-ui/react-slot

npm install class-variance-authority

npm install clsx

npm install tailwind-merge

⚙️ Tailwind CSS Setup

npm install -D tailwindcss postcss autoprefixer

npx tailwindcss init -p

⚙️ Vite React Plugin

npm install -D @vitejs/plugin-react


