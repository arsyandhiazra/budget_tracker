import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createMailer } from '../server/mailer.js';
import { createApp } from '../server/app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const mailer = createMailer(config);
const app = createApp({ db, config, mailer });

export default app;
