import { Router } from 'express';
import { Map } from 'immutable';
import * as firebase from 'firebase';
import * as Users from './controllers/user_controller';
import { subtractMinutes, computeDistance } from './constants/distance_time';

const fs = require('fs');
const multer = require('multer');

const upload = multer({ dest: 'src/uploads/' });

// import firebase configuration
const FireBaseConfig = {
  apiKey: process.env.firebase_apiKey,
  authDomain: process.env.firebase_authDomain,
  databaseURL: process.env.firebase_databaseURL,
  projectId: process.env.firebase_projectId,
  storageBucket: process.env.firebase_storageBucket,
  messagingSenderId: process.env.firebase_messagingSenderId,
};

// initialize firebase
if (!firebase.apps.length) {
  firebase.initializeApp(FireBaseConfig);
}

const router = Router();

router.post('/getAuth', (req, res, next) => {
  Users.createUser(req, res, next);
});

router.put('/updateUserSettings', (req, res, next) => {
  Users.updateUserSettings(req, res, next);
});

router.get('/getLocationsWithProductivityNullWithinLastNDays', (req, res, next) => {
  Users.getLocationsWithProductivityNullWithinLastNDays(req, res, next);
});

router.put('/updateProductivityLevel/:locationID', (req, res, next) => {
  Users.updateProductivityLevel(req, res, next);
});

router.get('/getMostProductiveWeekDay', (req, res, next) => { // send in 'days' as a param in your query
  Users.getMostProductiveWeekDay(req, res, next);
});

router.get('/getLeastProductiveWeekDay', (req, res, next) => { // send in 'days' as a param in your query
  Users.getLeastProductiveWeekDay(req, res, next);
});

router.post('/storeBackgroundData', (req, res, next) => {
  Users.storeBackgroundData(req, res, next);
});

router.get('/mostProductiveLocationsRankedLastNDays', (req, res, next) => {
  Users.getMostProductiveLocationsRankedLastNDays(req, res, next);
});

router.get('/mostFrequentlyVisitedLocationsRanked', (req, res, next) => {
  Users.getMostFrequentlyVisitedLocationsRanked(req, res, next);
});

router.get('/productivityScoresLastNDays', (req, res, next) => {
  Users.getProductivityScoresLastNDays(req, res, next);
});

router.post('/uploadGoogleLocationData', upload.single('file'), (req, res) => {
  const rawdata = fs.readFileSync(req.file.path);
  const rawdataJSON = JSON.parse(rawdata);

  // delete file from server
  fs.unlinkSync(req.file.path);

  const { locations } = rawdataJSON;

  // clump together time observation sittings
  const sittings = [];

  // define helper variables
  let currentStartTime;
  let currentEndTime;
  let currentLatitude;
  let currentLongitude;

  const promises = [];

  // find sittings from all location data
  locations.forEach((observation) => {
    promises.push(new Promise((resolve, reject) => {
      // if we don't have data on our currents, set and move on
      if (!currentStartTime) {
        currentStartTime = observation.timestampMs;
        currentEndTime = observation.timestampMs;
        currentLatitude = observation.latitudeE7 / (10 ** 7);
        currentLongitude = observation.longitudeE7 / (10 ** 7);
        resolve();
      }

      // if the observation is within 0.1 miles of the current location
      else if (computeDistance(currentLatitude, currentLongitude, observation.latitudeE7 / (10 ** 7), observation.longitudeE7 / (10 ** 7), 'M') < 0.1) {
        currentEndTime = observation.timestampMs;
        resolve();
      }

      // found a new location/sitting so we need to save this sitting and advance
      else if (currentStartTime < subtractMinutes(currentEndTime, 15)) {
        sittings.push({
          startTime: currentStartTime,
          endTime: currentEndTime,
          latitude: currentLatitude,
          longitude: currentLongitude,
        });

        currentStartTime = observation.timestampMs;
        currentEndTime = observation.timestampMs;
        currentLatitude = observation.latitudeE7 / (10 ** 7);
        currentLongitude = observation.longitudeE7 / (10 ** 7);
        resolve();
      }

      else {
        currentStartTime = observation.timestampMs;
        currentEndTime = observation.timestampMs;
        currentLatitude = observation.latitudeE7 / (10 ** 7);
        currentLongitude = observation.longitudeE7 / (10 ** 7);
        resolve();
      }
    }));
  });

  // once all observations have been clumped to sittings, group by common areas
  Promise.all(promises).then(() => {
    let commonLocations = new Map();
    const sittingPromises = [];

    sittings.forEach((sitting) => {
      sittingPromises.push(new Promise((resolve, reject) => {
        let foundKey = false;

        commonLocations.keySeq().forEach((key) => {
          if (!foundKey && computeDistance(sitting.latitude, sitting.longitude, key.latitude, key.longitude, 'M') < 0.1) {
            commonLocations.get(key).push({ startTime: sitting.startTime, endTime: sitting.endTime });
            foundKey = true;
            resolve();
          }
        });

        if (!foundKey) {
          const sittingArray = [];
          sittingArray.push({
            startTime: sitting.startTime,
            endTime: sitting.endTime,
          });

          commonLocations = commonLocations.set({
            latitude: sitting.latitude,
            longitude: sitting.longitude,
          }, sittingArray);

          resolve();
        }
      }));
    });

    // once all groups have been formed, set an output json object to store/send to user
    Promise.all(sittingPromises).then(() => {
      const outputPromises = [];
      const output = [];

      commonLocations.entrySeq().forEach(([key, value]) => {
        if (value.length >= 2) {
          outputPromises.push(new Promise((resolve, reject) => {
            const newObj = {};
            newObj[`${key.latitude.toString()} , ${key.longitude.toString()}`] = value;
            output.push(newObj);
            resolve();
          }));
        }
      });

      // final result to send to user -- should store this in db
      Promise.all(outputPromises).then(() => {
        Users.setModelRun(req, res, output);
      });
    });
  });
});

export default router;
