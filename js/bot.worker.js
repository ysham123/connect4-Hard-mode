// Runs the practice bot off the main thread so animations stay smooth.
import { planTurn } from './bot.js';

self.onmessage = (e) => {
  const { id, input } = e.data;
  let plan = null;
  try {
    plan = planTurn(input);
  } catch (err) {
    plan = null;
  }
  self.postMessage({ id, plan });
};
