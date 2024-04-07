import mongoose, { Schema } from 'mongoose';

const LocationSchema = new Schema({
  location: Object,
  latLongLocation: String,
  startTime: Number,
  endTime: Number,
  productivity: Number,
}, {
  toJSON: {
    virtuals: true,
  },
});

// create LocationModel class from schema
const LocationModel = mongoose.model('Location', LocationSchema);

export { LocationSchema, LocationModel };
