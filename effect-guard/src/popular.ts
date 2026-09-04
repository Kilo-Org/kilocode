import type { Ecosystem } from "./effects.js";

/**
 * Локальный список популярных имён — база для детекции опечаток.
 *
 * Список ЛОКАЛЬНЫЙ и это принципиально: имя «правильного» пакета, которое мы
 * показываем разработчику, не должно приходить из сети, иначе атакующий
 * управлял бы подсказкой. В проде список подгружается из подписанного
 * снапшота топ-N реестра; здесь — seed для PoC.
 */
const NPM = [
  "react","react-dom","preact","vue","angular","svelte","next","nuxt","express","koa","fastify",
  "lodash","underscore","ramda","axios","node-fetch","got","request","superagent","cross-fetch",
  "typescript","ts-node","tsx","esbuild","webpack","rollup","vite","parcel","babel-core",
  "jest","mocha","chai","vitest","sinon","supertest","cypress","playwright",
  "eslint","prettier","stylelint","husky","lint-staged","commitlint",
  "chalk","colors","commander","yargs","inquirer","ora","boxen","figlet",
  "moment","dayjs","date-fns","luxon","uuid","nanoid","ms",
  "dotenv","config","convict","joi","zod","yup","ajv",
  "mongoose","sequelize","typeorm","prisma","knex","pg","mysql2","redis","ioredis","sqlite3",
  "socket.io","ws","cors","helmet","morgan","body-parser","cookie-parser","multer","passport",
  "jsonwebtoken","bcrypt","bcryptjs","crypto-js","argon2",
  "rxjs","immer","zustand","redux","mobx","recoil","jotai",
  "tailwindcss","postcss","autoprefixer","sass","less","styled-components","emotion",
  "graphql","apollo-server","urql","trpc","swr","react-query",
  "puppeteer","cheerio","jsdom","sharp","canvas","pdfkit","archiver",
  "winston","pino","bunyan","debug","signale",
  "glob","fs-extra","rimraf","mkdirp","chokidar","del","globby",
  "semver","minimist","dotenv-expand","execa","shelljs","concurrently","nodemon","pm2",
];

const PYPI = [
  "requests","urllib3","httpx","aiohttp","flask","django","fastapi","starlette","tornado","bottle",
  "numpy","pandas","scipy","matplotlib","seaborn","plotly","bokeh","altair",
  "scikit-learn","tensorflow","torch","keras","xgboost","lightgbm","catboost","transformers",
  "pytest","unittest2","nose","tox","hypothesis","coverage","mock",
  "sqlalchemy","alembic","psycopg2","pymysql","redis","pymongo","peewee",
  "pydantic","attrs","marshmallow","cerberus","jsonschema",
  "click","typer","argparse","fire","rich","tqdm","colorama","tabulate",
  "beautifulsoup4","lxml","scrapy","selenium","playwright","html5lib",
  "pillow","opencv-python","imageio","scikit-image",
  "boto3","botocore","google-cloud-storage","azure-storage-blob",
  "celery","kombu","rq","dramatiq","apscheduler",
  "jinja2","markupsafe","werkzeug","itsdangerous","gunicorn","uvicorn","waitress",
  "cryptography","pyjwt","passlib","bcrypt","paramiko",
  "python-dotenv","pyyaml","toml","configparser","environs",
  "setuptools","wheel","pip","poetry","virtualenv","black","flake8","mypy","ruff","isort",
];

export const POPULAR: Partial<Record<Ecosystem, Set<string>>> = {
  npm: new Set(NPM),
  pypi: new Set(PYPI),
};
