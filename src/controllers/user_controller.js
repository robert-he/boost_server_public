import jwt from 'jwt-simple';
import dotenv from 'dotenv';
import * as admin from 'firebase-admin';
import { Map } from 'immutable';
import User from '../models/user_model';
import { LocationModel } from '../models/location_model';

import { subtractMinutes, computeDistance } from '../constants/distance_time';
import { splitByAvgProductivity } from '../constants/group_by';
import { getSum, dayOfWeekAsString } from '../constants/days_of_week';
import getLocationInfo from '../services/google_api';

dotenv.config({ silent: true });

const moment = require('moment');
const schedule = require('node-schedule');

// create user object for this id if one doesn't exist already
const createUser = (req, res, next) => {
  const { userID } = req.body; // userID obtained from firebase sign in w. Google

  if (!userID) {
    return res.status(422).send('You must provide the firebase userID');
  }

  // authenticate user token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.findOne({ _id: uid })
        .then((foundUser) => {
          if (foundUser === null) {
            const user = new User();

            user._id = uid;
            user.presetProductiveLocations = {};
            user.settings = {};
            user.homeLocation = '';
            user.latlongHomeLocation = '';
            user.backgroundLocationDataToBeProcessed = [];
            user.frequentLocations = [];
            user.initialUploadData = {};

            user.save()
              .then((response) => { // if save is successfull
                res.send({
                  token: tokenForUser(user),
                  response: {
                    presetProductiveLocations: response.presetProductiveLocations,
                    settings: response.settings,
                    homeLocation: response.homeLocation,
                    latlongHomeLocation: response.latlongHomeLocation,
                  },
                });
              })
              .catch((error) => { // if save throws an error
                if (error) {
                  res.status(500).send(error);
                }
              });
          } else {
            res.send({
              presetProductiveLocations: foundUser.presetProductiveLocations,
              settings: foundUser.settings,
              homeLocation: foundUser.homeLocation,
              latlongHomeLocation: foundUser.latlongHomeLocation,
            });
          }
        }) // end of .then
        .catch((err) => {
          res.status(500).send(err);
        });
    })
    // authentication of token failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

export const getLocationsWithProductivityNullWithinLastNDays = (req, res, next) => {
  // days is last 14 days, if days = 7, find all locations w. productivity == null in last 7 days
  const { userID, days } = req.query;

  // authenticate user token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.aggregate([
        { $match: { _id: uid } },
        { $project: { frequentLocations: 1, _id: 0 } }])
        .then((foundLocations, error) => {
          const FrequentLocations = foundLocations[0].frequentLocations;
          const timeStampOfExactlyNDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).getTime();
          const onlyFilteredLocationObjs = FrequentLocations.filter((locationObj) => {
            return locationObj.productivity === undefined && locationObj.startTime >= timeStampOfExactlyNDaysAgo;
          }); // return just the LocationObjs that have a startTime more recently than var "days" days ago AND that has productivity undefined

          res.send(onlyFilteredLocationObjs);
        })
        .catch((error) => {
          res.status(500).send(error);
        });
    // ...
    })
    // authentication of token failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

export const updateProductivityLevel = (req, res, next) => {
  const { userID, productivity } = req.body;
  const { locationID } = req.params;

  // authenticate user token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.findOne({ _id: uid }, { frequentLocations: 1 })
        .then((foundUser) => {
          const foundLocationObj = foundUser.frequentLocations.id(locationID);
          foundLocationObj.productivity = productivity;

          foundUser.save()
            .then(() => {
              res.send({ message: 'Successfully saved!' });
            })
            .catch((error) => {
              res.status(500).send(`Error on saving the user once location productivity has been updated: ${error.message}`);
            });
        })
        .catch((error) => {
          res.status(500).send(error);
        });

      LocationModel.findOne({ _id: locationID })
        .then((foundLocation) => {
          foundLocation.productivity = productivity;

          foundLocation.save()
            .then((savedfoundLocation) => {
              res.send(savedfoundLocation);
            })
            .catch((error) => {
              res.status(500).send(`Error upon saving location document with id ${locationID}`);
            });
        });
    })
    // authentication of token failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

