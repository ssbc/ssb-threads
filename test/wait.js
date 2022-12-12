module.exports = function wait(cb, period = 50) {
  return (err, data) => {
    setTimeout(() => cb(err, data), period);
  };
};
