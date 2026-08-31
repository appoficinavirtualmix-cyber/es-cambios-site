(() => {
  "use strict";

  const clearLegacyApplicationState = async () => {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.allSettled(cacheNames.map((cacheName) => caches.delete(cacheName)));
    }
  };

  clearLegacyApplicationState().catch(() => {
    // The static site remains usable when browser cleanup APIs are unavailable.
  });
})();
