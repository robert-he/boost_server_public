import axios from 'axios';

// makes google maps reverse geocoding api call with lat long input, returns an address if promise is resolved
const getLocationInfo = (coords) => {
  const coordList = coords.split(',');
  coordList[0] = coordList[0].replace(/^\s+|\s+$/g, '');
  coordList[1] = coordList[1].replace(/^\s+|\s+$/g, '');

  return new Promise((resolve, reject) => {
    axios
      .get(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coordList[0]},${coordList[1]}&key=${process.env.GOOGLE_API_KEY}`,
      )
      .then((result) => {
        if (result.data.results.length > 0) {
          const locationData = {
            formatted_address: result.data.results[0].formatted_address || '',
            place_id: result.data.results[0].place_id || '',
            types: result.data.results[0].types.length > 0 ? result.data.results[0].types[0] : '',
          };
          resolve(locationData);
        } else {
          resolve({
            formatted_address: '',
            place_id: '',
            types: '',
          });
        }
      })
      .catch((error) => {
        reject(error);
      });
  });
};

export default getLocationInfo;
