import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import morgan from 'morgan';
import mongoose from 'mongoose';
import * as admin from 'firebase-admin';
import router from './router';

// initialize firebase admin
const serviceAccount = {
  type: 'service_account',
  project_id: 'boost-240320',
  private_key_id: 'REDACTED',
  private_key: 'REDACTED',
  client_email: 'REDACTED',
  client_id: 'REDACTED',
  auth_uri: 'REDACTED',
  token_uri: 'REDACTED',
  auth_provider_x509_cert_url: 'REDACTED',
  client_x509_cert_url: 'REDACTED',
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'REDACTED',
});

// initialize server
const app = express();

// enable/disable cross origin resource sharing if necessary
app.use(cors());

// enable/disable http request logging
app.use(morgan('dev'));

// enable only if you want templating
app.set('view engine', 'ejs');

// enable only if you want static assets from folder static
app.use(express.static('static'));

// this just allows us to render ejs from the ../app/views directory
app.set('views', path.join(__dirname, '../src/views'));

// enable json message body for posting data to API
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({
  limit: '50mb',
  extended: true,
  parameterLimit: 50000,
}));

// DB Setup
const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost/boost';
mongoose.connect(mongoURI);
// set mongoose promises to es6 default
mongoose.Promise = global.Promise;

app.use('/api', router);

// START THE SERVER
// =============================================================================
const port = process.env.PORT || 9090;
app.listen(port);

console.log(`listening on: ${port}`);
