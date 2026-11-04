'use strict';
/* Makes the scouting site's push-reminder keys. YOU run this ONCE (see PUSH-SETUP.md):
 *
 *   node tools/make-push-keys.js
 *
 * What it does:
 *   1. Makes a new VAPID key pair (the site's "signature" that push services check).
 *   2. PRINTS ONLY THE PUBLIC KEY. It is safe to share: paste it into wrangler.jsonc as vars.VAPID_PUBLIC.
 *   3. Writes the private key to a temporary file, feeds that file to
 *        npx wrangler secret put VAPID_PRIVATE
 *      (so the private key goes straight into Cloudflare's secret store), then deletes the file.
 *      The private key is never printed and never saved anywhere else.
 *
 * If you run it twice you get a different pair; every phone that turned reminders on must then turn them off
 * and on again, so only run it again if the private key leaked.
 *
 * --dry-run  does steps 1 and 2 and writes + deletes the temp file, but does NOT call Wrangler (used by the tests).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../push-core.js');

const dry = process.argv.includes('--dry-run');

(async () => {
  const pair = await globalThis.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = P.b64uEncode(new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey)));
  const privateKey = (await globalThis.crypto.subtle.exportKey('jwk', pair.privateKey)).d;   // the 32-byte secret, base64url

  const file = path.join(os.tmpdir(), 'vapid-private-' + process.pid + '-' + Date.now() + '.txt');
  fs.writeFileSync(file, privateKey, { mode: 0o600 });
  console.log('Public key (safe to share): ' + publicKey);
  console.log('Private key file (deleted right after): ' + file);
  try {
    if (dry) {
      console.log('DRY RUN: would run  npx --yes wrangler@4 secret put VAPID_PRIVATE  with that file as input. Nothing was sent.');
    } else {
      const r = spawnSync('npx --yes wrangler@4 secret put VAPID_PRIVATE', { shell: true, input: fs.readFileSync(file), stdio: ['pipe', 'inherit', 'inherit'] });
      if (r.status !== 0) { console.error('\nWrangler did not accept the secret (see above). Sign in first with:  npx --yes wrangler@4 login   then run this again.'); process.exitCode = 1; }
      else console.log('\nThe private key is now stored as the secret VAPID_PRIVATE.');
    }
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* already gone */ }
  }
  if (!process.exitCode && !dry) console.log('Next: paste the public key above into wrangler.jsonc (vars.VAPID_PUBLIC). See PUSH-SETUP.md.');
})().catch((e) => { console.error(e.message); process.exit(1); });
