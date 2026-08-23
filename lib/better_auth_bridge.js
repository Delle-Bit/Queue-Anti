// better-auth ships pure ESM; this app is CommonJS throughout. This bridge is
// the one place that crosses the boundary via dynamic import(), so nothing
// else in the app needs to become ESM.
let modulePromise = null;
function loadAuthModule() {
    if (!modulePromise) modulePromise = import('./better_auth.mjs');
    return modulePromise;
}

module.exports = {
    sendLoginOTP: async (email) => (await loadAuthModule()).sendLoginOTP(email),
    verifyLoginOTP: async (email, otp) => (await loadAuthModule()).verifyLoginOTP(email, otp),
    migrateBetterAuth: async () => (await loadAuthModule()).migrateBetterAuth()
};
