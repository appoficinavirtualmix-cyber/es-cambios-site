(() => {
  "use strict";

  const PACKAGE_NAME = "com.eschangue.escambios";
  const OFFICIAL_HOST = "es-cambios.com.br";
  const OFFICIAL_PATH = "/verificar-celular";
  const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_NAME}`;
  const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{40,80}$/i;

  const loading = document.getElementById("verification-link-loading");
  const valid = document.getElementById("verification-link-valid");
  const invalid = document.getElementById("verification-link-invalid");
  const openApp = document.getElementById("open-es-cambios-app");
  const token = new URLSearchParams(window.location.search).get("token")?.trim() || "";

  loading.hidden = true;

  if (!TOKEN_PATTERN.test(token) || !openApp) {
    invalid.hidden = false;
    window.history.replaceState(null, "", `${OFFICIAL_PATH}/`);
    return;
  }

  const intentUrl = `intent://${OFFICIAL_HOST}${OFFICIAL_PATH}?token=${encodeURIComponent(token)}` +
    `#Intent;scheme=https;package=${PACKAGE_NAME};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

  window.history.replaceState(null, "", `${OFFICIAL_PATH}/`);
  valid.hidden = false;

  openApp.addEventListener("click", (event) => {
    event.preventDefault();
    window.location.assign(intentUrl);
  });
})();
