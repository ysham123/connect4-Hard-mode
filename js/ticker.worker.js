// Steady clock for the host. Worker timers keep running when the tab is in the background.
let id = null;
self.onmessage = (e) => {
  if (e.data === 'start') {
    clearInterval(id);
    id = setInterval(() => self.postMessage(0), 200);
  } else if (e.data === 'stop') {
    clearInterval(id);
  }
};