// set days = 7 for last7Days, days = 30 for last30Days, don't put anything for days if you want all time
export const getWeekDayProductivityAverages = (userID, days) => {
  // Loop through the JSON File and insert the corresponding productivities to the weekday arrays.
  const Sunday = [];
  const Monday = [];
  const Tuesday = [];
  const Wednesday = [];
  const Thursday = [];
  const Friday = [];
  const Saturday = [];

  // if the user exists
  return User.findOne({ _id: userID })
    .then((foundUser) => {
      let onlyFilteredLocationObjs = [];
      if (days) {
        const timeStampOfExactlyNDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).getTime();

        onlyFilteredLocationObjs = foundUser.frequentLocations.filter((locationObj) => {
          return locationObj.startTime >= timeStampOfExactlyNDaysAgo;
        }); // return just the LocationObjs that have a startTime more recently than var "days" days ago
      }
      else { // if days is not defined, then just give WeekDayProductivityAverages for all Time
        onlyFilteredLocationObjs = foundUser.frequentLocations;
      }

      onlyFilteredLocationObjs.forEach((locationObj) => {
        const EpochOfSingularLocationObj = locationObj.startTime;
        const ProductivityOfSingularLocationObj = locationObj.productivity;

        if (ProductivityOfSingularLocationObj) {
          const dayOfWeek = moment(EpochOfSingularLocationObj).format('d'); // dayOfWeek is a string. moment will take a timestamp (i.e. '3242358932423423') and return '0', '1', '2', '3', '4', '5', ...

          switch (dayOfWeek) // depending on the value of dayOfWeek, push the productivity of the locationObj into the appropriate array declared earlier
          {
            case '0':
              Sunday.push(Number(ProductivityOfSingularLocationObj));
              break;
            case '1':
              Monday.push(Number(ProductivityOfSingularLocationObj));
              break;
            case '2':
              Tuesday.push(Number(ProductivityOfSingularLocationObj));
              break;
            case '3':
              Wednesday.push(Number(ProductivityOfSingularLocationObj));
              break;
            case '4':
              Thursday.push(Number(ProductivityOfSingularLocationObj));
              break;
            case '5':
              Friday.push(Number(ProductivityOfSingularLocationObj));
              break;
            default:
              Saturday.push(Number(ProductivityOfSingularLocationObj));
          }
        }
      });

      const sumOfSunday = Sunday.reduce(getSum, 0); // calculate the sum of each array
      const sumOfMonday = Monday.reduce(getSum, 0);
      const sumOfTuesday = Tuesday.reduce(getSum, 0);
      const sumOfWednesday = Wednesday.reduce(getSum, 0);
      const sumOfThursday = Thursday.reduce(getSum, 0);
      const sumOfFriday = Friday.reduce(getSum, 0);
      const sumOfSaturday = Saturday.reduce(getSum, 0);


      // Lengths of Arrays
      let SundayArrayLength;
      let MondayArrayLength;
      let TuesdayArrayLength;
      let WednesdayArrayLength;
      let ThursdayArrayLength;
      let FridayArrayLength;
      let SaturdayArrayLength;


      // Check if any of the arrays are empty, then find average of the numbers within each array

      // if the length is 0, return 1 so we can at least divide
      if (Sunday.length === 0) {
        SundayArrayLength = 1;
      } else {
        SundayArrayLength = Sunday.length;
      }

      if (Monday.length === 0) {
        MondayArrayLength = 1;
      } else {
        MondayArrayLength = Monday.length;
      }

      if (Tuesday.length === 0) {
        TuesdayArrayLength = 1;
      } else {
        TuesdayArrayLength = Tuesday.length;
      }

      if (Wednesday.length === 0) {
        WednesdayArrayLength = 1;
      } else {
        WednesdayArrayLength = Wednesday.length;
      }

      if (Thursday.length === 0) {
        ThursdayArrayLength = 1;
      } else {
        ThursdayArrayLength = Thursday.length;
      }

      if (Friday.length === 0) {
        FridayArrayLength = 1;
      } else {
        FridayArrayLength = Friday.length;
      }

      if (Saturday.length === 0) {
        SaturdayArrayLength = 1;
      } else {
        SaturdayArrayLength = Saturday.length;
      }

      // Calculate Average Productivities
      const avgProductivityofSunday = (sumOfSunday / SundayArrayLength);
      const avgProductivityofMonday = (sumOfMonday / MondayArrayLength);
      const avgProductivityofTuesday = (sumOfTuesday / TuesdayArrayLength);
      const avgProductivityofWednesday = (sumOfWednesday / WednesdayArrayLength);
      const avgProductivityofThursday = (sumOfThursday / ThursdayArrayLength);
      const avgProductivityofFriday = (sumOfFriday / FridayArrayLength);
      const avgProductivityofSaturday = (sumOfSaturday / SaturdayArrayLength);

      return [avgProductivityofSunday, avgProductivityofMonday, avgProductivityofTuesday, avgProductivityofWednesday, avgProductivityofThursday, avgProductivityofFriday, avgProductivityofSaturday];
    });
};

export const setMostProductiveWeekDay = (userID, days) => {
  // function which calculates the average productivity of each day of the week
  getWeekDayProductivityAverages(userID, days).then((weekDayProductivityAverages) => {
    const avgProductivityofSunday = weekDayProductivityAverages[0];
    const avgProductivityofMonday = weekDayProductivityAverages[1];
    const avgProductivityofTuesday = weekDayProductivityAverages[2];
    const avgProductivityofWednesday = weekDayProductivityAverages[3];
    const avgProductivityofThursday = weekDayProductivityAverages[4];
    const avgProductivityofFriday = weekDayProductivityAverages[5];
    const avgProductivityofSaturday = weekDayProductivityAverages[6];

    const highestAvgProductivity = Math.max(avgProductivityofSunday, avgProductivityofMonday, avgProductivityofTuesday, avgProductivityofWednesday, avgProductivityofThursday, avgProductivityofFriday, avgProductivityofSaturday);

    let mostProductivityWeekDay = 6;

    switch (highestAvgProductivity) // compare the highestAvgProductivity to see which day's avgProductivity it is equal to. if there's a match, you've found the mostProductiveWeekDay
    {
      case (avgProductivityofSunday):
        mostProductivityWeekDay = 0;
        break;
      case (avgProductivityofMonday):
        mostProductivityWeekDay = 1;
        break;
      case (avgProductivityofTuesday):
        mostProductivityWeekDay = 2;
        break;
      case (avgProductivityofWednesday):
        mostProductivityWeekDay = 3;
        break;
      case (avgProductivityofThursday):
        mostProductivityWeekDay = 4;
        break;
      case (avgProductivityofFriday):
        mostProductivityWeekDay = 5;
        break;
      default:
        mostProductivityWeekDay = 6;
    }

    const mostProductivityWeekDayString = dayOfWeekAsString(mostProductivityWeekDay); // using a separate function that we've defined, take in a number (i.e. 0, 1, 2, 3, 4) and return "Monday", "Tuesday", "Wednesday", "Thursday"...

    User.findOne({ _id: userID })
      .then((foundUser) => {
        switch (days) { // set the field on the user model appropriately depending on days argument
          case (7):
            foundUser.mostProductiveWeekDayLast7Days = { Weekday: mostProductivityWeekDayString, avgProductivity: highestAvgProductivity };
            break;
          case (30):
            foundUser.mostProductiveWeekDayLast30Days = { Weekday: mostProductivityWeekDayString, avgProductivity: highestAvgProductivity };
            break;
          default:
            foundUser.mostProductiveWeekDayAllTime = { Weekday: mostProductivityWeekDayString, avgProductivity: highestAvgProductivity };
        }

        foundUser.save();
      });
  });
};

