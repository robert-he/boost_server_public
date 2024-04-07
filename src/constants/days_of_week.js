const getSum = (total, num) => {
  return total + num;
};

const dayOfWeekAsString = (dayIndex) => {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayIndex];
};

export { getSum, dayOfWeekAsString };
