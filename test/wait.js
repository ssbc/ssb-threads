module.exports = function wait(cb, period = 300) {
  return (err, data) => {
    setTimeout(() => cb(err, data), period);
  };
};
