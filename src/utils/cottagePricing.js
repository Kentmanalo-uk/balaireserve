'use strict';

function timeToMinutes(time) {
  if (time === null || time === undefined) return null;
  const value = String(time).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function validateCottageTimeRange(startTime, endTime) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  return startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;
}

// A cottage booking is charged its rate once; the selected time in/out is
// stored for scheduling only and never multiplies the price.
function calculateCottageTotal(cottageRate) {
  const rate = Number(cottageRate);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return Number(rate.toFixed(2));
}

module.exports = {
  calculateCottageTotal,
  validateCottageTimeRange,
};