export const getMostProductiveWeekDay = (req, res, next) => {
  const { userID, days } = req.query;

  // authenticate user token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.findOne({ _id: uid })
        .then((foundUser) => {
          switch (days) { // return appropriate answer based on input
            case ('7'):
              if (foundUser.mostProductiveWeekDayLast7Days.avgProductivity === 0 || foundUser.mostProductiveWeekDayLast7Days.avgProductivity === '0') {
                res.json({
                  mostProductiveWeekDayLast7Days: 'Not enough information',
                  avgProductivity: foundUser.mostProductiveWeekDayLast7Days.avgProductivity,
                });
              }
              else {
                res.json({
                  mostProductiveWeekDayLast7Days: foundUser.mostProductiveWeekDayLast7Days.Weekday,
                  avgProductivity: foundUser.mostProductiveWeekDayLast7Days.avgProductivity,
                });
              }
              break;
            case ('30'):
              if (foundUser.mostProductiveWeekDayLast30Days.avgProductivity === 0 || foundUser.mostProductiveWeekDayLast30Days.avgProductivity === '0') {
                res.json({
                  mostProductiveWeekDayLast30Days: 'Not enough information',
                  avgProductivity: foundUser.mostProductiveWeekDayLast30Days.avgProductivity,
                });
              }
              else {
                res.json({
                  mostProductiveWeekDayLast30Days: foundUser.mostProductiveWeekDayLast30Days.Weekday,
                  avgProductivity: foundUser.mostProductiveWeekDayLast30Days.avgProductivity,
                });
              }
              break;
            default:
              if (foundUser.mostProductiveWeekDayAllTime.avgProductivity === 0 || foundUser.mostProductiveWeekDayAllTime.avgProductivity === '0') {
                res.json({
                  mostProductiveWeekDayAllTime: 'Not enough information',
                  avgProductivity: foundUser.mostProductiveWeekDayAllTime.avgProductivity,
                });
              }
              else {
                res.json({
                  mostProductiveWeekDayAllTime: foundUser.mostProductiveWeekDayAllTime.Weekday,
                  avgProductivity: foundUser.mostProductiveWeekDayAllTime.avgProductivity,
                });
              }
          }
        })
        .catch((error) => {
          res.status(500).send(error);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

export const getLeastProductiveWeekDay = (req, res, next) => {
  const { userID, days } = req.query;

  // authenticate user token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.findOne({ _id: uid })
        .then((foundUser) => {
          switch (days) { // return appropriate answer based on input
            case ('7'):
              if (foundUser.leastProductiveWeekDayLast7Days.avgProductivity === 0 || foundUser.leastProductiveWeekDayLast7Days.avgProductivity === '0') {
                res.json({
                  leastProductiveWeekDayLast7Days: 'Not enough information',
                  avgProductivity: foundUser.leastProductiveWeekDayLast7Days.avgProductivity,
                });
              }
              else {
                res.json({
                  leastProductiveWeekDayLast7Days: foundUser.leastProductiveWeekDayLast7Days.Weekday,
                  avgProductivity: foundUser.leastProductiveWeekDayLast7Days.avgProductivity,
                });
              }
              break;
            case ('30'):
              if (foundUser.leastProductiveWeekDayLast30Days.avgProductivity === 0 || foundUser.leastProductiveWeekDayLast30Days.avgProductivity === '0') {
                res.json({
                  leastProductiveWeekDayLast30Days: 'Not enough information',
                  avgProductivity: foundUser.leastProductiveWeekDayLast30Days.avgProductivity,
                });
              }
              else {
                res.json({
                  leastProductiveWeekDayLast30Days: foundUser.leastProductiveWeekDayLast30Days.Weekday,
                  avgProductivity: foundUser.leastProductiveWeekDayLast30Days.avgProductivity,
                });
              }
              break;
            default:
              if (foundUser.leastProductiveWeekDayAllTime.avgProductivity === 0 || foundUser.leastProductiveWeekDayAllTime === '0') {
                res.json({
                  leastProductiveWeekDayAllTime: 'Not enough information',
                  avgProductivity: foundUser.leastProductiveWeekDayAllTime.avgProductivity,
                });
              }
              else {
                res.json({
                  leastProductiveWeekDayAllTime: foundUser.leastProductiveWeekDayAllTime.Weekday,
                  avgProductivity: foundUser.leastProductiveWeekDayAllTime.avgProductivity,
                });
              }
          }
        })
        .catch((error) => {
          res.status(500).send(error);
        });
    })
  // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

export const setLeastProductiveWeekDay = (userID, days) => {
  // function which calculates the average productivity of each day of the week
  getWeekDayProductivityAverages(userID, days).then((weekDayProductivityAverages) => {
    const avgProductivityofSunday = weekDayProductivityAverages[0];
    const avgProductivityofMonday = weekDayProductivityAverages[1];
    const avgProductivityofTuesday = weekDayProductivityAverages[2];
    const avgProductivityofWednesday = weekDayProductivityAverages[3];
    const avgProductivityofThursday = weekDayProductivityAverages[4];
    const avgProductivityofFriday = weekDayProductivityAverages[5];
    const avgProductivityofSaturday = weekDayProductivityAverages[6];

    const lowestAvgProductivity = Math.min(avgProductivityofSunday, avgProductivityofMonday, avgProductivityofTuesday, avgProductivityofWednesday, avgProductivityofThursday, avgProductivityofFriday, avgProductivityofSaturday);

    let leastProductivityWeekDay = 6;

    switch (lowestAvgProductivity)
    {
      case (avgProductivityofSunday):
        leastProductivityWeekDay = 0;
        break;
      case (avgProductivityofMonday):
        leastProductivityWeekDay = 1;
        break;
      case (avgProductivityofTuesday):
        leastProductivityWeekDay = 2;
        break;
      case (avgProductivityofWednesday):
        leastProductivityWeekDay = 3;
        break;
      case (avgProductivityofThursday):
        leastProductivityWeekDay = 4;
        break;
      case (avgProductivityofFriday):
        leastProductivityWeekDay = 5;
        break;
      default:
        leastProductivityWeekDay = 6;
    }

    const leastProductivityWeekDayString = dayOfWeekAsString(leastProductivityWeekDay);

    User.findOne({ _id: userID })
      .then((foundUser) => {
        switch (days) { // set the field on the user model appropriately depending on days argument
          case (7):
            foundUser.leastProductiveWeekDayLast7Days = { Weekday: leastProductivityWeekDayString, avgProductivity: lowestAvgProductivity };
            break;
          case (30):
            foundUser.leastProductiveWeekDayLast30Days = { Weekday: leastProductivityWeekDayString, avgProductivity: lowestAvgProductivity };
            break;
          default:
            foundUser.leastProductiveWeekDayAllTime = { Weekday: leastProductivityWeekDayString, avgProductivity: lowestAvgProductivity };
        }

        foundUser.save();
      });
  });
};

// convert lat longs for each location object of a user from their background location to actual google places
const setGoogleLocationInfo = (uid) => {
  return new Promise((resolve, reject) => {
    User.findOne({ _id: uid })
      .then((foundUser) => {
        if (foundUser === null) {
          console.error(`Didn't find user with id: ${uid}`);
        } else {
          const promises = [];
          const locationsObserved = [];
          const discoveredLocations = {};
          let times = 0;

          // grab location info for each location
          foundUser.frequentLocations.forEach((locationObj) => {
            promises.push(new Promise((resolve, reject) => {
            // ensure we don't already have info on this location
              if (locationObj.location === undefined || Object.keys(locationObj.location).length === 0) {
              // if we haven't come across this location already, either check other location objects or the google api for more info
                if (!locationsObserved.includes(locationObj.latLongLocation)) {
                // mark that we will soon know more about this location, so other location objects here can wait to get the information
                  locationsObserved.push(locationObj.latLongLocation);

                  // check if any pre-existing location in our model knows about this location
                  LocationModel.find({ latLongLocation: locationObj.latLongLocation })
                    .then((foundLocations) => {
                    // ensure we got data
                      if (foundLocations.length > 0) {
                        let foundInfo = false;

                        const foundPromises = [];

                        // check each location object
                        foundLocations.forEach((foundLocation) => {
                          foundPromises.push(new Promise((resolve, reject) => {
                            if (foundLocation !== null) {
                            // make sure this location object has google data in it
                              if (foundLocation.location !== null && foundLocation.location !== undefined) {
                                if (Object.keys(foundLocation.location).length > 0) {
                                // store result in object
                                  locationObj.location = foundLocation.location;

                                  // cache the result to grab after the promises resolve
                                  discoveredLocations[locationObj.latLongLocation] = foundLocation.location;
                                  foundInfo = true;
                                  resolve(locationObj);
                                }
                              } else {
                                foundLocation.location = {};
                                resolve(locationObj);
                              }
                            }
                          }));
                        });

                        Promise.all(foundPromises)
                          .then((results) => {
                          // if none of these objects had info on this location, make a call to the google api
                            if (!foundInfo) {
                              times += 1;
                              // make a call to google api to get info
                              getLocationInfo(locationObj.latLongLocation)
                                .then((result) => {
                                  locationObj.location = result;

                                  // cache the result to grab after the promises resolve
                                  discoveredLocations[locationObj.latLongLocation] = result;
                                  resolve(locationObj);
                                })
                                .catch((error) => {
                                  resolve();
                                });
                            }
                          })
                          .catch((error) => {
                            locationObj.location = {};
                            resolve(locationObj);
                          });

                      // if not, make a call to the google api
                      } else {
                        times += 1;
                        // make a call to google api to get info
                        getLocationInfo(locationObj.latLongLocation)
                          .then((result) => {
                            locationObj.location = result;

                            // cache the result to grab after the promises resolve
                            discoveredLocations[locationObj.latLongLocation] = result;
                            resolve(locationObj);
                          })
                          .catch((error) => {
                            resolve();
                          });
                      }
                    })
                    .catch((error) => {
                      console.error(error);
                    });
                }

                // if we have come across this lat long before, we won't have gotten the google data in time because it's an async call
                // so, just mark that we know we need to fill this in
                else {
                  locationObj.location = {};
                  resolve(locationObj);
                }
              } else {
                resolve(locationObj);
              }
            }));
          });

          // when all location objects have been searched by google or stored, check for the ones we passed on
          Promise.all(promises).then(() => {
            const confirmPromises = [];

            // loop over each location and object and check if we passed on making an API call but had to wait to access the data
            foundUser.frequentLocations.forEach((locationObj) => {
              confirmPromises.push(new Promise((resolve, reject) => {
                // if this location has an empty location field and we know we stored it's google info, set it
                if (Object.keys(locationObj.location).length === 0 && Object.keys(discoveredLocations).includes(locationObj.latLongLocation)) {
                  locationObj.location = discoveredLocations[locationObj.latLongLocation];
                }

                // if this location is also a location the user set as a productive location, set the productivity
                if (foundUser.presetProductiveLocations) {
                  if (foundUser.presetProductiveLocations[locationObj.location.formatted_address]) {
                    locationObj.productivity = foundUser.presetProductiveLocations[locationObj.location.formatted_address];
                  }
                }

                resolve();
              }));
            });

            // once we've gotten all location points, save the user and return
            Promise.all(confirmPromises)
              .then(() => {
                foundUser.save()
                  .then((result) => {
                    // console.log('DONE');
                    console.log(times);

                    // run check of frequent locations to determine if there are any productivity levels we can set
                    // now, go into all the locations of this user and set strings and productivities respectively
                    const allPresetProductiveLocationAddresses = Object.keys(foundUser.presetProductiveLocations);
                    const productivityPromises = [];

                    foundUser.frequentLocations.forEach((locationObj) => {
                      productivityPromises.push(new Promise((resolve, reject) => {
                        if (allPresetProductiveLocationAddresses.includes(locationObj.location.formatted_address)) {
                          if (!locationObj.productivity) {
                            locationObj.productivity = foundUser.presetProductiveLocations[locationObj.location.formatted_address];
                          }
                        }
                        resolve();
                      }));
                    });

                    Promise.all(productivityPromises)
                      .then(() => {
                        resolve();
                      })
                      .catch((error) => {
                        reject(error);
                      });
                  })
                  .catch((error) => {
                    reject(error);
                  });
              })
              .catch((error) => {
                reject(error);
              });
          });
        }
      }) // end of .then
      .catch((err) => {
        reject(err);
      });
  });
};

const setModelRun = (req, res, modelOutput) => {
  const { uid } = req.body; // userID obtained from firebase sign in w. Google

  if (!uid) {
    return res.status(422).send('You must provide the firebase user auth token');
  }

  // authenticate user token
  admin.auth().verifyIdToken(uid)
    .then((decodedToken) => {
      const userID = decodedToken.uid;

      User.findOne({ _id: userID })
        .then((foundUser) => {
          if (foundUser === null) {
            res.status(500).send(`No user exists with id: ${userID}`);
          } else {
            const output = [];
            const locationPromises = [];

            // for each location we observed
            modelOutput.forEach((entry) => {
              // for each sitting we observed at that location
              entry[Object.keys(entry)[0]].forEach((sitting) => {
                // wrap in promise because .save() is async
                locationPromises.push(new Promise((resolve, reject) => {
                  // create a location object for this sitting at this location
                  const locationObj = new LocationModel();
                  locationObj.latLongLocation = Object.keys(entry)[0];
                  locationObj.startTime = parseInt(sitting.startTime, 10);
                  locationObj.endTime = parseInt(sitting.endTime, 10);

                  // productivity is null, can search on user, frequent locations .find({ productivity: null })

                  // save location object, then append to frequentLocations array and resolve promise
                  locationObj.save().then(() => {
                    output.push(locationObj);
                    resolve();
                  }).catch((err) => {
                    reject(err);
                  });
                }));
              });
            });

            // when all location objects for this user are created, save this user and send to res
            Promise.all(locationPromises).then(() => {
              foundUser.frequentLocations = output;
              foundUser.save().then(() => {
                // grab location details from google api -- run in background and confirm success to user
                // run twice to ensure async gets all
                setGoogleLocationInfo(userID)
                  .then(() => {
                    setGoogleLocationInfo(userID)
                      .then(() => {
                        res.send({ message: 'success!' });
                      })
                      .catch((err) => {
                        res.status(500).send(err);
                      });
                  })
                  .catch((err) => {
                    res.status(500).send(err);
                  });
              }).catch((err) => {
                res.status(500).send(err);
              });
            });
          }
        }) // end of .then
        .catch((err) => {
          res.status(500).send(err);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

// store background data from user in temporary waiting pool
const storeBackgroundData = (req, res, next) => {
  const { uid, dataToBeProcessed } = req.body; // userID obtained from firebase sign in w. Google

  if (!uid) {
    return res.status(422).send('You must provide the firebase user auth token');
  }

  // authenticate user auth token
  admin.auth().verifyIdToken(uid)
    .then((decodedToken) => {
      const userID = decodedToken.uid;

      User.findOne({ _id: userID })
        .then((foundUser) => {
          // make sure the field exists
          if (foundUser.backgroundLocationDataToBeProcessed === undefined || foundUser.backgroundLocationDataToBeProcessed === null) {
            foundUser.backgroundLocationDataToBeProcessed = [];
          }

          // store all data
          dataToBeProcessed.forEach((element) => {
            foundUser.backgroundLocationDataToBeProcessed.push(element);
          });

          // save object
          foundUser.save()
            .then(() => {
              res.send({ message: 'success' });
            })
            .catch((error) => {
              res.status(500).send(error);
            });
        })
        .catch((error) => {
          res.status(500).send(error);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

// add data processed from background location to user's frequentLocations array
const addToFrequentLocations = (uid, dataToBeProcessed) => {
  User.findOne({ _id: uid })
    .then((foundUser) => {
      if (foundUser === null) {
        console.error(`No user with uid: ${uid}`);
      } else {
        const output = [];
        const locationPromises = [];

        // for each location we observed
        dataToBeProcessed.forEach((entry) => {
          // for each sitting we observed at that location
          entry[Object.keys(entry)[0]].forEach((sitting) => {
            // wrap in promise because .save() is async
            locationPromises.push(new Promise((resolve, reject) => {
              // create a location object for this sitting at this location
              const locationObj = new LocationModel();
              locationObj.latLongLocation = Object.keys(entry)[0];
              locationObj.startTime = parseInt(sitting.startTime, 10);
              locationObj.endTime = parseInt(sitting.endTime, 10);

              // productivity is null, can search on user, frequent locations .find({ productivity: null })

              // save location object, then append to frequentLocations array and resolve promise
              locationObj.save().then(() => {
                output.push(locationObj);
                resolve();
              }).catch((err) => {
                reject(err);
              });
            }));
          });
        });

        // when all location objects for this user are created, store the location data
        Promise.all(locationPromises).then(() => {
          const storePromises = [];

          output.forEach((object) => {
            storePromises.push(new Promise((resolve, reject) => {
              foundUser.frequentLocations.push(object);
              resolve();
            }));
          });

          // when all info is stored in the user, save user and ensure all location data has google info
          Promise.all(storePromises)
            .then(() => {
              foundUser.save().then(() => {
                // grab location details from google api
                setGoogleLocationInfo(uid);
              }).catch((err) => {
                console.error(err);
              });
            })
            .catch((error) => {
              console.error(error);
            });
        });
      }
    }) // end of .then
    .catch((err) => {
      console.error(err);
    });
};

// go through a user's background location data and add to their frequent locations
const processBackgroundLocationData = (uid) => {
  User.findOne({ _id: uid })
    .then((foundUser) => {
      // grab a reference to the data yet to be processed
      const locations = foundUser.backgroundLocationDataToBeProcessed;

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
            currentStartTime = Math.floor(observation.timestamp);
            currentEndTime = Math.floor(observation.timestamp);
            currentLatitude = observation.coords.latitude;
            currentLongitude = observation.coords.longitude;
            resolve();
          }

          // if the observation is within 0.1 miles of the current location
          else if (computeDistance(currentLatitude, currentLongitude, observation.coords.latitude, observation.coords.longitude, 'M') < 0.1) {
            currentEndTime = Math.floor(observation.timestamp);
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

            currentStartTime = Math.floor(observation.timestamp);
            currentEndTime = Math.floor(observation.timestamp);
            currentLatitude = observation.coords.latitude;
            currentLongitude = observation.coords.longitude;
            resolve();
          }

          else {
            currentStartTime = Math.floor(observation.timestamp);
            currentEndTime = Math.floor(observation.timestamp);
            currentLatitude = observation.coords.latitude;
            currentLongitude = observation.coords.longitude;
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

          // final result is processed, so now add it to this user's frequent locations array
          Promise.all(outputPromises).then(() => {
            addToFrequentLocations(uid, output);

            // delete the waiting pool since we've now processed it
            foundUser.backgroundLocationDataToBeProcessed = [];
            foundUser.save();
          });
        });
      });
    })
    .catch((error) => {
      console.error(error.message);
    });
};

// automatically processes background location data, and set most/least productiveWeekDay for all users everyday @ 7 PM
const automaticProcessBackgroundLocationData = schedule.scheduleJob({ hour: 19 }, () => {
  User.find({})
    .then((allUsers) => {
      allUsers.forEach((user) => {
        const userID = user._id;
        processBackgroundLocationData(userID);
        setMostProductiveWeekDay(userID);
        setLeastProductiveWeekDay(userID);
        setMostProductiveWeekDay(userID, 7); // updates mostProductiveWeekDayLast7Days for User Model
        setLeastProductiveWeekDay(userID, 7);
        setMostProductiveWeekDay(userID, 30); // mostProductiveWeekDayLast30Days for User Model
        setLeastProductiveWeekDay(userID, 30);
      });
    });
});

// get the top n most productive locations by average productivity level
// tie breakers are ranked by number of times the location was observed
const getMostProductiveLocationsRankedLastNDays = (req, res, next) => {
  if (!req.query.uid) {
    res.status(500).send('You must provide a valid user id');
  }

  if (!req.query.numberOfItems) {
    res.status(500).send('You must provide the number of items you would like to receive');
  }

  const days = (!req.query.days) ? 10000 : req.query.days; // if req.query.days is undefined, set days to 10,000 (effectively allTime)

  const timeStampOfExactlyNDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).getTime();

  // authenticate user auth token
  admin.auth().verifyIdToken(req.query.uid)
    .then((decodedToken) => {
      const userID = decodedToken.uid;

      User.findOne({ _id: userID })
        .then((foundUser) => {
          const locationMetrics = {};
          const promises = [];

          let currentAddress = null;
          let currentSum = 0;
          let currentCount = 0;

          const onlyFilteredLocationObjs = foundUser.frequentLocations.filter((locationObj) => {
            return locationObj.startTime >= timeStampOfExactlyNDaysAgo;
          }); // return just the LocationObjs that have a startTime more recently than var "days" days ago

          // walk through the locations and count the number of times the user has been observed there and sum up the productivity levels
          onlyFilteredLocationObjs.forEach((locationObj) => {
            if (locationObj.location.formatted_address) {
              promises.push(new Promise((resolve, reject) => {
                if (currentAddress === null) {
                  currentAddress = locationObj.location.formatted_address;
                  currentSum = locationObj.productivity ? locationObj.productivity : 0;
                  currentCount = 1;
                }
                else if (currentAddress !== locationObj.location.formatted_address) {
                  if (locationMetrics[currentAddress]) {
                    locationMetrics[currentAddress] = {
                      timesObserved: locationMetrics[currentAddress].timesObserved + currentCount,
                      sumOfProductivity: locationMetrics[currentAddress].sumOfProductivity + currentSum,
                    };
                  } else {
                    locationMetrics[currentAddress] = {
                      timesObserved: currentCount,
                      sumOfProductivity: currentSum,
                    };
                  }

                  currentAddress = null;
                  currentSum = 0;
                  currentCount = 0;
                }
                else {
                  currentSum += locationObj.productivity ? locationObj.productivity : 0;
                  currentCount += 1;
                }

                resolve();
              }));
            }
          });

          Promise.all(promises)
            .then((result) => {
              const summaryPromises = [];

              // once all metrics have been determined, summarize them into average productivity and times observed
              Object.keys(locationMetrics).forEach((locationName) => {
                summaryPromises.push(new Promise((resolve, reject) => {
                  locationMetrics[locationName] = {
                    averageProductivity: locationMetrics[locationName].sumOfProductivity / locationMetrics[locationName].timesObserved,
                    timesObserved: locationMetrics[locationName].timesObserved,
                  };
                  resolve();
                }));
              });

              Promise.all(summaryPromises)
                .then(() => {
                  const locationInfoSummarized = [];

                  // create an object with this info
                  Object.keys(locationMetrics).forEach((locationName) => {
                    locationInfoSummarized.push({
                      address: locationName,
                      averageProductivity: locationMetrics[locationName].averageProductivity,
                      timesObserved: locationMetrics[locationName].timesObserved,
                    });
                  });

                  // sort objects by averageProductivity
                  locationInfoSummarized.sort((a, b) => {
                    if (a.averageProductivity < b.averageProductivity) {
                      return 1;
                    }
                    if (a.averageProductivity > b.averageProductivity) {
                      return -1;
                    }
                    return 0;
                  });

                  // grab the top n most productive locations as measured by average productivity
                  const topFive = locationInfoSummarized.slice(0, req.query.numberOfItems < locationInfoSummarized.length ? req.query.numberOfItems : locationInfoSummarized.length - 1);

                  // break into categories by productivity level, then sort pieces and combine
                  const output = splitByAvgProductivity(topFive);

                  res.send({ output, days });
                })
                .catch((error) => {
                  res.status(500).send(error);
                });
            })
            .catch((error) => {
              res.status(500).send(error);
            });
        })
        .catch((error) => {
          res.status(500).send(`User with id: ${userID} was not found`);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

const getMostFrequentlyVisitedLocationsRanked = (req, res, next) => {
  if (!req.query.uid) {
    res.status(500).send('You must provide a valid user id');
  }

  if (!req.query.numberOfItems) {
    res.status(500).send('You must provide the number of items you would like to receive');
  }

  // verify user auth token
  admin.auth().verifyIdToken(req.query.uid)
    .then((decodedToken) => {
      const userID = decodedToken.uid;

      User.findOne({ _id: userID })
        .then((foundUser) => {
          const locationMetrics = {};
          const promises = [];

          let currentAddress = null;
          let currentCount = 0;

          // walk through the locations and count the number of times the user has been observed there and sum up the productivity levels
          foundUser.frequentLocations.forEach((locationObj) => {
            if (locationObj.location.formatted_address) {
              promises.push(new Promise((resolve, reject) => {
                if (currentAddress === null) {
                  currentAddress = locationObj.location.formatted_address;
                  currentCount = 1;
                }
                else if (currentAddress !== locationObj.location.formatted_address) {
                  if (locationMetrics[currentAddress]) {
                    locationMetrics[currentAddress] += currentCount;
                  } else {
                    locationMetrics[currentAddress] = currentCount;
                  }

                  currentAddress = null;
                  currentCount = 0;
                }
                else {
                  currentCount += 1;
                }

                resolve();
              }));
            }
          });

          Promise.all(promises)
            .then((result) => {
              const locationInfoSummarized = [];

              // create an object with this info
              Object.keys(locationMetrics).forEach((locationName) => {
                locationInfoSummarized.push({
                  address: locationName,
                  timesObserved: locationMetrics[locationName],
                });
              });

              // sort objects by averageProductivity
              locationInfoSummarized.sort((a, b) => {
                if (a.timesObserved < b.timesObserved) {
                  return 1;
                }
                if (a.timesObserved > b.timesObserved) {
                  return -1;
                }
                return 0;
              });

              // grab the top n most productive locations as measured by average productivity
              const output = locationInfoSummarized.slice(0, req.query.numberOfItems < locationInfoSummarized.length ? req.query.numberOfItems : locationInfoSummarized.length - 1);
              res.send({ output });
            })
            .catch((error) => {
              res.status(500).send(error);
            });
        })
        .catch((error) => {
          res.status(500).send(`User with id: ${req.query.uid} was not found`);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

// get average productivity in last N days
const getProductivityScoresLastNDays = (req, res, next) => {
  if (!req.query.uid) {
    res.status(500).send('You must provide a valid user id');
  }

  const days = (!req.query.days) ? 10000 : req.query.days; // if req.query.days is undefined, set days to 10,000 (effectively allTime)

  // verify user auth token
  admin.auth().verifyIdToken(req.query.uid)
    .then((decodedToken) => {
      const userID = decodedToken.uid;

      User.findOne({ _id: userID })
        .then((foundUser) => {
          // grab all location objects for this user that occured in the last thirty days
          const locationObjectsInLastNDays = {};

          foundUser.frequentLocations.forEach((locationObj) => {
            // check if in last N days
            if ((new Date().getTime() - locationObj.endTime) / (1000 * 60 * 60 * 24) <= days) {
              // generate nicely formatted date string
              const date = new Date(locationObj.endTime);
              const formatted = `${date.getMonth() + 1}/${date.getDate() < 10 ? `0${date.getDate()}` : date.getDate()}/${date.getFullYear()}`;

              // store in collection on that day
              if (locationObjectsInLastNDays[formatted]) {
                locationObjectsInLastNDays[formatted].push(locationObj);
              } else {
                locationObjectsInLastNDays[formatted] = [];
                locationObjectsInLastNDays[formatted].push(locationObj);
              }
            }
          });

          // sort the object keys by date
          const locationsOrderedByDate = {};

          Object.keys(locationObjectsInLastNDays).sort().forEach((key) => {
            locationsOrderedByDate[key] = locationObjectsInLastNDays[key];
          });

          // build the output to send to the user with averaged values
          const output = {};

          Object.keys(locationsOrderedByDate).forEach((date) => {
            const dateObservations = locationsOrderedByDate[date];

            // sum up productivity levels and count productivity levels
            let sum = 0;
            let count = 0;

            dateObservations.forEach((obs) => {
              count += 1;
              sum += obs.productivity ? obs.productivity : 0;
            });

            output[date] = (count === 0 ? 0 : sum / count);
          });

          res.send({ output, days });
        })
        .catch(() => {
          res.status(500).send(`No user found with id: ${userID}`);
        });
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

export const updateUserSettings = (req, res, next) => {
  const {
    userID, homeLocation, homeLocationLatLong, presetProductiveLocations,
  } = req.body;

  // verify user auth token
  admin.auth().verifyIdToken(userID)
    .then((decodedToken) => {
      const uid = decodedToken.uid;

      User.findOne({ _id: uid })
        .then((foundUser) => {
          foundUser.homeLocation = homeLocation; // set the home Location appropriately e.g. "Dartmouth Street, Boston, MA,USA"
          foundUser.latlongHomeLocation = homeLocationLatLong; // set the latLong for the user appropriately e.g. "42.3485196, -71.0765708"

          const newPresetProductiveLocations = {};

          // only grab observations where productivity score about 0 was recorded
          Object.keys(presetProductiveLocations).forEach((address) => {
            if (presetProductiveLocations[address] > 0) {
              newPresetProductiveLocations[address] = presetProductiveLocations[address];
            }
          });

          foundUser.presetProductiveLocations = newPresetProductiveLocations; // set productivity levels for known locations

          // now, go into all the locations of this user and set strings and productivities respectively
          const allPresetProductiveLocationAddresses = Object.keys(foundUser.presetProductiveLocations);
          const promises = [];

          foundUser.frequentLocations.forEach((locationObj) => {
            promises.push(new Promise((resolve, reject) => {
              if (allPresetProductiveLocationAddresses.includes(locationObj.location.formatted_address)) {
                if (!locationObj.productivity) {
                  locationObj.productivity = presetProductiveLocations[locationObj.location.formatted_address];
                }
              }
              resolve();
            }));
          });

          Promise.all(promises)
            .then((results) => {
              // end result should be foundUser.presetProductiveLocations = { "9 Maynard Street, Hanover, NH": 5, "Dartmouth Street, Boston, MA,USA": 3 }
              foundUser.save()
                .then((response) => {
                  res.send({ message: `Success saving user settings for user with id ${uid}` });
                })
                .catch((err) => {
                  if (err) {
                    res.status(500).send(`Error upon saving user settings for user with id ${uid}`);
                  }
                });
            })
            .catch((error) => {
              res.status(500).send(error);
            });

          // after updating Settings, now the productivity of some locations have changed. must now recalculate most/least ProductiveWeekDays

          setMostProductiveWeekDay(uid);
          setLeastProductiveWeekDay(uid);
          setMostProductiveWeekDay(uid, 7); // updates mostProductiveWeekDayLast7Days for User Model
          setLeastProductiveWeekDay(uid, 7);
          setMostProductiveWeekDay(uid, 30); // mostProductiveWeekDayLast30Days for User Model
          setLeastProductiveWeekDay(uid, 30);
        })
        .catch((error) => {
          if (error) {
            res.status(500).send(`Error upon saving user settings for user with id ${uid}. Could not find user.`);
          }
        });
      // ...
    })
    // user authentication failed
    .catch((error) => {
      res.status(401).send(error);
    });
};

// encodes a new token for a user object
function tokenForUser(user) {
  const timestamp = new Date().getTime();
  return jwt.encode({ sub: user.id, iat: timestamp }, process.env.AUTH_SECRET);
}

export {
  createUser, setModelRun, storeBackgroundData, getMostProductiveLocationsRankedLastNDays, getMostFrequentlyVisitedLocationsRanked, getProductivityScoresLastNDays, automaticProcessBackgroundLocationData,
};
