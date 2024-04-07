// adopted from: https://stackoverflow.com/questions/14696326/break-array-of-objects-into-separate-arrays-based-on-a-property
const groupBy = (arr, property) => {
  return arr.reduce((memo, x) => {
    if (!memo[x[property]]) { memo[x[property]] = []; }
    memo[x[property]].push(x);
    return memo;
  }, {});
};

const splitByAvgProductivity = (arr) => {
  const arrays = [];
  let currentProd = null;
  let currentArray = [];

  arr.forEach((entry) => {
    if (currentProd === null) {
      currentProd = entry.averageProductivity;
      currentArray.push(entry);
    }
    else if (entry.averageProductivity !== currentProd) {
      arrays.push(currentArray);
      currentProd = entry.averageProductivity;
      currentArray = [];
      currentArray.push(entry);
    }
    else {
      currentArray.push(entry);
    }
  });

  if (currentArray.length > 0) {
    arrays.push(currentArray);
  }

  arrays.forEach((array) => {
    array.sort((a, b) => {
      if (a.timesObserved < b.timesObserved) {
        return 1;
      }
      if (a.timesObserved > b.timesObserved) {
        return -1;
      }
      return 0;
    });
  });

  const output = [];

  arrays.forEach((array) => {
    array.forEach((item) => {
      output.push(item);
    });
  });

  return output;
};

export { groupBy, splitByAvgProductivity };
